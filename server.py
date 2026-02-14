"""
Servidor FastAPI para descargar videos de YouTube.
Utiliza yt-dlp como motor de descarga y WebSocket para progreso en tiempo real.
"""

import asyncio
import os
import time
import uuid
import json
import shutil
import traceback
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import yt_dlp

# --- Configuración de rutas absolutas ---
BASE_DIR = Path(__file__).parent.absolute()
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
MAX_FILE_AGE_SECONDS = 3600  # 1 hora para limpieza automática

app = FastAPI(title="d-youtube", version="1.0.0")

# --- Verificar archivos críticos ---
INDEX_PATH = STATIC_DIR / "index.html"
if not INDEX_PATH.exists():
    print(f"[WARNING] No se encontró {INDEX_PATH}. Asegúrate de que la carpeta 'static' existe.", flush=True)

# --- Thread pool dedicado para yt-dlp ---
executor = ThreadPoolExecutor(max_workers=4)

# --- Estado global de tareas ---
tasks: dict = {}

# --- Modelos ---
class VideoInfoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    format_type: str  # "mp3" o "video"
    quality: Optional[str] = "best"  # Calidad del video


# --- Utilidades ---
def cleanup_old_files():
    """Elimina archivos descargados que superen la edad máxima."""
    now = time.time()
    try:
        for item in DOWNLOADS_DIR.iterdir():
            if item.is_file() and (now - item.stat().st_mtime) > MAX_FILE_AGE_SECONDS:
                item.unlink(missing_ok=True)
            elif item.is_dir() and (now - item.stat().st_mtime) > MAX_FILE_AGE_SECONDS:
                shutil.rmtree(item, ignore_errors=True)
    except Exception:
        pass


def format_duration(seconds) -> str:
    """Formatea duración en segundos a formato legible."""
    if not seconds:
        return "Desconocida"
    
    try:
        seconds = int(float(seconds))
    except (ValueError, TypeError):
        return "Desconocida"
        
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def format_filesize(size_bytes: Optional[int]) -> str:
    """Formatea tamaño de archivo a formato legible."""
    if not size_bytes:
        return "N/A"
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _ydl_extract(url: str, opts: dict) -> dict:
    """Helper genérico para extraer información con yt-dlp."""
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def _extract_info_sync(url: str) -> dict:
    """Extrae información del video de forma síncrona (se ejecuta en thread pool)."""
    print(f"[INFO] Comenzando extracción de: {url}", flush=True)
    
    ydl_opts = {
        'quiet': False,
        'no_warnings': False,
        'extract_flat': False,
        'noplaylist': True,
        'socket_timeout': 30,
        'no_check_certificates': True,
        'geo_bypass': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    
    print(f"[INFO] Extracción completada: {info.get('title', '?')}", flush=True)
    return info


# --- Endpoints ---
@app.get("/")
async def serve_frontend():
    """Sirve la página principal."""
    if not INDEX_PATH.exists():
        return JSONResponse({"error": f"No se encontró index.html en {STATIC_DIR}"}, status_code=404)
    return FileResponse(INDEX_PATH)


@app.post("/api/search")
async def search_youtube(request: VideoInfoRequest):
    """Busca videos en YouTube basándose en una consulta."""
    if not request.url: # En este caso 'url' es la consulta
        raise HTTPException(status_code=400, detail="La consulta de búsqueda no puede estar vacía.")
    
    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'no_warnings': True,
        'no_check_certificates': True,
        'geo_bypass': True,
        'noplaylist': True,
    }
    
    try:
        loop = asyncio.get_running_loop()
        # Buscamos los primeros 10 resultados
        search_query = f"ytsearch10:{request.url}"
        results = await loop.run_in_executor(None, lambda: _ydl_extract(search_query, ydl_opts))
        
        if not results or 'entries' not in results:
            return {"results": []}
            
        processed_results = []
        for entry in results['entries']:
            # Intentar obtener la mejor miniatura
            thumbnail = entry.get("thumbnail")
            thumbnails = entry.get("thumbnails")
            if thumbnails and len(thumbnails) > 0:
                thumbnail = thumbnails[-1].get("url")

            processed_results.append({
                "id": entry.get("id"),
                "title": entry.get("title"),
                "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                "thumbnail": thumbnail,
                "duration": format_duration(entry.get("duration", 0)),
                "uploader": entry.get("uploader"),
                "view_count": entry.get("view_count")
            })
            
        return {"results": processed_results}

    except Exception as e:
        print(f"[ERROR] Error en búsqueda: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error en la búsqueda: {str(e)}")

