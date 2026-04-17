#!/usr/bin/env bash
# =============================================================================
# 🚀 Script de Despliegue Automático - d-youtube
# =============================================================================
# Descripción: Automatiza el despliegue completo del servidor d-youtube
#              en cualquier distribución Linux (Ubuntu/Debian/CentOS/Fedora/Arch)
#
# Uso:
#   chmod +x deploy.sh
#   sudo ./deploy.sh [OPCIONES]
#
# Opciones:
#   --domain DOMINIO     Dominio para Nginx y SSL (ej: youtube.midominio.com)
#   --port PUERTO        Puerto interno de la app (default: 8000)
#   --user USUARIO       Usuario del sistema para ejecutar la app (default: d-youtube)
#   --install-dir DIR    Directorio de instalación (default: /opt/d-youtube)
#   --repo URL           URL del repositorio Git (default: https://github.com/JesusACD/d-youtube.git)
#   --branch RAMA        Rama de Git a desplegar (default: main)
#   --ssl                Habilitar SSL con Certbot (requiere --domain)
#   --no-nginx           No instalar ni configurar Nginx
#   --update             Solo actualizar la aplicación (git pull + reiniciar)
#   --uninstall          Desinstalar la aplicación completamente
#   --status             Mostrar estado del servicio
#   --logs               Mostrar logs en tiempo real
#   --help               Mostrar esta ayuda
# =============================================================================

set -euo pipefail

# --- Colores para la salida ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # Sin color

# --- Variables por defecto ---
APP_NAME="d-youtube"
APP_DESCRIPTION="d-youtube - Descargador de YouTube con interfaz web"
DOMAIN=""
APP_PORT=8000
APP_USER="d-youtube"
INSTALL_DIR="/opt/d-youtube"
REPO_URL="https://github.com/JesusACD/d-youtube.git"
GIT_BRANCH="main"
ENABLE_SSL=false
INSTALL_NGINX=true
ACTION="deploy"  # deploy | update | uninstall | status | logs
SERVICE_NAME="d-youtube"
NGINX_CONF="/etc/nginx/sites-available/${SERVICE_NAME}"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

# --- Funciones de utilidad ---

# Imprime un mensaje con formato
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✔]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

log_error() {
    echo -e "${RED}[✘]${NC} $1"
}

log_step() {
    echo -e "\n${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}${BOLD}  ▸ $1${NC}"
    echo -e "${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Verificar que se ejecuta como root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Este script debe ejecutarse como root (usa sudo)"
        exit 1
    fi
}

# Detectar la distribución de Linux
detect_distro() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        DISTRO_ID="${ID}"
        DISTRO_NAME="${PRETTY_NAME}"
        DISTRO_VERSION="${VERSION_ID:-unknown}"
    elif command -v lsb_release &>/dev/null; then
        DISTRO_ID=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
        DISTRO_NAME=$(lsb_release -sd)
        DISTRO_VERSION=$(lsb_release -sr)
    else
        log_error "No se pudo detectar la distribución de Linux"
        exit 1
    fi

    log_info "Distribución detectada: ${BOLD}${DISTRO_NAME}${NC}"
}

# Instalar paquetes según la distribución
install_packages() {
    local packages=("$@")
    
    case "${DISTRO_ID}" in
        ubuntu|debian|linuxmint|pop)
            # Gestor de paquetes APT (Debian/Ubuntu y derivados)
            apt-get update -qq
            apt-get install -y -qq "${packages[@]}"
            ;;
        centos|rhel|rocky|almalinux|ol)
            # Gestor de paquetes YUM/DNF (Red Hat y derivados)
            if command -v dnf &>/dev/null; then
                dnf install -y -q "${packages[@]}"
            else
                yum install -y -q "${packages[@]}"
            fi
            ;;
        fedora)
            # Gestor de paquetes DNF (Fedora)
            dnf install -y -q "${packages[@]}"
            ;;
        arch|manjaro|endeavouros)
            # Gestor de paquetes Pacman (Arch y derivados)
            pacman -Syu --noconfirm --quiet "${packages[@]}"
            ;;
        opensuse*|sles)
            # Gestor de paquetes Zypper (openSUSE/SLES)
            zypper install -y -q "${packages[@]}"
            ;;
        *)
            log_error "Distribución '${DISTRO_ID}' no soportada automáticamente"
            log_warn "Instala manualmente: ${packages[*]}"
            return 1
            ;;
    esac
}

