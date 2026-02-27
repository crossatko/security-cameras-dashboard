#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Run as root (use sudo)." >&2
  exit 1
fi

echo "==> Stopping app and kiosk services..."
systemctl stop security-cameras-kiosk.service || true
systemctl stop security-cameras-dashboard.service || true

echo "==> Disabling autostart for services..."
systemctl disable security-cameras-kiosk.service || true
systemctl disable security-cameras-dashboard.service || true

echo "==> Removing systemd service files..."
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
  echo "==> Ensuring Docker containers are completely shut down..."
  # If the service stop didn't catch it, manually spin down the compose stack
  if command -v docker >/dev/null 2>&1; then
    docker compose -f "${APP_DIR}/docker-compose.yml" down 2>/dev/null || true
  fi
fi

echo
echo "=========================================="
echo "             DESTROY COMPLETE             "
echo "=========================================="
echo "All kiosk and dashboard services have been stopped and removed."
echo "Your TTY1 login prompt should be restored."
