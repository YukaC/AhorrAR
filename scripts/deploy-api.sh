#!/usr/bin/env bash
# Deploy API+Scrapling to Fly.io. Requires: flyctl auth login
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v flyctl >/dev/null 2>&1 && ! command -v fly >/dev/null 2>&1; then
  echo "Instalá flyctl: curl -L https://fly.io/install.sh | sh"
  exit 1
fi
FLY=$(command -v flyctl || command -v fly)

APP="${FLY_APP:-ahorrar-api}"

if ! $FLY apps list 2>/dev/null | grep -q "$APP"; then
  echo "→ Creating Fly app '$APP' (region gru)"
  $FLY apps create "$APP" --org personal 2>/dev/null || true
fi

echo "→ Secrets (CORS). Pass VERCEL_ORIGIN=https://your-app.vercel.app"
if [[ -n "${VERCEL_ORIGIN:-}" ]]; then
  $FLY secrets set "CORS_ORIGINS=${VERCEL_ORIGIN},http://localhost:5173" -a "$APP"
fi

echo "→ Deploy"
$FLY deploy -a "$APP" --ha=false

echo ""
echo "API: https://${APP}.fly.dev/api/health"
echo "Set Vercel VITE_API_BASE=https://${APP}.fly.dev and redeploy frontend."