# Obtener el nombre correcto del paquete Python según la distribución
get_python_packages() {
    case "${DISTRO_ID}" in
        ubuntu|debian|linuxmint|pop)
            echo "python3 python3-pip python3-venv python3-dev"
            ;;
        centos|rhel|rocky|almalinux|ol)
            echo "python3 python3-pip python3-devel"
            ;;
        fedora)
            echo "python3 python3-pip python3-devel"
            ;;
        arch|manjaro|endeavouros)
            echo "python python-pip"
            ;;
        opensuse*|sles)
            echo "python3 python3-pip python3-devel"
            ;;
        *)
            echo "python3 python3-pip"
            ;;
    esac
}

# Obtener paquetes del sistema según la distribución
get_system_packages() {
    case "${DISTRO_ID}" in
        ubuntu|debian|linuxmint|pop)
            echo "git curl wget ffmpeg build-essential"
            ;;
        centos|rhel|rocky|almalinux|ol)
            echo "git curl wget gcc make"
            ;;
        fedora)
            echo "git curl wget ffmpeg gcc make"
            ;;
        arch|manjaro|endeavouros)
            echo "git curl wget ffmpeg base-devel"
            ;;
        opensuse*|sles)
            echo "git curl wget ffmpeg gcc make"
            ;;
        *)
            echo "git curl wget ffmpeg"
            ;;
    esac
}

# Instalar FFmpeg en distribuciones que no lo incluyen en repos oficiales
install_ffmpeg() {
    if command -v ffmpeg &>/dev/null; then
        local version
        version=$(ffmpeg -version 2>/dev/null | head -1)
        log_success "FFmpeg ya instalado: ${version}"
        return 0
    fi

    log_info "Instalando FFmpeg..."

    case "${DISTRO_ID}" in
        centos|rhel|rocky|almalinux|ol)
            # CentOS/RHEL necesitan repositorios adicionales para FFmpeg
            if ! rpm -q epel-release &>/dev/null; then
                install_packages epel-release
            fi

            # Agregar repositorio RPM Fusion para FFmpeg
            if ! rpm -q rpmfusion-free-release &>/dev/null; then
                local version_major
                version_major=$(echo "${DISTRO_VERSION}" | cut -d. -f1)
                dnf install -y "https://download1.rpmfusion.org/free/el/rpmfusion-free-release-${version_major}.noarch.rpm" 2>/dev/null || \
                yum install -y "https://download1.rpmfusion.org/free/el/rpmfusion-free-release-${version_major}.noarch.rpm" 2>/dev/null || true
            fi
            install_packages ffmpeg
            ;;
        *)
            # La mayoría de distribuciones ya incluyen FFmpeg en repos
            install_packages ffmpeg
            ;;
    esac

    # Verificar instalación exitosa
    if command -v ffmpeg &>/dev/null; then
        log_success "FFmpeg instalado correctamente"
    else
        log_warn "FFmpeg no se pudo instalar automáticamente. Instálalo manualmente."
    fi
}

# Instalar Node.js (necesario para PO Token provider de yt-dlp)
install_nodejs() {
    if command -v node &>/dev/null; then
        local version
        version=$(node --version 2>/dev/null)
        log_success "Node.js ya instalado: ${version}"
        return 0
    fi

    log_info "Instalando Node.js (requerido por yt-dlp para PO Token)..."

    case "${DISTRO_ID}" in
        ubuntu|debian|linuxmint|pop)
            # Instalar Node.js desde NodeSource (LTS)
            curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
            apt-get install -y -qq nodejs
            ;;
        centos|rhel|rocky|almalinux|ol|fedora)
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
            install_packages nodejs
            ;;
        arch|manjaro|endeavouros)
            install_packages nodejs npm
            ;;
        *)
            # Instalación genérica con nvm como fallback
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            nvm install --lts
            ;;
    esac

    if command -v node &>/dev/null; then
        log_success "Node.js instalado: $(node --version)"
    else
        log_warn "Node.js no se pudo instalar. Algunos features de yt-dlp podrían no funcionar."
    fi
}

