#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Run as root (use sudo)." >&2
  exit 1
fi

KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-}}"

echo "==> Stopping app and kiosk services..."
systemctl stop security-cameras-kiosk.service || true
systemctl stop security-cameras-dashboard.service || true

echo "==> Disabling autostart for services..."
systemctl disable security-cameras-kiosk.service || true
systemctl disable security-cameras-dashboard.service || true

echo "==> Removing systemd service files (Configs)..."
rm -f /etc/systemd/system/security-cameras-kiosk.service
rm -f /etc/systemd/system/security-cameras-dashboard.service

echo "==> Reloading systemd daemon..."
systemctl daemon-reload
systemctl reset-failed

echo "==> Restoring default terminal login (getty) on TTY1..."
systemctl enable getty@tty1.service || true
systemctl start getty@tty1.service || true

APP_DIR="/opt/security-cameras-dashboard"
if [[ -d "${APP_DIR}" ]]; then
  echo "==> Shutting down Docker containers..."
  if command -v docker >/dev/null 2>&1; then
    docker compose -f "${APP_DIR}/docker-compose.yml" down -v 2>/dev/null || true
  fi
  echo "==> Deleting the application directory..."
  rm -rf "${APP_DIR}"
fi

if [[ -n "${KIOSK_USER}" ]]; then
  echo "==> Wiping Chrome browser cache/state..."
  rm -rf "/home/${KIOSK_USER}/.cache/security-cameras-dashboard"
fi

echo
echo "=========================================="
echo "             DESTROY COMPLETE             "
echo "=========================================="
echo "Services, systemd configs, app repo, and Chrome cache are GONE."
echo "Your TTY1 login prompt should be restored."
