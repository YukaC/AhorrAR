#!/usr/bin/env bash
# Idempotent bootstrap for Oracle Cloud Always Free ARM (Ubuntu/Debian-ish).
# Run once as root or with sudo: curl -fsSL ... | bash   OR   sudo ./setup-vm.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ahorrar}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "setup-vm.sh expects apt-get (Ubuntu/Debian on OCI)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup-vm] installing Docker Engine…"
  curl -fsSL https://get.docker.com | sh
else
  echo "[setup-vm] docker already installed"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[setup-vm] installing docker-compose-plugin…"
  apt-get install -y -qq docker-compose-plugin
else
  echo "[setup-vm] docker compose plugin already available"
fi

systemctl enable docker
systemctl start docker

mkdir -p "${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
  echo "[setup-vm] clone the repo into ${APP_DIR} (git clone … ${APP_DIR}) before docker compose up"
else
  echo "[setup-vm] repo present at ${APP_DIR}"
fi

echo "[setup-vm] done. Next:"
echo "  1) cd ${APP_DIR} && git pull"
echo "  2) cp deploy/oci/.env.example deploy/oci/.env && edit secrets"
echo "  3) cd deploy/oci && docker compose up -d --build"
echo "  4) set DOMAIN in deploy/oci/.env (e.g. PUBLIC_IP.sslip.io), then: docker compose --profile caddy up -d"