# --- Mostrar banner del script ---
show_banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔═══════════════════════════════════════════════════════════╗"
    echo "  ║                                                           ║"
    echo "  ║     🎬  d-youtube - Script de Despliegue Automático      ║"
    echo "  ║                                                           ║"
    echo "  ║     Descargador de YouTube con interfaz web premium       ║"
    echo "  ║     FastAPI + yt-dlp + Nginx + SSL                        ║"
    echo "  ║                                                           ║"
    echo "  ╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# --- Mostrar ayuda ---
show_help() {
    show_banner
    echo -e "${BOLD}Uso:${NC}"
    echo "  sudo ./deploy.sh [OPCIONES]"
    echo ""
    echo -e "${BOLD}Opciones:${NC}"
    echo "  --domain DOMINIO     Dominio para Nginx y SSL (ej: youtube.midominio.com)"
    echo "  --port PUERTO        Puerto interno de la app (default: 8000)"
    echo "  --user USUARIO       Usuario del sistema para la app (default: d-youtube)"
    echo "  --install-dir DIR    Directorio de instalación (default: /opt/d-youtube)"
    echo "  --repo URL           URL del repositorio Git"
    echo "  --branch RAMA        Rama de Git a desplegar (default: main)"
    echo "  --ssl                Habilitar SSL con Certbot (requiere --domain)"
    echo "  --no-nginx           No instalar ni configurar Nginx"
    echo "  --update             Solo actualizar la app (git pull + reiniciar)"
    echo "  --uninstall          Desinstalar la aplicación completamente"
    echo "  --status             Mostrar estado del servicio"
    echo "  --logs               Mostrar logs en tiempo real"
    echo "  --help               Mostrar esta ayuda"
    echo ""
    echo -e "${BOLD}Ejemplos:${NC}"
    echo "  # Despliegue básico (acceso por IP:80)"
    echo "  sudo ./deploy.sh"
    echo ""
    echo "  # Despliegue con dominio y SSL"
    echo "  sudo ./deploy.sh --domain youtube.midominio.com --ssl"
    echo ""
    echo "  # Despliegue con configuración personalizada"
    echo "  sudo ./deploy.sh --domain mi.dominio.com --port 9000 --branch develop --ssl"
    echo ""
    echo "  # Actualizar aplicación existente"
    echo "  sudo ./deploy.sh --update"
    echo ""
    echo "  # Ver logs en tiempo real"
    echo "  sudo ./deploy.sh --logs"
}

# --- Parsear argumentos ---
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --port)
                APP_PORT="$2"
                shift 2
                ;;
            --user)
                APP_USER="$2"
                shift 2
                ;;
            --install-dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --repo)
                REPO_URL="$2"
                shift 2
                ;;
            --branch)
                GIT_BRANCH="$2"
                shift 2
                ;;
            --ssl)
                ENABLE_SSL=true
                shift
                ;;
            --no-nginx)
                INSTALL_NGINX=false
                shift
                ;;
            --update)
                ACTION="update"
                shift
                ;;
            --uninstall)
                ACTION="uninstall"
                shift
                ;;
            --status)
                ACTION="status"
                shift
                ;;
            --logs)
                ACTION="logs"
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Opción desconocida: $1"
                echo "Usa --help para ver las opciones disponibles."
                exit 1
                ;;
        esac
    done

    # Validar dependencia SSL -> dominio
    if [[ "${ENABLE_SSL}" == true && -z "${DOMAIN}" ]]; then
        log_error "Para habilitar SSL necesitas especificar un dominio con --domain"
        exit 1
    fi
}

# =============================================================================
# PASO 1: Instalar dependencias del sistema
# =============================================================================
step_install_dependencies() {
    log_step "Paso 1/6 — Instalando dependencias del sistema"

    detect_distro

    # Paquetes del sistema (git, curl, ffmpeg, etc.)
    local sys_packages
    sys_packages=$(get_system_packages)
    log_info "Instalando paquetes del sistema: ${sys_packages}"
    # shellcheck disable=SC2086
    install_packages ${sys_packages}
    log_success "Paquetes del sistema instalados"

    # Paquetes de Python
    local py_packages
    py_packages=$(get_python_packages)
    log_info "Instalando paquetes de Python: ${py_packages}"
    # shellcheck disable=SC2086
    install_packages ${py_packages}
    log_success "Python instalado: $(python3 --version)"

    # FFmpeg (con manejo especial para CentOS/RHEL)
    install_ffmpeg

    # Node.js (para PO Token de yt-dlp)
    install_nodejs
}

