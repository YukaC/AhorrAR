#!/usr/bin/env bash
# Bootstrap OCI VM.Standard.E2.1.Micro: swap, Docker, GHCR pull, Caddy, anti-idle.
# Usage: ./scripts/oci-bootstrap-micro.sh <PUBLIC_IP> [/path/to/env]
set -euo pipefail

PUBLIC_IP="${1:?public ip}"
ENV_FILE="${2:-/tmp/ahorrar-oci-micro.env}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oci_ahorrar}"
SSH_USER="${SSH_USER:-ubuntu}"
REPO_URL="${REPO_URL:-https://github.com/YukaC/AhorrAR.git}"
DOMAIN="${PUBLIC_IP}.sslip.io"
COMPOSE_FILE="docker-compose.micro.yml"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "missing SSH key: $SSH_KEY" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE (copy deploy/oci/.env.micro.example and fill secrets)" >&2
  exit 1
fi

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "${SSH_USER}@${PUBLIC_IP}")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

echo "[bootstrap-micro] waiting for SSH…"
for i in $(seq 1 60); do
  if "${SSH[@]}" 'echo ok' >/dev/null 2>&1; then
    break
  fi
  sleep 5
  if [[ "$i" -eq 60 ]]; then
    echo "SSH never came up on ${PUBLIC_IP}" >&2
    exit 1
  fi
done

echo "[bootstrap-micro] swap 2G (if missing) + docker + clone"
"${SSH[@]}" "sudo bash -s" <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl

if ! swapon --show 2>/dev/null | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    echo "[bootstrap-micro] creating /swapfile (2G)"
    if fallocate -l 2G /swapfile 2>/dev/null; then
      :
    else
      dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
    fi
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "[bootstrap-micro] swap already active"
fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin
fi
systemctl enable --now docker

mkdir -p /opt/ahorrar
if [[ ! -d /opt/ahorrar/.git ]]; then
  git clone '${REPO_URL}' /opt/ahorrar
else
  git -C /opt/ahorrar pull --ff-only || true
fi
REMOTE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[bootstrap-micro] upload .env (DOMAIN=${DOMAIN}, API_UPSTREAM=api:4000)"
TMP_ENV=$(mktemp)
python3 - "$ENV_FILE" "$TMP_ENV" "$DOMAIN" <<'PY'
import sys
src, dst, domain = sys.argv[1], sys.argv[2], sys.argv[3]
lines = []
for line in open(src):
  if line.startswith('DOMAIN='):
    lines.append(f'DOMAIN={domain}\n')
  elif line.startswith('API_UPSTREAM='):
    lines.append('API_UPSTREAM=api:4000\n')
  else:
    lines.append(line)
open(dst, 'w').writelines(lines)
PY
chmod 600 "$TMP_ENV"
"${SSH[@]}" 'sudo mkdir -p /opt/ahorrar/deploy/oci /opt/ahorrar/scripts && sudo chown -R '"${SSH_USER}"':'"${SSH_USER}"' /opt/ahorrar'
"${SCP[@]}" "$TMP_ENV" "${SSH_USER}@${PUBLIC_IP}:/opt/ahorrar/deploy/oci/.env"
rm -f "$TMP_ENV"

# Sync Micro compose/Caddy/smoke from laptop so bootstrap works before files land on main.
echo "[bootstrap-micro] sync local Micro deploy artifacts + build context essentials"
"${SCP[@]}" \
  "${ROOT}/deploy/oci/${COMPOSE_FILE}" \
  "${ROOT}/deploy/oci/Caddyfile" \
  "${ROOT}/deploy/oci/.env.micro.example" \
  "${SSH_USER}@${PUBLIC_IP}:/opt/ahorrar/deploy/oci/"
"${SCP[@]}" \
  "${ROOT}/scripts/oci-micro-smoke.sh" \
  "${ROOT}/scripts/oci-anti-idle.sh" \
  "${ROOT}/scripts/docker-entrypoint.sh" \
  "${SSH_USER}@${PUBLIC_IP}:/opt/ahorrar/scripts/"
"${SCP[@]}" \
  "${ROOT}/Dockerfile" \
  "${SSH_USER}@${PUBLIC_IP}:/opt/ahorrar/Dockerfile"

echo "[bootstrap-micro] docker compose pull + up (no build preferred)"
"${SSH[@]}" "sudo bash -s" <<REMOTE
set -euo pipefail
cd /opt/ahorrar/deploy/oci
if sudo docker compose -f ${COMPOSE_FILE} --profile caddy pull; then
  echo "[bootstrap-micro] GHCR pull ok"
else
  echo "[bootstrap-micro] GHCR pull failed — one-shot native build on Micro (amd64)"
  sudo docker build -t ghcr.io/yukac/ahorrar-api:micro /opt/ahorrar
fi
sudo docker compose -f ${COMPOSE_FILE} --profile caddy up -d
REMOTE

echo "[bootstrap-micro] anti-idle cron every 4h"
"${SSH[@]}" "sudo bash -s" <<'REMOTE'
set -euo pipefail
chmod +x /opt/ahorrar/scripts/oci-anti-idle.sh /opt/ahorrar/scripts/oci-micro-smoke.sh
cron_line='0 */4 * * * API_HEALTH_URL=http://127.0.0.1:4000/api/health /opt/ahorrar/scripts/oci-anti-idle.sh >> /var/log/ahorrar-anti-idle.log 2>&1'
(crontab -l 2>/dev/null | grep -v oci-anti-idle.sh; echo "$cron_line") | crontab -
REMOTE

echo "[bootstrap-micro] smoke health"
sleep 5
"${SSH[@]}" '/opt/ahorrar/scripts/oci-micro-smoke.sh'
"${SSH[@]}" "DOMAIN=${DOMAIN} /opt/ahorrar/scripts/oci-micro-smoke.sh" || echo "(HTTPS may need ~60s for cert; retry on VM: DOMAIN=${DOMAIN} ./scripts/oci-micro-smoke.sh)"

echo
echo "DONE (Micro)"
echo "  API: https://${DOMAIN}"
echo "  Vercel Production:"
echo "    VITE_API_BASE=https://${DOMAIN}"
echo "    VITE_FREE_HOST=1"
