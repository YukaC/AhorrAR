#!/usr/bin/env bash
# Watch /tmp/oci-vm-a-retry.log for public_ip= then bootstrap the VM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${1:-/tmp/oci-vm-a-retry.log}"
ENV_FILE="${2:-/tmp/ahorrar-oci.env}"

echo "[watch] waiting for public_ip in $LOG (no timeout)"
while true; do
  if [[ -f "$LOG" ]] && grep -q '^public_ip=' "$LOG"; then
    IP=$(grep '^public_ip=' "$LOG" | tail -1 | cut -d= -f2)
    if [[ -n "$IP" && "$IP" != "null" ]]; then
      echo "[watch] got IP=$IP — bootstrapping"
      if [[ ! -f "$ENV_FILE" ]]; then
        "$ROOT/scripts/oci-make-env.sh" "$ENV_FILE"
      fi
      "$ROOT/scripts/oci-bootstrap-remote.sh" "$IP" "$ENV_FILE"
      exit $?
    fi
  fi
  sleep 30
done
