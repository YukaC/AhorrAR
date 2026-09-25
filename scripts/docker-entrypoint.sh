#!/bin/sh
set -eu

export SCRAPER_HOST="${SCRAPER_HOST:-127.0.0.1}"
export SCRAPER_PORT="${SCRAPER_PORT:-4100}"
export SCRAPLING_URL="${SCRAPLING_URL:-http://127.0.0.1:${SCRAPER_PORT}}"
export CRAWLER="${CRAWLER:-scrapling}"
export PORT="${PORT:-4000}"
export HOST="${HOST:-0.0.0.0}"

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