# =============================================================================
# PASO 2: Crear usuario del sistema y clonar repositorio
# =============================================================================
step_setup_project() {
    log_step "Paso 2/6 — Configurando proyecto"

    # Crear usuario del sistema si no existe
    if ! id "${APP_USER}" &>/dev/null; then
        log_info "Creando usuario del sistema: ${APP_USER}"
        useradd --system --shell /usr/sbin/nologin --home-dir "${INSTALL_DIR}" --create-home "${APP_USER}"
        log_success "Usuario '${APP_USER}' creado"
    else
        log_info "Usuario '${APP_USER}' ya existe"
    fi

    # Clonar o actualizar repositorio
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        log_info "Repositorio existente detectado, actualizando..."
        cd "${INSTALL_DIR}"
        sudo -u "${APP_USER}" git fetch --all 2>/dev/null || git fetch --all
        sudo -u "${APP_USER}" git checkout "${GIT_BRANCH}" 2>/dev/null || git checkout "${GIT_BRANCH}"
        sudo -u "${APP_USER}" git pull origin "${GIT_BRANCH}" 2>/dev/null || git pull origin "${GIT_BRANCH}"
        log_success "Repositorio actualizado (rama: ${GIT_BRANCH})"
    else
        log_info "Clonando repositorio desde ${REPO_URL}..."
        # Si el directorio existe pero no es un repo, respaldarlo
        if [[ -d "${INSTALL_DIR}" ]]; then
            local backup_dir="${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
            log_warn "Directorio ${INSTALL_DIR} existe sin repo Git. Respaldando a ${backup_dir}"
            mv "${INSTALL_DIR}" "${backup_dir}"
        fi
        git clone --branch "${GIT_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
        log_success "Repositorio clonado en ${INSTALL_DIR}"
    fi

    # Ajustar permisos del directorio
    chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}"
    log_success "Permisos configurados para ${APP_USER}"

    # Crear directorio de descargas temporales
    local temp_dir="/tmp/d-youtube_temp"
    mkdir -p "${temp_dir}"
    chown "${APP_USER}:${APP_USER}" "${temp_dir}"
    log_success "Directorio temporal de descargas creado: ${temp_dir}"
}

# =============================================================================
# PASO 3: Configurar entorno virtual y dependencias Python
# =============================================================================
step_setup_python() {
    log_step "Paso 3/6 — Configurando entorno virtual Python"

    cd "${INSTALL_DIR}"

    # Crear entorno virtual si no existe
    if [[ ! -d "${INSTALL_DIR}/venv" ]]; then
        log_info "Creando entorno virtual..."
        sudo -u "${APP_USER}" python3 -m venv "${INSTALL_DIR}/venv"
        log_success "Entorno virtual creado"
    else
        log_info "Entorno virtual existente detectado"
    fi

    # Actualizar pip y instalar dependencias
    log_info "Instalando dependencias de Python..."
    sudo -u "${APP_USER}" "${INSTALL_DIR}/venv/bin/pip" install --upgrade pip --quiet
    sudo -u "${APP_USER}" "${INSTALL_DIR}/venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt" --quiet

    # Actualizar yt-dlp a la última versión (importante para evitar bloqueos de YouTube)
    log_info "Actualizando yt-dlp a la última versión..."
    sudo -u "${APP_USER}" "${INSTALL_DIR}/venv/bin/pip" install --upgrade yt-dlp --quiet

    log_success "Dependencias Python instaladas"
    log_info "yt-dlp versión: $(sudo -u "${APP_USER}" "${INSTALL_DIR}/venv/bin/pip" show yt-dlp 2>/dev/null | grep Version | awk '{print $2}')"
}

