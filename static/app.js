/**
 * d-youtube — Lógica de la aplicación
 * Maneja la interacción con la API, WebSocket para progreso y la UI.
 */

// --- Estado de la aplicación ---
const state = {
    selectedQuality: 'best',
    videoFormats: [],
    taskId: null,
    ws: null,
    lastSearchResults: null,
    lastSearchQuery: '',
    videoDurationSeconds: 0,
    isPlaylist: false,
    playlistEntries: [],
    isDownloadingPlaylist: false,
};

// --- Referencias DOM ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
    urlInput: $('#urlInput'),
    clearBtn: $('#clearBtn'),
    fetchBtn: $('#fetchBtn'),
    loadingState: $('#loadingState'),
    videoInfo: $('#videoInfo'),
    videoThumbnail: $('#videoThumbnail'),
    videoDuration: $('#videoDuration'),
    videoTitle: $('#videoTitle'),
    videoUploader: $('#videoUploader'),
    videoViews: $('#videoViews'),
    qualitySelector: $('#qualitySelector'),
    qualityOptions: $('#qualityOptions'),
    downloadMp3Btn: $('#downloadMp3Btn'),
    downloadVideoBtn: $('#downloadVideoBtn'),
    newAnalysisBtn: $('#newAnalysisBtn'),
    downloadProgress: $('#downloadProgress'),
    progressTitle: $('#progressTitle'),
    progressPercent: $('#progressPercent'),
    progressBar: $('#progressBar'),
    progressSpeed: $('#progressSpeed'),
    progressETA: $('#progressETA'),
    downloadComplete: $('#downloadComplete'),
    completedFilename: $('#completedFilename'),
    saveFileBtn: $('#saveFileBtn'),
    newDownloadBtn: $('#newDownloadBtn'),
    toastContainer: $('#toastContainer'),
    searchResults: $('#searchResults'),
    searchGrid: $('#searchGrid'),
    backToResultsBtn: $('#backToResultsBtn'),
    backToResultsBtnComplete: $('#backToResultsBtnComplete'),
    trimToggle: $('#trimToggle'),
    trimControls: $('#trimControls'),
    trimStart: $('#trimStart'),
    trimEnd: $('#trimEnd'),
    trimSliderStart: $('#trimSliderStart'),
    trimSliderEnd: $('#trimSliderEnd'),
    trimRange: $('#trimRange'),
    trimLabelStart: $('#trimLabelStart'),
    trimLabelEnd: $('#trimLabelEnd'),
    trimDurationLabel: $('#trimDurationLabel'),
};

// --- Inicialización ---
function init() {
    createParticles();
    bindEvents();
}

// --- Partículas de fondo --- 
function createParticles() {
    const container = $('#particles');
    const count = 30;
    
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDuration = (15 + Math.random() * 25) + 's';
        particle.style.animationDelay = Math.random() * 20 + 's';
        particle.style.width = (2 + Math.random() * 3) + 'px';
        particle.style.height = particle.style.width;
        particle.style.opacity = 0.1 + Math.random() * 0.4;
        
        const colors = [
            'rgba(132, 94, 247, 0.5)',
            'rgba(255, 107, 107, 0.4)',
            'rgba(91, 141, 239, 0.4)',
            'rgba(81, 207, 102, 0.3)',
        ];
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        
        container.appendChild(particle);
    }
}

