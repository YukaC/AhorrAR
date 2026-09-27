#!/usr/bin/env bash
# Smoke checks for OCI Micro API (run on the VM or via SSH).
# Usage: [DOMAIN=203.0.113.42.sslip.io] ./scripts/oci-micro-smoke.sh
set -euo pipefail

API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4000/api/health}"
DOMAIN="${DOMAIN:-}"
HTTPS_MAX_TIME="${HTTPS_MAX_TIME:-30}"

echo "[smoke] local health: ${API_HEALTH_URL}"
curl -fsS --max-time 15 "$API_HEALTH_URL"
echo

if [[ -n "$DOMAIN" ]]; then
  echo "[smoke] HTTPS health: https://${DOMAIN}/api/health"
  curl -fsS --max-time "$HTTPS_MAX_TIME" "https://${DOMAIN}/api/health"
  echo
else
  echo "[smoke] DOMAIN unset — skipping HTTPS check"
fi

echo "[smoke] docker stats (snapshot)"
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream 2>/dev/null || echo "(no running containers or docker stats failed)"
else
  echo "(docker not installed)"
fi

echo "[smoke] memory"
free -h

echo "[smoke] ok"