@app.post("/api/info")
async def get_video_info(request: VideoInfoRequest):
    """Extrae información del video de YouTube."""
    cleanup_old_files()
    
    print(f"\n{'='*60}", flush=True)
    print(f"[API] POST /api/info - URL: {request.url}", flush=True)
    print(f"{'='*60}", flush=True)
    
    try:
        # Ejecutar en thread pool dedicado con timeout
        loop = asyncio.get_running_loop()
        info = await asyncio.wait_for(
            loop.run_in_executor(executor, _extract_info_sync, request.url),
            timeout=90
        )
        
        if not info:
            raise HTTPException(status_code=400, detail="No se pudo obtener información del video.")
        
        # Obtener formatos de video disponibles
        video_formats = []
        seen_qualities = set()
        
        formats = info.get('formats', [])
        for f in formats:
            height = f.get('height')
            vcodec = f.get('vcodec', 'none')
            
            if height and vcodec != 'none':
                quality_label = f"{height}p"
                if quality_label not in seen_qualities:
                    seen_qualities.add(quality_label)
                    video_formats.append({
                        'quality': quality_label,
                        'height': height,
                        'format_note': f.get('format_note', ''),
                        'filesize': format_filesize(f.get('filesize') or f.get('filesize_approx')),
                        'ext': f.get('ext', 'mp4'),
                    })
        
        # Ordenar por calidad descendente
        video_formats.sort(key=lambda x: x['height'], reverse=True)
        
        result = {
            'title': info.get('title', 'Sin título'),
            'thumbnail': info.get('thumbnail', ''),
            'duration': format_duration(info.get('duration', 0)),
            'duration_seconds': info.get('duration', 0),
            'uploader': info.get('uploader', 'Desconocido'),
            'view_count': info.get('view_count', 0),
            'upload_date': info.get('upload_date', ''),
            'description': (info.get('description', '') or '')[:300],
            'video_formats': video_formats,
        }
        
        print(f"[API] Respuesta exitosa: {result['title']}", flush=True)
        return JSONResponse(result)
        
    except asyncio.TimeoutError:
        print("[ERROR] Timeout de 90s al extraer info", flush=True)
        raise HTTPException(status_code=408, detail="Tiempo de espera agotado al analizar el video. Intenta de nuevo.")
    except yt_dlp.DownloadError as e:
        print(f"[ERROR] yt-dlp: {e}", flush=True)
        raise HTTPException(status_code=400, detail=f"Error al obtener info: {str(e)}")
    except Exception as e:
        print(f"[ERROR] Excepción: {e}", flush=True)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error del servidor: {str(e)}")


@app.post("/api/download")
async def start_download(request: DownloadRequest):
    """Inicia una descarga y retorna un task_id para seguimiento."""
    task_id = str(uuid.uuid4())
    task_dir = DOWNLOADS_DIR / task_id
    task_dir.mkdir(exist_ok=True)
    
    tasks[task_id] = {
        'status': 'pending',
        'progress': 0,
        'speed': '',
        'eta': '',
        'filename': '',
        'error': None,
    }
    
    print(f"\n[DOWNLOAD] Iniciando descarga: {request.format_type} - {request.url}", flush=True)
    
    # Iniciar descarga en background
    asyncio.create_task(_download_task(task_id, request.url, request.format_type, request.quality, task_dir))
    
    return JSONResponse({'task_id': task_id})