# =============================================================================
# PASO 4: Crear servicio systemd
# =============================================================================
step_setup_systemd() {
    log_step "Paso 4/6 — Configurando servicio systemd"

    # Crear archivo de configuración del servidor para modo Linux
    # (sin pywebview, solo uvicorn puro)
    local server_wrapper="${INSTALL_DIR}/start_server.sh"
    cat > "${server_wrapper}" << WRAPPER_EOF
#!/usr/bin/env bash
# Script de inicio para d-youtube en modo servidor (sin interfaz gráfica)
# Generado automáticamente por deploy.sh

cd "${INSTALL_DIR}"
source "${INSTALL_DIR}/venv/bin/activate"
exec python3 -c "
import uvicorn
from server import app

# Ejecutar el servidor FastAPI directamente (sin pywebview)
uvicorn.run(
    app,
    host='127.0.0.1',
    port=${APP_PORT},
    log_level='info',
    access_log=True,
    workers=1
)
"
WRAPPER_EOF

    chown "${APP_USER}:${APP_USER}" "${server_wrapper}"
    chmod +x "${server_wrapper}"

    # Crear unidad systemd
    log_info "Creando servicio systemd: ${SERVICE_NAME}"

    cat > "${SYSTEMD_UNIT}" << SYSTEMD_EOF
[Unit]
Description=${APP_DESCRIPTION}
Documentation=https://github.com/JesusACD/d-youtube
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/bin/bash ${server_wrapper}
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

# Variables de entorno
Environment=PYTHONUNBUFFERED=1
Environment=HOME=${INSTALL_DIR}
Environment=PATH=${INSTALL_DIR}/venv/bin:/usr/local/bin:/usr/bin:/bin

# Limitar recursos para seguridad
LimitNOFILE=65535
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR} /tmp/d-youtube_temp

# Logs a journald
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

    # Recargar systemd y habilitar el servicio
    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}"
    systemctl restart "${SERVICE_NAME}"

    # Esperar un momento y verificar estado
    sleep 3
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
        log_success "Servicio ${SERVICE_NAME} iniciado correctamente"
        log_info "Puerto interno: ${APP_PORT}"
    else
        log_error "El servicio no arrancó correctamente. Revisando logs..."
        journalctl -u "${SERVICE_NAME}" -n 20 --no-pager
        exit 1
    fi
}