// --- Event Listeners ---
function bindEvents() {
    // Escuchar cambios en el input para Análisis Automático / Búsqueda
    els.urlInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        els.clearBtn.classList.toggle('visible', query.length > 0);
        
        // Si no hay nada, resetear vista
        if (!query) {
            hideAllSections();
            return;
        }

        // Si la URL es válida, analizar de una vez
        if (isValidYoutubeUrl(query)) {
            fetchVideoInfo(query);
        }
    });

    // Limpiar input
    els.clearBtn.addEventListener('click', () => {
        els.urlInput.value = '';
        els.clearBtn.classList.remove('visible');
        els.urlInput.focus();
        hideAllSections();
    });

    // Botón Analizar / Buscar
    els.fetchBtn.addEventListener('click', () => {
        const query = els.urlInput.value.trim();
        console.log('[DEBUG] Query:', query);
        if (isValidYoutubeUrl(query)) {
            console.log('[DEBUG] Es una URL válida');
            fetchVideoInfo(query);
        } else if (query.length > 2) {
            console.log('[DEBUG] No es URL, buscando:', query);
            searchYoutube(query);
        } else {
            showToast('Escribe al menos 3 caracteres para buscar.', 'info');
        }
    });
    
    // Enter para buscar/analizar
    els.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = els.urlInput.value.trim();
            if (isValidYoutubeUrl(query)) {
                fetchVideoInfo(query);
            } else if (query.length > 2) {
                searchYoutube(query);
            }
        }
    });

    // Descargas Directas
    els.downloadMp3Btn.addEventListener('click', () => startDownload('mp3'));
    els.downloadVideoBtn.addEventListener('click', () => startDownload('video'));

    // Botón Reset / Nuevo Análisis
    els.newAnalysisBtn.addEventListener('click', resetUI);

    // Botón Volver a resultados (ambos)
    els.backToResultsBtn.addEventListener('click', backToResults);
    els.backToResultsBtnComplete.addEventListener('click', backToResults);

    // Guardar archivo manual
    els.saveFileBtn.addEventListener('click', saveFile);

    // Nueva descarga final
    els.newDownloadBtn.addEventListener('click', resetUI);

    // Toggle de recorte
    els.trimToggle.addEventListener('change', () => {
        els.trimControls.classList.toggle('hidden', !els.trimToggle.checked);
    });

    // Slider de recorte - sincronización
    els.trimSliderStart.addEventListener('input', () => updateTrimFromSliders('start'));
    els.trimSliderEnd.addEventListener('input', () => updateTrimFromSliders('end'));

    // Inputs manuales - sincronizar con sliders
    els.trimStart.addEventListener('change', () => syncSliderFromInput('start'));
    els.trimEnd.addEventListener('change', () => syncSliderFromInput('end'));
}

// --- Validar URL ---
function isValidYoutubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/,
        /^[a-zA-Z0-9_-]{11}$/ // ID de video
    ];
    return patterns.some(pattern => pattern.test(url));
}

// --- Buscar en YouTube ---
async function searchYoutube(query) {
    hideAllSections();
    els.loadingState.classList.remove('hidden');
    els.fetchBtn.disabled = true;

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: query }), // Usamos 'url' como campo para la query en el backend
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Error en la búsqueda');
        }

        const data = await response.json();
        displaySearchResults(data.results);
    } catch (error) {
        showToast(error.message, 'error');
        resetUI();
    } finally {
        els.fetchBtn.disabled = false;
    }
}

