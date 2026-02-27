#!/usr/bin/env bash
set -euo pipefail

REPO_URL_DEFAULT="https://github.com/crossatko/security-cameras-dashboard.git"
APP_DIR_DEFAULT="/opt/security-cameras-dashboard"
APP_URL_DEFAULT="http://127.0.0.1:3000"

REPO_URL="${REPO_URL:-$REPO_URL_DEFAULT}"
APP_DIR="${APP_DIR:-$APP_DIR_DEFAULT}"
APP_URL="${APP_URL:-$APP_URL_DEFAULT}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Run as root (use sudo)." >&2
  exit 1
fi

KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-}}"
if [[ -z "${KIOSK_USER}" ]]; then
  echo "ERROR: KIOSK_USER not set. Run via sudo or set KIOSK_USER=<user>." >&2
  exit 1
fi

if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  echo "ERROR: KIOSK_USER '${KIOSK_USER}' does not exist." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing OS packages"
apt update -y
apt install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  gnupg \
  lsb-release \
  apt-transport-https \
  dbus-user-session \
  cage \
  seatd \
  fonts-noto \
  xdg-utils

echo "==> Installing base graphics deps (Wayland/GBM)"
apt install -y --no-install-recommends \
  libgbm1 \
  libdrm2 \
  libnss3 \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libxkbcommon0 \
  libgl1

# Audio libs: Ubuntu releases may use either the classic or the t64 package.
# Chrome will pull the correct dependency, but we install it explicitly to fail early.
echo "==> Installing audio library"
apt install -y --no-install-recommends libasound2t64 || apt install -y --no-install-recommends libasound2

echo "==> Installing Docker Engine + docker compose plugin"
install -m 0755 -d /etc/apt/keyrings

if [[ ! -f /etc/os-release ]]; then
  echo "ERROR: /etc/os-release missing; unsupported system." >&2
  exit 1
fi

. /etc/os-release

if [[ "${ID}" != "ubuntu" ]]; then
  echo "ERROR: Unsupported distro ID='${ID}'. This installer supports Ubuntu only." >&2
  exit 1
fi

curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} \
  ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt update -y
apt install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

systemctl enable --now docker
usermod -aG docker "${KIOSK_USER}"

echo "==> Installing Google Chrome (for kiosk/app mode)"
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
chmod a+r /etc/apt/keyrings/google-chrome.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
  > /etc/apt/sources.list.d/google-chrome.list
apt update -y
apt install -y --no-install-recommends google-chrome-stable

echo "==> Enabling seatd"
systemctl enable --now seatd
usermod -aG seat "${KIOSK_USER}" || true
usermod -aG video "${KIOSK_USER}" || true
usermod -aG render "${KIOSK_USER}" || true
usermod -aG input "${KIOSK_USER}" || true

echo "==> Cloning/updating app repo"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" reset --hard origin/HEAD
else
  rm -rf "${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
fi

mkdir -p "${APP_DIR}/data"
chown -R "${KIOSK_USER}:${KIOSK_USER}" "${APP_DIR}"

echo "==> Creating systemd service: app (docker compose)"
cat > /etc/systemd/system/security-cameras-dashboard.service <<EOF
[Unit]
Description=Security Cameras Dashboard (docker compose)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/docker compose up --build
ExecStop=/usr/bin/docker compose down
Restart=always
RestartSec=2
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "==> Creating systemd service: kiosk (cage + chrome)"
cat > /etc/systemd/system/security-cameras-kiosk.service <<EOF
[Unit]
Description=Security Cameras Kiosk (cage + chrome)
After=security-cameras-dashboard.service seatd.service network-online.target
Wants=security-cameras-dashboard.service network-online.target

[Service]
User=${KIOSK_USER}
Environment=APP_URL=${APP_URL}
Environment=HOME=/home/${KIOSK_USER}
Environment=XDG_RUNTIME_DIR=/run/user/%U
Environment=XDG_SESSION_TYPE=wayland
Environment=MOZ_ENABLE_WAYLAND=1
Environment=NO_AT_BRIDGE=1
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal
Restart=always
RestartSec=2

ExecStart=/usr/bin/seatd-launch /usr/bin/cage -s -- \
  /usr/bin/google-chrome-stable \
  --app=${APP_URL} \
  --kiosk \
  --no-first-run \
  --disable-infobars \
  --disable-features=TranslateUI \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --disable-session-crashed-bubble \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --user-data-dir=/home/${KIOSK_USER}/.cache/security-cameras-dashboard/chrome

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now security-cameras-dashboard.service
systemctl enable --now security-cameras-kiosk.service

echo
echo "Installed."
echo "- App URL: ${APP_URL}"
echo "- App dir: ${APP_DIR}"
echo "- Kiosk runs on tty1 (Ctrl+Alt+F1)."
echo "- Note: you may need to log out/in for docker group changes to apply for ${KIOSK_USER}."