# =============================================================================
# PASO 5: Configurar Nginx como proxy reverso
# =============================================================================
step_setup_nginx() {
    if [[ "${INSTALL_NGINX}" != true ]]; then
        log_info "Nginx omitido (--no-nginx especificado)"
        return 0
    fi

    log_step "Paso 5/6 — Configurando Nginx como proxy reverso"

    # Instalar Nginx si no está presente
    if ! command -v nginx &>/dev/null; then
        log_info "Instalando Nginx..."
        install_packages nginx
    fi

    # Determinar el nombre del servidor en la configuración Nginx
    local server_name="_"  # Acepta cualquier dominio/IP por defecto
    if [[ -n "${DOMAIN}" ]]; then
        server_name="${DOMAIN}"
    fi

    # Crear configuración de Nginx
    log_info "Generando configuración de Nginx..."

    cat > "${NGINX_CONF}" << NGINX_EOF
# Configuración Nginx para d-youtube
# Generado automáticamente por deploy.sh el $(date '+%Y-%m-%d %H:%M:%S')

# Limitar tasa de peticiones para proteger contra abuso
limit_req_zone \$binary_remote_addr zone=d_youtube_limit:10m rate=10r/s;

upstream d_youtube_backend {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${server_name};

    # Tamaño máximo de solicitud (500MB para descargas grandes)
    client_max_body_size 500M;

    # Timeouts extendidos para descargas largas
    proxy_read_timeout 600s;
    proxy_connect_timeout 60s;
    proxy_send_timeout 600s;

    # Cabeceras de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logs
    access_log /var/log/nginx/${SERVICE_NAME}_access.log;
    error_log /var/log/nginx/${SERVICE_NAME}_error.log;

    # Comprimir respuestas (mejora la velocidad de carga)
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # Archivos estáticos (servidos directamente por Nginx, sin pasar por Python)
    location /static/ {
        alias ${INSTALL_DIR}/static/;
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # WebSocket para progreso en tiempo real
    location /ws/ {
        limit_req zone=d_youtube_limit burst=20 nodelay;

        proxy_pass http://d_youtube_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Timeout extendido para WebSocket
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # API y frontend (proxy reverso a FastAPI)
    location / {
        limit_req zone=d_youtube_limit burst=30 nodelay;

        proxy_pass http://d_youtube_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";

        # Buffering para mejorar rendimiento
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
    }
}
NGINX_EOF

    # Habilitar el sitio en Nginx
    local sites_enabled="/etc/nginx/sites-enabled"
    if [[ -d "${sites_enabled}" ]]; then
        # Distribuciones Debian/Ubuntu usan sites-available/sites-enabled
        # Eliminar default si existe y es el primer despliegue
        if [[ -L "${sites_enabled}/default" ]]; then
            rm -f "${sites_enabled}/default"
            log_info "Sitio default de Nginx deshabilitado"
        fi

        # Crear enlace simbólico
        ln -sf "${NGINX_CONF}" "${sites_enabled}/${SERVICE_NAME}"
    else
        # CentOS/Fedora/Arch usan conf.d/
        local conf_dir="/etc/nginx/conf.d"
        mkdir -p "${conf_dir}"
        cp "${NGINX_CONF}" "${conf_dir}/${SERVICE_NAME}.conf"
    fi

    # Verificar y reiniciar Nginx
    if nginx -t 2>/dev/null; then
        systemctl enable nginx
        systemctl restart nginx
        log_success "Nginx configurado y reiniciado"
    else
        log_error "Error en la configuración de Nginx:"
        nginx -t
        exit 1
    fi
}

# =============================================================================
# PASO 6: Configurar SSL con Certbot (opcional)
# =============================================================================
step_setup_ssl() {
    if [[ "${ENABLE_SSL}" != true ]]; then
        log_info "SSL omitido (usa --ssl --domain tudominio.com para habilitarlo)"
        return 0
    fi

    log_step "Paso 6/6 — Configurando SSL con Certbot"

    # Instalar Certbot
    if ! command -v certbot &>/dev/null; then
        log_info "Instalando Certbot..."
        case "${DISTRO_ID}" in
            ubuntu|debian|linuxmint|pop)
                install_packages certbot python3-certbot-nginx
                ;;
            centos|rhel|rocky|almalinux|ol|fedora)
                install_packages certbot python3-certbot-nginx
                ;;
            arch|manjaro|endeavouros)
                install_packages certbot certbot-nginx
                ;;
            *)
                install_packages certbot python3-certbot-nginx
                ;;
        esac
    fi

    # Obtener certificado SSL
    log_info "Obteniendo certificado SSL para ${DOMAIN}..."
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect \
        --email "admin@${DOMAIN}" || {
        log_warn "Certbot falló. Asegúrate de que:"
        log_warn "  1. El dominio ${DOMAIN} apunta a la IP de este servidor"
        log_warn "  2. El puerto 80 está abierto en el firewall"
        log_warn "  Puedes volver a intentar con: sudo certbot --nginx -d ${DOMAIN}"
        return 1
    }

    # Configurar renovación automática
    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
        log_success "Renovación automática de SSL configurada (3:00 AM diario)"
    fi

    log_success "SSL configurado correctamente para ${DOMAIN}"
}

# =============================================================================
# Configurar Firewall (UFW)
# =============================================================================
step_setup_firewall() {
    log_info "Configurando firewall..."

    if command -v ufw &>/dev/null; then
        # UFW (Ubuntu/Debian)
        ufw allow ssh 2>/dev/null || true
        ufw allow 'Nginx Full' 2>/dev/null || ufw allow 80/tcp 2>/dev/null && ufw allow 443/tcp 2>/dev/null || true
        
        # Habilitar UFW si no está activo (sin interacción)
        if ! ufw status | grep -q "active"; then
            echo "y" | ufw enable 2>/dev/null || true
        fi
        log_success "Firewall UFW configurado (SSH + HTTP + HTTPS)"

    elif command -v firewall-cmd &>/dev/null; then
        # Firewalld (CentOS/Fedora)
        firewall-cmd --permanent --add-service=http 2>/dev/null || true
        firewall-cmd --permanent --add-service=https 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        log_success "Firewall firewalld configurado (HTTP + HTTPS)"
    else
        log_warn "No se detectó firewall (ufw/firewalld). Configura manualmente si es necesario."
    fi
}

