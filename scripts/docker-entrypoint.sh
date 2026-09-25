#!/bin/sh
set -eu

export SCRAPER_HOST="${SCRAPER_HOST:-127.0.0.1}"
export SCRAPER_PORT="${SCRAPER_PORT:-4100}"
export SCRAPLING_URL="${SCRAPLING_URL:-http://127.0.0.1:${SCRAPER_PORT}}"
export CRAWLER="${CRAWLER:-scrapling}"
export PORT="${PORT:-4000}"
export HOST="${HOST:-0.0.0.0}"
# Fly: persistent /data volume. Render Free: ephemeral FS → /tmp (lost on spin-down).
if [ -z "${MELI_TOKEN_FILE:-}" ]; then
  if [ -d /data ]; then
    export MELI_TOKEN_FILE=/data/meli_tokens.json
  else
    export MELI_TOKEN_FILE=/tmp/meli_tokens.json
  fi
fi
mkdir -p "$(dirname "${MELI_TOKEN_FILE}")"

# Seed token file from env secrets on first boot (file wins after refresh when writable).
if [ -n "${MELI_ACCESS_TOKEN:-}" ] && [ ! -f "${MELI_TOKEN_FILE}" ]; then
  echo "[entrypoint] seeding ${MELI_TOKEN_FILE} from env secrets"
  cd /app/scraper
  uv run python -c "from ahorrar_scraper.meli_auth import persist_tokens; persist_tokens()" || true
fi

cleanup() {
  echo "[entrypoint] shutting down…"
  kill "$SCRAPER_PID" 2>/dev/null || true
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[entrypoint] starting Scrapling on ${SCRAPER_HOST}:${SCRAPER_PORT}"
cd /app/scraper
uv run ahorrar-scraper &
SCRAPER_PID=$!

i=0
while [ "$i" -lt 45 ]; do
  if curl -fsS "http://127.0.0.1:${SCRAPER_PORT}/health" >/dev/null 2>&1; then
    echo "[entrypoint] Scrapling ready"
    break
  fi
  i=$((i + 1))
  sleep 1
done

echo "[entrypoint] starting Node API on ${HOST}:${PORT} (CRAWLER=${CRAWLER})"
cd /app/backend
node src/server.ts &
API_PID=$!
wait "$API_PID"