// --- Mostrar resultados de búsqueda ---
function displaySearchResults(results) {
    // Cachear resultados para navegación persistente
    state.lastSearchResults = results;

    hideAllSections();
    els.searchResults.classList.remove('hidden');
    els.searchGrid.innerHTML = '';

    if (results.length === 0) {
        els.searchGrid.innerHTML = '<p class="no-results">No se encontraron videos.</p>';
        return;
    }

    results.forEach(video => {
        const card = document.createElement('div');
        card.className = 'search-card';
        card.innerHTML = `
            <div class="search-card-thumb">
                <img src="${video.thumbnail}" alt="${video.title}">
                <div class="search-card-duration">${video.duration}</div>
            </div>
            <div class="search-card-content">
                <h4 class="search-card-title">${video.title}</h4>
                <div class="search-card-meta">
                    <span>${video.uploader}</span>
                    <span>${formatNumber(video.view_count)} vistas</span>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => {
            els.urlInput.value = video.url;
            fetchVideoInfo(video.url);
        });
        
        els.searchGrid.appendChild(card);
    });
}

// --- Volver a resultados de búsqueda ---
function backToResults() {
    if (state.lastSearchResults) {
        displaySearchResults(state.lastSearchResults);
    }
}

// --- Obtener info del video ---
async function fetchVideoInfo(urlFromInput = null) {
    const url = urlFromInput || els.urlInput.value.trim();
    if (!url || !isValidYoutubeUrl(url)) return;

    // Mostrar carga
    hideAllSections();
    els.loadingState.classList.remove('hidden');
    els.fetchBtn.disabled = true;

    try {
        const response = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Error al analizar el video');
        }

        const data = await response.json();
        
        if (data.is_playlist) {
            displayPlaylistInfo(data);
        } else {
            displayVideoInfo(data);
        }

        // Mostrar botón "Volver a resultados" si hay resultados cacheados
        if (state.lastSearchResults) {
            els.backToResultsBtn.classList.remove('hidden');
        } else {
            els.backToResultsBtn.classList.add('hidden');
        }
    } catch (error) {
        showToast(error.message, 'error');
        resetUI();
    } finally {
        els.fetchBtn.disabled = false;
    }
}

// --- Mostrar info en la UI ---
function displayPlaylistInfo(data) {
    hideAllSections();
    els.videoInfo.classList.remove('hidden');

    state.isPlaylist = true;
    state.playlistEntries = data.entries;

    if (data.thumbnail) {
        els.videoThumbnail.src = data.thumbnail;
        els.videoThumbnail.style.display = 'block';
    } else {
        els.videoThumbnail.style.display = 'none';
    }
    
    els.videoTitle.textContent = data.title;
    els.videoUploader.textContent = data.uploader;
    els.videoDuration.textContent = `${data.video_count} videos`;
    els.videoViews.textContent = 'Lista de reproducción';

    // Ocultar formatos y recorte
    els.qualitySelector.style.display = 'none';
    const trimContainer = els.trimToggle.closest('.trim-section');
    if (trimContainer) trimContainer.style.display = 'none';

    // Actualizar botones
    els.downloadMp3Btn.querySelector('span').textContent = 'DESCARGAR PLAYLIST MP3';
    els.downloadMp3Btn.querySelector('small').textContent = 'Audio 1 por 1';
    
    els.downloadVideoBtn.querySelector('span').textContent = 'DESCARGAR PLAYLIST VIDEO';
    els.downloadVideoBtn.querySelector('small').textContent = 'Alta calidad, 1 por 1';
}

function displayVideoInfo(data) {
    hideAllSections();
    els.videoInfo.classList.remove('hidden');

    state.isPlaylist = false;
    els.videoThumbnail.style.display = 'block';

    els.videoThumbnail.src = data.thumbnail;
    els.videoTitle.textContent = data.title;
    els.videoUploader.textContent = data.uploader;
    els.videoDuration.textContent = data.duration;
    els.videoViews.textContent = formatNumber(data.view_count) + ' vistas';

    // Resetear visibilidades de playlist
    els.qualitySelector.style.display = 'block';
    const trimContainer = els.trimToggle.closest('.trim-section');
    if (trimContainer) trimContainer.style.display = 'block';
    
    els.downloadMp3Btn.querySelector('span').textContent = 'DESCARGAR MP3';
    els.downloadMp3Btn.querySelector('small').textContent = 'Audio 320kbps';
    els.downloadVideoBtn.querySelector('span').textContent = 'DESCARGAR VIDEO';
    els.downloadVideoBtn.querySelector('small').textContent = 'Alta Calidad';

    // Formatos de video
    els.qualityOptions.innerHTML = '';
    state.videoFormats = data.video_formats;

    if (state.videoFormats.length > 0) {
        state.videoFormats.forEach((fmt, index) => {
            const btn = document.createElement('button');
            btn.className = 'quality-btn' + (index === 0 ? ' active' : '');
            btn.innerHTML = `<span>${fmt.quality}</span><small>${fmt.filesize}</small>`;
            btn.addEventListener('click', () => {
                $$('.quality-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.selectedQuality = fmt.quality;
            });
            els.qualityOptions.appendChild(btn);
        });
        state.selectedQuality = state.videoFormats[0].quality;
    }

    // Pre-llenar el campo de recorte con la duración del video
    state.videoDurationSeconds = data.duration_seconds || 0;
    setupTrimSliders();
    els.trimToggle.checked = false;
    els.trimControls.classList.add('hidden');
}

// --- Iniciar descarga ---
async function startDownload(format) {
    if (state.isPlaylist) {
        startPlaylistDownload(format);
        return;
    }

    const url = els.urlInput.value.trim();
    
    // Preparar datos de recorte
    const body = {
        url,
        format_type: format,
        quality: state.selectedQuality,
    };

    if (els.trimToggle.checked) {
        const trimStart = els.trimStart.value.trim();
        const trimEnd = els.trimEnd.value.trim();
        if (trimStart && trimStart !== '0:00') body.trim_start = trimStart;
        if (trimEnd) body.trim_end = trimEnd;
    }

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Error al iniciar descarga');
        }

        const { task_id } = await response.json();
        state.taskId = task_id;
        
        // Mostrar progreso
        hideAllSections();
        els.downloadProgress.classList.remove('hidden');
        els.progressTitle.textContent = `Preparando ${format.toUpperCase()}...`;
        els.progressBar.style.width = '0%';
        els.progressPercent.textContent = '0%';
        
        // Conectar WebSocket
        connectProgressWS(task_id);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// --- WebSocket para progreso ---
async function startPlaylistDownload(format) {
    state.isDownloadingPlaylist = true;
    hideAllSections();
    els.downloadProgress.classList.remove('hidden');
    
    let successCount = 0;
    
    for (let i = 0; i < state.playlistEntries.length; i++) {
        const entry = state.playlistEntries[i];
        
        els.progressTitle.textContent = `Descargando ${i + 1}/${state.playlistEntries.length}: ${entry.title}`;
        els.progressBar.style.width = '0%';
        els.progressPercent.textContent = '0%';
        els.progressSpeed.textContent = '--';
        els.progressETA.textContent = '--';
        
        try {
            await downloadSingleFromPlaylist(entry.url, format);
            successCount++;
        } catch (err) {
            console.error(err);
            showToast(`Error en video ${i+1}: ${err.message}`, 'error');
            // Continuar con el siguiente
            await new Promise(r => setTimeout(r, 2000)); 
        }
    }
    
    state.isDownloadingPlaylist = false;
    hideAllSections();
    els.downloadComplete.classList.remove('hidden');
    els.completedFilename.textContent = `Lista de reproducción: ${successCount} de ${state.playlistEntries.length} videos descargados.`;
    
    // Ocultar botón de "Guardar" porque ya abrieron los cuadros de diálogo automáticos
    els.saveFileBtn.style.display = 'none';

    if (state.lastSearchResults) {
        els.backToResultsBtnComplete.classList.remove('hidden');
    } else {
        els.backToResultsBtnComplete.classList.add('hidden');
    }
}

function downloadSingleFromPlaylist(url, format) {
    return new Promise(async (resolve, reject) => {
        try {
            const body = {
                url,
                format_type: format,
                quality: 'best',
            };
            
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const error = await response.json();
                return reject(new Error(error.detail || 'Error al iniciar descarga'));
            }

            const { task_id } = await response.json();
            
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/${task_id}`;
            const ws = new WebSocket(wsUrl);
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.status === 'downloading') {
                    els.progressPercent.textContent = data.progress + '%';
                    els.progressBar.style.width = data.progress + '%';
                    if (data.speed) els.progressSpeed.textContent = data.speed;
                    if (data.eta) els.progressETA.textContent = data.eta;
                } else if (data.status === 'processing') {
                    els.progressBar.style.width = '95%';
                    els.progressPercent.textContent = '95%';
                } else if (data.status === 'completed') {
                    ws.close();
                    
                    // En pywebview el archivo ya se movió mágicamente a ~/Downloads en el backend
                    if (!window.pywebview) {
                        const a = document.createElement('a');
                        a.href = `/api/download/${task_id}`;
                        a.download = '';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }
                    
                    setTimeout(resolve, 1500);
                } else if (data.status === 'error') {
                    ws.close();
                    reject(new Error(data.error));
                }
            };
            
            ws.onerror = () => reject(new Error("Error de WS"));
        } catch(e) {
            reject(e);
        }
    });
}