# =============================================================================
# Resumen final
# =============================================================================
show_summary() {
    local access_url
    if [[ -n "${DOMAIN}" ]]; then
        if [[ "${ENABLE_SSL}" == true ]]; then
            access_url="https://${DOMAIN}"
        else
            access_url="http://${DOMAIN}"
        fi
    else
        # Obtener IP pública del servidor
        local public_ip
        public_ip=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || \
                    curl -s --max-time 5 https://ifconfig.me 2>/dev/null || \
                    hostname -I 2>/dev/null | awk '{print $1}' || \
                    echo "TU_IP")
        access_url="http://${public_ip}"
    fi

    echo ""
    echo -e "${GREEN}${BOLD}"
    echo "  ╔═══════════════════════════════════════════════════════════╗"
    echo "  ║                                                           ║"
    echo "  ║     ✅  ¡Despliegue completado exitosamente!             ║"
    echo "  ║                                                           ║"
    echo "  ╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "  ${BOLD}🌐 Accede a la app:${NC}    ${CYAN}${access_url}${NC}"
    echo -e "  ${BOLD}📂 Instalación:${NC}       ${INSTALL_DIR}"
    echo -e "  ${BOLD}👤 Usuario:${NC}           ${APP_USER}"
    echo -e "  ${BOLD}🔌 Puerto interno:${NC}    ${APP_PORT}"
    if [[ -n "${DOMAIN}" ]]; then
        echo -e "  ${BOLD}🌍 Dominio:${NC}           ${DOMAIN}"
    fi
    if [[ "${ENABLE_SSL}" == true ]]; then
        echo -e "  ${BOLD}🔒 SSL:${NC}               Habilitado (auto-renovación)"
    fi
    echo ""
    echo -e "  ${BOLD}Comandos útiles:${NC}"
    echo -e "    ${YELLOW}sudo systemctl status ${SERVICE_NAME}${NC}    — Estado del servicio"
    echo -e "    ${YELLOW}sudo systemctl restart ${SERVICE_NAME}${NC}   — Reiniciar"
    echo -e "    ${YELLOW}sudo systemctl stop ${SERVICE_NAME}${NC}      — Detener"
    echo -e "    ${YELLOW}sudo journalctl -u ${SERVICE_NAME} -f${NC}    — Ver logs"
    echo -e "    ${YELLOW}sudo ./deploy.sh --update${NC}                — Actualizar app"
    echo -e "    ${YELLOW}sudo ./deploy.sh --logs${NC}                  — Logs en tiempo real"
    echo ""
}

# =============================================================================
# Acción: Actualizar aplicación
# =============================================================================
do_update() {
    show_banner
    log_step "Actualizando aplicación"

    check_root
    detect_distro

    if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
        log_error "No se encontró instalación en ${INSTALL_DIR}"
        exit 1
    fi

    cd "${INSTALL_DIR}"

    # Guardar estado actual
    local current_commit
    current_commit=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    log_info "Commit actual: ${current_commit}"

    # Actualizar código fuente
    log_info "Descargando últimos cambios..."
    sudo -u "${APP_USER}" git fetch --all 2>/dev/null || git fetch --all
    sudo -u "${APP_USER}" git pull origin "${GIT_BRANCH}" 2>/dev/null || git pull origin "${GIT_BRANCH}"

    local new_commit
    new_commit=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    log_info "Nuevo commit: ${new_commit}"

    # Actualizar dependencias si requirements.txt cambió
    if git diff "${current_commit}..${new_commit}" --name-only 2>/dev/null | grep -q "requirements.txt"; then
        log_info "requirements.txt cambió, actualizando dependencias..."
        sudo -u "${APP_USER}" "${INSTALL_DIR}/venv/bin/pip" install -r requirements.txt --quiet
    fi

    # Siempre actualizar yt-dlp (versión nueva puede resolver bloqueos)
    log_info "Actualizando yt-dlp..."
    sudo -u "${APP_USER}" "${INSTALL_DIR}/venv/bin/pip" install --upgrade yt-dlp --quiet

    # Reiniciar servicio
    systemctl restart "${SERVICE_NAME}"
    sleep 2

    if systemctl is-active --quiet "${SERVICE_NAME}"; then
        log_success "Aplicación actualizada y reiniciada (${current_commit} → ${new_commit})"
    else
        log_error "Error al reiniciar. Verificando logs..."
        journalctl -u "${SERVICE_NAME}" -n 15 --no-pager
    fi
}

