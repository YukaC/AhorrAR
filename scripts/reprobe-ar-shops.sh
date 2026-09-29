#!/usr/bin/env bash
# Monthly / on-demand re-probe of shared/ar-shops.json (§T52 / §V19).
#
# Runs two canary moments (≥2 queries/cat) with a gap so a single blip does not
# mark hosts dead. Mass-fail guard lives in sweep_shop_canary.py.
#
# Usage:
#   ./scripts/reprobe-ar-shops.sh              # dry (no index write)
#   ./scripts/reprobe-ar-shops.sh --write      # flip alive after 2 fail moments
#   GAP_S=120 ./scripts/reprobe-ar-shops.sh --write --categories electro,bazar
#
# Cron hint (host with scraper deps): 0 4 1 * * cd /path/AhorrAR && ./scripts/reprobe-ar-shops.sh --write
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${CANARY_STATE_DIR:-/tmp/ahorrar-canary-state}"
GAP_S="${GAP_S:-90}"
WRITE=0
ALL_ALIVE=1
CATEGORIES=""
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write) WRITE=1; shift ;;
    --curated-only) ALL_ALIVE=0; shift ;;
    --all-alive) ALL_ALIVE=1; shift ;;
    --categories) CATEGORIES="$2"; shift 2 ;;
    --gap) GAP_S="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

run_moment() {
  local label="$1"
  local args=(../scripts/sweep_shop_canary.py --state-dir "$STATE_DIR" --moment "$label")
  [[ "$ALL_ALIVE" -eq 1 ]] && args+=(--all-alive)
  [[ -n "$CATEGORIES" ]] && args+=(--categories "$CATEGORIES")
  [[ "$WRITE" -eq 1 ]] && args+=(--write)
  args+=("${EXTRA[@]+"${EXTRA[@]}"}")
  (cd "$ROOT/scraper" && uv run python "${args[@]}")
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
echo "== re-probe moment1 ${STAMP}-a =="
run_moment "${STAMP}-a"

echo "== sleep ${GAP_S}s before moment2 =="
sleep "$GAP_S"

echo "== re-probe moment2 ${STAMP}-b =="
run_moment "${STAMP}-b"

echo "== done. artifacts /tmp/ahorrar-shop-canary-${STAMP}-*.json streaks in ${STATE_DIR} =="
