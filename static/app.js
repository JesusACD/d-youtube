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
        displayVideoInfo(data);

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
function displayVideoInfo(data) {
    hideAllSections();
    els.videoInfo.classList.remove('hidden');

    els.videoThumbnail.src = data.thumbnail;
    els.videoTitle.textContent = data.title;
    els.videoUploader.textContent = data.uploader;
    els.videoDuration.textContent = data.duration;
    els.videoViews.textContent = formatNumber(data.view_count) + ' vistas';

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
}

// --- Iniciar descarga ---
async function startDownload(format) {
    const url = els.urlInput.value.trim();
    
    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                format_type: format,
                quality: state.selectedQuality
            }),
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
    showToast('¡Descarga lista!', 'success');
    
    if (state.ws) state.ws.close();

    // Mostrar "Volver a resultados" si hay resultados cacheados
    if (state.lastSearchResults) {
        els.backToResultsBtnComplete.classList.remove('hidden');
    } else {
        els.backToResultsBtnComplete.classList.add('hidden');
    }

    // AUTO-DOWNLOAD: Trigger saving the file automatically
    setTimeout(() => {
        saveFile();
    }, 500);
}

// --- Guardar archivo ---
function saveFile() {
    if (!state.taskId) return;
    
    // Crear un link temporal y hacer click
    const downloadUrl = `/api/download/${state.taskId}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('Archivo guardado en descargas.', 'success');
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