# =============================================================================
# Acción: Desinstalar
# =============================================================================
do_uninstall() {
    show_banner

    check_root

    echo -e "${RED}${BOLD}"
    echo "  ⚠️  ADVERTENCIA: Esto eliminará completamente d-youtube del servidor."
    echo -e "${NC}"
    read -rp "  ¿Estás seguro? Escribe 'SI' para confirmar: " confirm
    
    if [[ "${confirm}" != "SI" ]]; then
        log_info "Desinstalación cancelada"
        exit 0
    fi

    log_step "Desinstalando ${APP_NAME}"

    # Detener y deshabilitar servicio
    if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        systemctl stop "${SERVICE_NAME}"
        log_info "Servicio detenido"
    fi

    if [[ -f "${SYSTEMD_UNIT}" ]]; then
        systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
        rm -f "${SYSTEMD_UNIT}"
        systemctl daemon-reload
        log_info "Servicio systemd eliminado"
    fi

    # Eliminar configuración de Nginx
    if [[ -f "${NGINX_CONF}" ]]; then
        rm -f "${NGINX_CONF}"
        rm -f "/etc/nginx/sites-enabled/${SERVICE_NAME}"
        rm -f "/etc/nginx/conf.d/${SERVICE_NAME}.conf"
        nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
        log_info "Configuración de Nginx eliminada"
    fi

    # Eliminar directorio de instalación
    if [[ -d "${INSTALL_DIR}" ]]; then
        rm -rf "${INSTALL_DIR}"
        log_info "Directorio ${INSTALL_DIR} eliminado"
    fi

    # Eliminar directorio temporal
    rm -rf /tmp/d-youtube_temp

    # Eliminar usuario del sistema (no elimina si tiene otros procesos)
    if id "${APP_USER}" &>/dev/null; then
        userdel "${APP_USER}" 2>/dev/null || true
        log_info "Usuario ${APP_USER} eliminado"
    fi

    echo ""
    log_success "d-youtube desinstalado completamente"
}

# =============================================================================
# Acción: Mostrar estado
# =============================================================================
do_status() {
    show_banner

    echo -e "${BOLD}Estado del servicio:${NC}"
    echo ""
    systemctl status "${SERVICE_NAME}" --no-pager 2>/dev/null || log_warn "Servicio no encontrado"

    echo ""
    echo -e "${BOLD}Uso de recursos:${NC}"
    if pgrep -f "server.py" &>/dev/null; then
        ps aux | head -1
        ps aux | grep "[s]erver.py"
    else
        log_warn "Proceso no encontrado"
    fi

    echo ""
    echo -e "${BOLD}Espacio en disco:${NC}"
    if [[ -d "${INSTALL_DIR}" ]]; then
        du -sh "${INSTALL_DIR}" 2>/dev/null
    fi
    du -sh /tmp/d-youtube_temp 2>/dev/null || echo "  (sin descargas temporales)"

    echo ""
    echo -e "${BOLD}Nginx:${NC}"
    systemctl is-active nginx 2>/dev/null && echo "  Nginx: activo" || echo "  Nginx: inactivo"

    echo ""
    echo -e "${BOLD}Puertos en uso:${NC}"
    ss -tlnp 2>/dev/null | grep -E "(${APP_PORT}|80|443)" || netstat -tlnp 2>/dev/null | grep -E "(${APP_PORT}|80|443)" || true
}

# =============================================================================
# Acción: Mostrar logs
# =============================================================================
do_logs() {
    echo -e "${CYAN}Mostrando logs de ${SERVICE_NAME} (Ctrl+C para salir)...${NC}"
    echo ""
    journalctl -u "${SERVICE_NAME}" -f --no-pager
}

# =============================================================================
# FLUJO PRINCIPAL
# =============================================================================
main() {
    parse_args "$@"

    case "${ACTION}" in
        deploy)
            show_banner
            check_root

            log_info "Modo: ${BOLD}Despliegue completo${NC}"
            log_info "Repositorio: ${REPO_URL}"
            log_info "Rama: ${GIT_BRANCH}"
            log_info "Directorio: ${INSTALL_DIR}"
            if [[ -n "${DOMAIN}" ]]; then
                log_info "Dominio: ${DOMAIN}"
            fi
            echo ""

            step_install_dependencies
            step_setup_project
            step_setup_python
            step_setup_systemd
            step_setup_nginx
            step_setup_ssl
            step_setup_firewall

            show_summary
            ;;
        update)
            do_update
            ;;
        uninstall)
            do_uninstall
            ;;
        status)
            do_status
            ;;
        logs)
            do_logs
            ;;
    esac
}

# Ejecutar flujo principal
main "$@"
