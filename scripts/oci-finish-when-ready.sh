#!/usr/bin/env bash
# One-shot after A1 has public_ip (or pass IP). Idempotent-ish bootstrap + print Vercel env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="${1:-}"
if [[ -z "$IP" ]]; then
  if [[ -f /tmp/oci-vm-a-retry.log ]] && grep -q '^public_ip=' /tmp/oci-vm-a-retry.log; then
    IP=$(grep '^public_ip=' /tmp/oci-vm-a-retry.log | tail -1 | cut -d= -f2)
  fi
fi
if [[ -z "$IP" || "$IP" == "null" ]]; then
  echo "usage: $0 <PUBLIC_IP>   # or wait until retry log has public_ip=" >&2
  exit 1
fi
"$ROOT/scripts/oci-make-env.sh" /tmp/ahorrar-oci.env
"$ROOT/scripts/oci-bootstrap-remote.sh" "$IP" /tmp/ahorrar-oci.env
DOMAIN="${IP}.sslip.io"
echo
echo "=== Vercel Production env ==="
echo "VITE_API_BASE=https://${DOMAIN}"
echo "VITE_FREE_HOST=0"
echo "=== smoke ==="
echo "curl -fsS https://${DOMAIN}/api/health"