function connectProgressWS(taskId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${taskId}`;
    
    state.ws = new WebSocket(wsUrl);
    
    state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.status === 'downloading') {
            els.progressTitle.textContent = 'Descargando...';
            els.progressPercent.textContent = data.progress + '%';
            els.progressBar.style.width = data.progress + '%';
            els.progressSpeed.textContent = data.speed;
            els.progressETA.textContent = data.eta;
        } else if (data.status === 'processing') {
            els.progressTitle.textContent = 'Procesando archivo...';
            els.progressBar.style.width = '95%';
            els.progressPercent.textContent = '95%';
        } else if (data.status === 'completed') {
            finishDownload(data.filename);
        } else if (data.status === 'error') {
            showToast('Error: ' + data.error, 'error');
            resetUI();
        }
    };
    
    state.ws.onclose = () => {
        console.log('WS cerrado');
    };
}

function finishDownload(filename) {
    hideAllSections();
    els.downloadComplete.classList.remove('hidden');
    els.completedFilename.textContent = filename;
    
    if (window.pywebview) {
        els.saveFileBtn.style.display = 'none';
        showToast('¡Guardado directamente en tu carpeta de Descargas!', 'success');
    } else {
        els.saveFileBtn.style.display = 'inline-flex';
        showToast('¡Descarga lista!', 'success');
    }
    
    if (state.ws) state.ws.close();

    // Mostrar "Volver a resultados" si hay resultados cacheados
    if (state.lastSearchResults) {
        els.backToResultsBtnComplete.classList.remove('hidden');
    } else {
        els.backToResultsBtnComplete.classList.add('hidden');
    }

    // AUTO-DOWNLOAD: Trigger saving the file automatically solo en modo web
    if (!window.pywebview) {
        setTimeout(() => {
            saveFile();
        }, 500);
    }
}

// --- Utilidades de tiempo para recorte ---
function formatSecondsToTime(totalSeconds) {
    totalSeconds = Math.round(totalSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseTimeToSeconds(timeStr) {
    const parts = timeStr.trim().split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

function setupTrimSliders() {
    const dur = state.videoDurationSeconds;
    // Configurar rangos de los sliders
    els.trimSliderStart.max = dur;
    els.trimSliderEnd.max = dur;
    els.trimSliderStart.value = 0;
    els.trimSliderEnd.value = dur;

    // Actualizar inputs de texto
    els.trimStart.value = '0:00';
    els.trimEnd.value = formatSecondsToTime(dur);

    // Actualizar labels
    els.trimLabelStart.textContent = '0:00';
    els.trimLabelEnd.textContent = formatSecondsToTime(dur);
    updateTrimDurationLabel();
    updateTrimRangeBar();
}

function updateTrimFromSliders(which) {
    let startVal = parseInt(els.trimSliderStart.value);
    let endVal = parseInt(els.trimSliderEnd.value);

    // Evitar que se crucen
    if (which === 'start' && startVal >= endVal) {
        startVal = endVal - 1;
        els.trimSliderStart.value = startVal;
    }
    if (which === 'end' && endVal <= startVal) {
        endVal = startVal + 1;
        els.trimSliderEnd.value = endVal;
    }

    // Sincronizar con inputs de texto
    els.trimStart.value = formatSecondsToTime(startVal);
    els.trimEnd.value = formatSecondsToTime(endVal);

    // Actualizar labels sobre la barra
    els.trimLabelStart.textContent = formatSecondsToTime(startVal);
    els.trimLabelEnd.textContent = formatSecondsToTime(endVal);

    updateTrimDurationLabel();
    updateTrimRangeBar();
}

function syncSliderFromInput(which) {
    if (which === 'start') {
        const sec = parseTimeToSeconds(els.trimStart.value);
        els.trimSliderStart.value = Math.min(sec, parseInt(els.trimSliderEnd.value) - 1);
        els.trimLabelStart.textContent = formatSecondsToTime(els.trimSliderStart.value);
    } else {
        const sec = parseTimeToSeconds(els.trimEnd.value);
        els.trimSliderEnd.value = Math.max(sec, parseInt(els.trimSliderStart.value) + 1);
        els.trimLabelEnd.textContent = formatSecondsToTime(els.trimSliderEnd.value);
    }
    updateTrimDurationLabel();
    updateTrimRangeBar();
}

function updateTrimDurationLabel() {
    const startSec = parseInt(els.trimSliderStart.value);
    const endSec = parseInt(els.trimSliderEnd.value);
    const diff = endSec - startSec;
    els.trimDurationLabel.textContent = `Duración: ${formatSecondsToTime(diff)}`;
}

function updateTrimRangeBar() {
    const dur = state.videoDurationSeconds || 1;
    const startPct = (parseInt(els.trimSliderStart.value) / dur) * 100;
    const endPct = (parseInt(els.trimSliderEnd.value) / dur) * 100;
    els.trimRange.style.left = startPct + '%';
    els.trimRange.style.width = (endPct - startPct) + '%';
}

// --- Guardar archivo ---
function saveFile() {
    if (!state.taskId) return;
    
    if (window.pywebview) {
        showToast('El archivo ya se guardó automáticamente en tu carpeta nativa de Descargas.', 'success');
        return;
    }
    
    // Crear un link temporal y hacer click
    const downloadUrl = `/api/download/${state.taskId}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('Archivo enviado a descargas.', 'success');
}

// --- Utilidades ---
function hideAllSections() {
    els.videoInfo.classList.add('hidden');
    els.loadingState.classList.add('hidden');
    els.searchResults.classList.add('hidden');
    els.downloadProgress.classList.add('hidden');
    els.downloadComplete.classList.add('hidden');
}

function resetUI() {
    hideAllSections();
    els.urlInput.value = '';
    els.clearBtn.classList.remove('visible');
    els.backToResultsBtn.classList.add('hidden');
    els.backToResultsBtnComplete.classList.add('hidden');
    state.taskId = null;
    state.lastSearchResults = null;
    state.lastSearchQuery = '';
    if (state.ws) state.ws.close();
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    els.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num;
}

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', init);
