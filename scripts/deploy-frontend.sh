#!/usr/bin/env bash
# Deploy frontend to Vercel (Hobby). Requires: npx vercel login
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v vercel >/dev/null 2>&1 && ! npx --yes vercel --version >/dev/null 2>&1; then
  echo "Instalá Vercel CLI: npm i -g vercel"
  exit 1
fi

CMD=(npx --yes vercel)
if [[ "${1:-}" == "--prod" ]]; then
  CMD+=(--prod)
fi

echo "→ Deploy frontend (repo root, vercel.json → frontend/dist)"
echo "  Set env VITE_API_BASE=https://YOUR-FLY-APP.fly.dev after API is up"
"${CMD[@]}" --yes

echo ""
echo "Luego en Vercel Dashboard → Settings → Environment Variables:"
echo "  VITE_API_BASE=https://ahorrar-api.fly.dev"
echo "Redeploy production after setting the env var."
