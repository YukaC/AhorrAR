#!/usr/bin/env bash
# Keep the A1 capacity rotator alive. Restarts if the child exits or log goes stale.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${LOG:-/tmp/oci-vm-a-retry.log}"
STALE_S="${STALE_S:-180}"
CHILD_PID=""

cleanup() {
  if [[ -n "${CHILD_PID}" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Only one watchdog
if [[ -f /tmp/oci-a1-watchdog.pid ]]; then
  old=$(cat /tmp/oci-a1-watchdog.pid 2>/dev/null || true)
  if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
    echo "watchdog already running pid=$old" >&2
    exit 0
  fi
fi
echo $$ > /tmp/oci-a1-watchdog.pid

while true; do
  echo "[watchdog $(date -Is)] starting rotator" | tee -a "$LOG"
  # Prefer SDK rotator (oci CLI often hangs 60–90s with empty stderr).
  if [[ -x "$ROOT/scripts/oci-a1-rotate-retry.py" ]]; then
    "$ROOT/scripts/oci-a1-rotate-retry.py" &
  else
    bash "$ROOT/scripts/oci-a1-rotate-retry.sh" &
  fi
  CHILD_PID=$!
  while kill -0 "$CHILD_PID" 2>/dev/null; do
    if [[ -f "$LOG" ]]; then
      age=$(( $(date +%s) - $(stat -c %Y "$LOG") ))
      if (( age > STALE_S )); then
        echo "[watchdog $(date -Is)] log stale ${age}s — killing hung rotator $CHILD_PID" | tee -a "$LOG"
        kill -9 "$CHILD_PID" 2>/dev/null || true
        wait "$CHILD_PID" 2>/dev/null || true
        CHILD_PID=""
        break
      fi
    fi
    # success?
    if grep -q '^public_ip=' "$LOG" 2>/dev/null; then
      echo "[watchdog $(date -Is)] public_ip found — exiting" | tee -a "$LOG"
      exit 0
    fi
    sleep 20
  done
  wait "$CHILD_PID" 2>/dev/null || true
  CHILD_PID=""
  if grep -q '^public_ip=' "$LOG" 2>/dev/null; then
    exit 0
  fi
  echo "[watchdog $(date -Is)] rotator exited — restart in 5s" | tee -a "$LOG"
  sleep 5
done
