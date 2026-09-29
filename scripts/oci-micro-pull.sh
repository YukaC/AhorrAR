#!/usr/bin/env bash
# On the Micro VM: pull latest GHCR image and recreate api+caddy (no build).
# Usage (on VM): sudo ./scripts/oci-micro-pull.sh
# Or via CI SSH after docker-ghcr.yml push.
set -euo pipefail

ROOT="${AHORRAR_ROOT:-/opt/ahorrar}"
COMPOSE_DIR="${ROOT}/deploy/oci"
COMPOSE_FILE="docker-compose.micro.yml"

cd "$COMPOSE_DIR"

# Honor deploy/oci/.env pin (e.g. digest rollback) before defaulting to :micro.
# CI SSH does not pass AHORRAR_IMAGE; without this, every deploy-micro
# would re-pull the floating :micro tag and wipe a local pin.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
IMAGE="${AHORRAR_IMAGE:-ghcr.io/yukac/ahorrar-api:micro}"

# Optional: refresh compose/scripts from git (never overwrite .env).
if [[ -d "$ROOT/.git" ]] && [[ "${AHORRAR_GIT_PULL:-1}" == "1" ]]; then
  git -C "$ROOT" fetch --depth 1 origin main 2>/dev/null || true
  git -C "$ROOT" checkout -f origin/main -- \
    deploy/oci/docker-compose.micro.yml \
    deploy/oci/Caddyfile \
    scripts/oci-micro-pull.sh \
    scripts/oci-micro-smoke.sh \
    scripts/oci-anti-idle.sh 2>/dev/null || true
  # Re-source after checkout in case this script was replaced mid-run.
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  IMAGE="${AHORRAR_IMAGE:-ghcr.io/yukac/ahorrar-api:micro}"
fi

export AHORRAR_IMAGE="${IMAGE}"
echo "[micro-pull] pulling ${IMAGE}"
docker compose -f "$COMPOSE_FILE" --profile caddy pull

echo "[micro-pull] up -d"
# Retry recreate — concurrent CI runs can race on container removal.
for attempt in 1 2 3 4 5; do
  if docker compose -f "$COMPOSE_FILE" --profile caddy up -d; then
    break
  fi
  echo "[micro-pull] up failed (attempt ${attempt}); waiting…"
  sleep $((attempt * 3))
  if [[ "$attempt" -eq 5 ]]; then
    echo "[micro-pull] up failed after retries" >&2
    exit 1
  fi
done

echo "[micro-pull] health"
sleep 5
curl -fsS --max-time 20 http://127.0.0.1:4000/api/health
echo
echo "[micro-pull] done"
