# 🎬 d-youtube

Descargador de YouTube premium con interfaz web moderna. Descarga videos en MP3 (con carátula y metadata) o Video HD, con búsqueda integrada, recorte inteligente y progreso en tiempo real.

---

## ✨ Características

| Función                        | Descripción                                                |
| ------------------------------ | ---------------------------------------------------------- |
| 🔍 **Búsqueda integrada**      | Busca videos directamente desde la app (top 10 resultados) |
| 🎵 **Descarga MP3**            | Audio 320kbps con carátula y metadata embebida             |
| 🎥 **Descarga Video**          | Máxima calidad disponible en MP4                           |
| ✂️ **Recorte inteligente**     | Slider visual para descargar solo una porción del video    |
| 📊 **Progreso en tiempo real** | Velocidad, porcentaje y ETA via WebSocket                  |
| 🔄 **Navegación persistente**  | Vuelve a los resultados de búsqueda sin re-buscar          |
| 🎨 **UI Premium**              | Diseño glassmorphism oscuro, responsive y animado          |

---

## 🛠️ Requisitos

- **Python** 3.10+
- **FFmpeg** (debe estar en el `PATH` del sistema)
- **pip** (gestor de paquetes de Python)

---

## 🚀 Instalación local

### 1. Clonar el repositorio

```bash
git clone https://github.com/JesusACD/d-youtube.git
cd d-youtube
```

### 2. Crear entorno virtual

```bash
python -m venv venv

# Windows
.\venv\Scripts\activate

# Linux / Mac
source venv/bin/activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Instalar FFmpeg

**Windows:**

```bash
# Opción 1: Con winget
winget install FFmpeg

# Opción 2: Descargar de https://ffmpeg.org/download.html y agregar al PATH
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update && sudo apt install -y ffmpeg
```

**Mac:**

```bash
brew install ffmpeg
```

### 5. Ejecutar

```bash
python server.py
```

Abre **http://localhost:8000** en tu navegador.

---

## 📁 Estructura del proyecto

```
d-youtube/
├── server.py           # Backend FastAPI + lógica de descarga
├── requirements.txt    # Dependencias Python
├── static/
│   ├── index.html      # Interfaz principal
│   ├── style.css       # Estilos (glassmorphism)
│   └── app.js          # Lógica frontend
└── downloads/          # Archivos descargados (temporal, auto-limpieza 1h)
```

---

## 🌐 Despliegue en VPS (Ubuntu 22.04+)

### Paso 1 — Preparar el servidor

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Python, pip, venv y FFmpeg
sudo apt install -y python3 python3-pip python3-venv ffmpeg git
```

### Paso 2 — Clonar y configurar la app

```bash
# Crear directorio de la app
cd /opt
sudo git clone https://github.com/tu-usuario/d-youtube.git
sudo chown -R $USER:$USER d-youtube
cd d-youtube

# Entorno virtual + dependencias
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Paso 3 — Crear servicio systemd

```bash
sudo nano /etc/systemd/system/d-youtube.service
```

Pegar este contenido:

```ini
[Unit]
Description=d-youtube - Descargador de YouTube
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/d-youtube
ExecStart=/opt/d-youtube/venv/bin/python server.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

Ajustar permisos y arrancar:

```bash
sudo chown -R www-data:www-data /opt/d-youtube
sudo systemctl daemon-reload
sudo systemctl enable d-youtube
sudo systemctl start d-youtube
```

Verificar que está corriendo:

```bash
sudo systemctl status d-youtube
```

### Paso 4 — Configurar Nginx como proxy reverso

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/d-youtube
```

Pegar esta configuración:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;  # o la IP del VPS

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket para progreso en tiempo real
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Activar el sitio:

```bash
sudo ln -s /etc/nginx/sites-available/d-youtube /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Paso 5 — (Opcional) SSL con Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

---

## 🔧 Comandos útiles en el VPS

```bash
# Ver logs en tiempo real
sudo journalctl -u d-youtube -f

# Reiniciar la app
sudo systemctl restart d-youtube

# Detener la app
sudo systemctl stop d-youtube

# Actualizar la app
cd /opt/d-youtube
sudo -u www-data git pull
sudo systemctl restart d-youtube
```

---

## 📄 API Endpoints

| Método | Ruta                 | Descripción                  |
| ------ | -------------------- | ---------------------------- |
| `GET`  | `/`                  | Interfaz web                 |
| `POST` | `/api/info`          | Obtener info de un video     |
| `POST` | `/api/search`        | Buscar videos en YouTube     |
| `POST` | `/api/download`      | Iniciar descarga (MP3/Video) |
| `GET`  | `/api/download/{id}` | Descargar archivo completado |
| `GET`  | `/api/progress/{id}` | Estado de la descarga        |
| `WS`   | `/ws/progress/{id}`  | Progreso en tiempo real      |

---

## ⚠️ Notas

- Los archivos descargados se eliminan automáticamente después de **1 hora**.
- Requiere **FFmpeg** para conversión MP3, merge de audio+video y recorte.
- El servidor corre en el puerto **8000** por defecto.

---

**Hecho con ❤️ usando FastAPI + yt-dlp**
