#!/usr/bin/env bash
# Monthly reminder / cron helper — re-probe shared/ar-shops.json (T52).
# Example crontab (laptop or Micro, low frequency):
#   0 4 1 * * cd /opt/ahorrar && ./scripts/reprobe-ar-shops.sh >> /var/log/ahorrar-reprobe.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if command -v uv >/dev/null 2>&1; then
  (cd scraper && uv run python ../scripts/probe_ar_shops.py)
else
  python3 scripts/probe_ar_shops.py
fi
echo "re-probe done $(date -Iseconds)"
