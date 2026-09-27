#!/usr/bin/env bash
# On the Micro VM: pull latest GHCR image and recreate api+caddy (no build).
# Usage (on VM): sudo ./scripts/oci-micro-pull.sh
# Or via CI SSH after docker-ghcr.yml push.
set -euo pipefail

ROOT="${AHORRAR_ROOT:-/opt/ahorrar}"
COMPOSE_DIR="${ROOT}/deploy/oci"
COMPOSE_FILE="docker-compose.micro.yml"
IMAGE="${AHORRAR_IMAGE:-ghcr.io/yukac/ahorrar-api:micro}"

cd "$COMPOSE_DIR"

# Optional: refresh compose/scripts from git (never overwrite .env).
if [[ -d "$ROOT/.git" ]] && [[ "${AHORRAR_GIT_PULL:-1}" == "1" ]]; then
  git -C "$ROOT" fetch --depth 1 origin main 2>/dev/null || true
  git -C "$ROOT" checkout -f origin/main -- \
    deploy/oci/docker-compose.micro.yml \
    deploy/oci/Caddyfile \
    scripts/oci-micro-pull.sh \
    scripts/oci-micro-smoke.sh \
    scripts/oci-anti-idle.sh 2>/dev/null || true
fi

echo "[micro-pull] pulling ${IMAGE}"
docker compose -f "$COMPOSE_FILE" --profile caddy pull

echo "[micro-pull] up -d"
docker compose -f "$COMPOSE_FILE" --profile caddy up -d

echo "[micro-pull] health"
sleep 3
curl -fsS --max-time 15 http://127.0.0.1:4000/api/health
echo
echo "[micro-pull] done"
