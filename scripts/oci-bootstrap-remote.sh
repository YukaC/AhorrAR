#!/usr/bin/env bash
# After VM has public IP: bootstrap Docker + clone + .env + compose + anti-idle cron.
# Usage: ./scripts/oci-bootstrap-remote.sh <PUBLIC_IP> [/path/to/oci.env]
set -euo pipefail

PUBLIC_IP="${1:?public ip}"
ENV_FILE="${2:-/tmp/ahorrar-oci.env}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oci_ahorrar}"
SSH_USER="${SSH_USER:-ubuntu}"
REPO_URL="${REPO_URL:-https://github.com/YukaC/AhorrAR.git}"
DOMAIN="${PUBLIC_IP}.sslip.io"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "missing SSH key: $SSH_KEY" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE (run scripts/oci-make-env.sh first)" >&2
  exit 1
fi

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "${SSH_USER}@${PUBLIC_IP}")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

echo "[bootstrap] waiting for SSH…"
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

echo "[bootstrap] install docker + clone"
"${SSH[@]}" "sudo bash -s" <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
mkdir -p /opt/ahorrar
if [[ ! -d /opt/ahorrar/.git ]]; then
  git clone '${REPO_URL}' /opt/ahorrar
else
  git -C /opt/ahorrar pull --ff-only || true
fi
REMOTE

echo "[bootstrap] upload .env (DOMAIN=${DOMAIN})"
# Patch DOMAIN into a temp copy without echoing secrets
TMP_ENV=$(mktemp)
python3 - "$ENV_FILE" "$TMP_ENV" "$DOMAIN" <<'PY'
import sys
src, dst, domain = sys.argv[1], sys.argv[2], sys.argv[3]
lines=[]
for line in open(src):
  if line.startswith('DOMAIN='):
    lines.append(f'DOMAIN={domain}\n')
  elif line.startswith('API_UPSTREAM='):
    lines.append('API_UPSTREAM=api:4000\n')
  else:
    lines.append(line)
open(dst,'w').writelines(lines)
PY
chmod 600 "$TMP_ENV"
"${SSH[@]}" 'sudo mkdir -p /opt/ahorrar/deploy/oci && sudo chown -R '"${SSH_USER}"':'"${SSH_USER}"' /opt/ahorrar'
"${SCP[@]}" "$TMP_ENV" "${SSH_USER}@${PUBLIC_IP}:/opt/ahorrar/deploy/oci/.env"
rm -f "$TMP_ENV"

echo "[bootstrap] docker compose up (api + caddy)"
"${SSH[@]}" "cd /opt/ahorrar/deploy/oci && sudo docker compose --profile caddy up -d --build"

echo "[bootstrap] anti-idle cron every 6h"
"${SSH[@]}" "sudo bash -s" <<'REMOTE'
set -euo pipefail
chmod +x /opt/ahorrar/scripts/oci-anti-idle.sh
cron_line='0 */6 * * * API_HEALTH_URL=http://127.0.0.1:4000/api/health /opt/ahorrar/scripts/oci-anti-idle.sh >> /var/log/ahorrar-anti-idle.log 2>&1'
(crontab -l 2>/dev/null | grep -v oci-anti-idle.sh; echo "$cron_line") | crontab -
REMOTE

echo "[bootstrap] health checks"
sleep 5
"${SSH[@]}" 'curl -fsS http://127.0.0.1:4000/api/health && echo'
curl -fsS --max-time 30 "https://${DOMAIN}/api/health" && echo || echo "(HTTPS may need ~60s for cert)"

echo
echo "DONE"
echo "  API: https://${DOMAIN}"
echo "  Vercel Production:"
echo "    VITE_API_BASE=https://${DOMAIN}"
echo "    VITE_FREE_HOST=0"
