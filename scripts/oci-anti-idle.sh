#!/usr/bin/env bash
# OCI Always Free idle-reclaim mitigation (NOT Render-style sleep).
# Oracle may reclaim a VM if average CPU, network, and memory use stay below ~20%
# for 7 consecutive days. This script runs a light network + CPU pulse suitable for
# cron every 6 hours alongside normal traffic.
#
# Example crontab (root or deploy user):
#   0 */6 * * * /opt/ahorrar/scripts/oci-anti-idle.sh >> /var/log/ahorrar-anti-idle.log 2>&1
#
set -euo pipefail

API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4000/api/health}"
PULSE_SECONDS="${PULSE_SECONDS:-3}"

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[$timestamp] oci-anti-idle start"

curl -fsS --max-time 15 "$API_HEALTH_URL" >/dev/null && echo "[$timestamp] health ok" || echo "[$timestamp] health skip/fail"

# Small outbound network touch (metadata + public DNS-resolved endpoint).
curl -fsS --max-time 10 -o /dev/null https://api.github.com/zen 2>/dev/null || true

# Short CPU burst (~few seconds) via OpenSSL if available; else tiny local read.
if command -v openssl >/dev/null 2>&1; then
  openssl speed -elapsed -seconds "$PULSE_SECONDS" rsa2048 >/dev/null 2>&1 || true
else
  dd if=/dev/zero of=/dev/null bs=1M count=64 status=none 2>/dev/null || true
fi

echo "[$timestamp] oci-anti-idle done"