async def _download_task(task_id: str, url: str, format_type: str, quality: str, task_dir: Path):
    """Tarea de descarga en background."""
    try:
        tasks[task_id]['status'] = 'downloading'
        
        def progress_hook(d):
            """Hook para actualizar progreso."""
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                downloaded = d.get('downloaded_bytes', 0)
                
                if total > 0:
                    tasks[task_id]['progress'] = round((downloaded / total) * 100, 1)
                
                speed = d.get('speed')
                if speed:
                    tasks[task_id]['speed'] = format_filesize(int(speed)) + '/s'
                
                eta = d.get('eta')
                if eta:
                    tasks[task_id]['eta'] = f"{eta}s"
                    
            elif d['status'] == 'finished':
                tasks[task_id]['progress'] = 100
                tasks[task_id]['status'] = 'processing'
        
        # Configurar opciones según tipo de formato
        if format_type == 'mp3':
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': str(task_dir / '%(title)s.%(ext)s'),
                'noplaylist': True,
                'writethumbnail': True,
                'addmetadata': True,
                'postprocessors': [
                    {
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '320',
                    },
                    {
                        'key': 'EmbedThumbnail',
                    },
                    {
                        'key': 'FFmpegMetadata',
                        'add_metadata': True,
                    }
                ],
                'progress_hooks': [progress_hook],
                'quiet': True,
                'no_warnings': True,
                'no_check_certificates': True,
                'geo_bypass': True,
            }
        else:
            # Formato video - seleccionar calidad
            if quality and quality != 'best':
                height = quality.replace('p', '')
                format_str = f'bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
            else:
                format_str = 'bestvideo+bestaudio/best'
            
            ydl_opts = {
                'format': format_str,
                'outtmpl': str(task_dir / '%(title)s.%(ext)s'),
                'noplaylist': True,
                'merge_output_format': 'mp4',
                'postprocessors': [{
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': 'mp4',
                }],
                'progress_hooks': [progress_hook],
                'quiet': True,
                'no_warnings': True,
                'no_check_certificates': True,
                'geo_bypass': True,
            }
        
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(executor, lambda: _do_download(url, ydl_opts))
        
        # Buscar archivo descargado
        downloaded_files = list(task_dir.iterdir())
        if downloaded_files:
            tasks[task_id]['filename'] = downloaded_files[0].name
            tasks[task_id]['status'] = 'completed'
            tasks[task_id]['progress'] = 100
            print(f"[DOWNLOAD] Completada: {downloaded_files[0].name}", flush=True)
        else:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = 'No se encontró el archivo descargado.'
            
    except Exception as e:
        print(f"[DOWNLOAD ERROR] {e}", flush=True)
        tasks[task_id]['status'] = 'error'
        tasks[task_id]['error'] = str(e)


def _do_download(url: str, opts: dict):
    """Ejecuta la descarga (en thread pool)."""
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


@app.websocket("/ws/{task_id}")
async def websocket_progress(websocket: WebSocket, task_id: str):
    """WebSocket para enviar progreso de descarga en tiempo real."""
    await websocket.accept()
    
    try:
        while True:
            if task_id not in tasks:
                await websocket.send_json({'error': 'Tarea no encontrada'})
                break
            
            task = tasks[task_id]
            await websocket.send_json(task)
            
            if task['status'] in ('completed', 'error'):
                break
            
            await asyncio.sleep(0.5)  # Actualizar cada 500ms
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


@app.get("/api/download/{task_id}")
async def download_file(task_id: str):
    """Descarga el archivo finalizado."""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    
    task = tasks[task_id]
    if task['status'] != 'completed':
        raise HTTPException(status_code=400, detail="La descarga aún no ha finalizado")
    
    task_dir = DOWNLOADS_DIR / task_id
    filepath = task_dir / task['filename']
    
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    
    return FileResponse(
        path=str(filepath),
        filename=task['filename'],
        media_type='application/octet-stream'
    )


# Montar archivos estáticos (CSS, JS) con ruta absoluta
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*60, flush=True)
    print("  d-youtube — Servidor iniciado", flush=True)
    print("  Abre http://localhost:8000 en tu navegador", flush=True)
    print("="*60 + "\n", flush=True)
    # Importante: ejecutar app directamente sin string/reload para evitar problemas en scripts locales
    # Regresado al puerto 8000 por petición del usuario
    uvicorn.run(app, host="0.0.0.0", port=8000)
