#!/usr/bin/env bash
# Retry Always Free A1 until capacity. Each oci call has a hard timeout so we never hang.
# Cycles images + Fault Domains (empty = let OCI pick).
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
export PYTHONUNBUFFERED=1

TENANCY_OCID="${TENANCY_OCID:-ocid1.tenancy.oc1..aaaaaaaaydgugky4w2iiurlm4ntqj2wt7lbnlxejbklytfjpsiy577yz3raq}"
SUBNET="${SUBNET:-ocid1.subnet.oc1.sa-saopaulo-1.aaaaaaaa5geivwfeer6gl7qvyial72ysi5smtlcooqg7jcr5wvkcgu7toada}"
AD="${AD:-TgJG:SA-SAOPAULO-1-AD-1}"
SSH_PUB="${SSH_PUB:-$HOME/.ssh/oci_ahorrar.pub}"
LOG="${LOG:-/tmp/oci-vm-a-retry.log}"
OCI_TIMEOUT_S="${OCI_TIMEOUT_S:-90}"
SLEEP_S="${SLEEP_S:-30}"

IMAGES=(
  ocid1.image.oc1.sa-saopaulo-1.aaaaaaaawkokpnrdloctuiwulydrjsqvok5yy5ockwtrmsqswlm57ncbd56q
  ocid1.image.oc1.sa-saopaulo-1.aaaaaaaaj6y3wvj5ku4ahs4isf4aif5cz5yif7repspank6oghq4dnjprdia
  ocid1.image.oc1.sa-saopaulo-1.aaaaaaaacsccoglc53hnew4kabqluihun3y3zwchidu2gutjavvk7bvolyqa
)
FAULT_DOMAINS=("" "FAULT-DOMAIN-1" "FAULT-DOMAIN-2" "FAULT-DOMAIN-3")

log() { printf '%s\n' "$*" | tee -a "$LOG"; }

log "=== rotate-retry $(date -Is) pid=$$ timeout=${OCI_TIMEOUT_S}s ==="

attempt=0
while true; do
  attempt=$((attempt + 1))
  img="${IMAGES[$(( (attempt-1) % ${#IMAGES[@]} ))]}"
  fd="${FAULT_DOMAINS[$(( (attempt-1) % ${#FAULT_DOMAINS[@]} ))]}"
  fd_label="${fd:-auto}"
  log "capacity try ${attempt} $(date -Is) img=${img: -8} fd=${fd_label}"

  err=$(mktemp)
  out=$(mktemp)
  args=(
    compute instance launch
    --compartment-id "$TENANCY_OCID"
    --availability-domain "$AD"
    --display-name ahorrar-api
    --shape VM.Standard.A1.Flex
    --shape-config '{"ocpus":1,"memoryInGBs":6}'
    --image-id "$img"
    --subnet-id "$SUBNET"
    --assign-public-ip true
    --ssh-authorized-keys-file "$SSH_PUB"
    --boot-volume-size-in-gbs 50
    --query 'data.id'
    --raw-output
  )
  if [[ -n "$fd" ]]; then
    args+=(--fault-domain "$fd")
  fi

  set +e
  timeout --signal=KILL "${OCI_TIMEOUT_S}" oci "${args[@]}" >"$out" 2>"$err"
  rc=$?
  set -e
  id="$(tr -d '[:space:]' <"$out" || true)"
  msg="$(python3 -c 'import pathlib,re,sys
t=pathlib.Path(sys.argv[1]).read_text()
m=re.search(r"\"message\"\s*:\s*\"([^\"]+)\"", t)
print(m.group(1) if m else (t.strip()[-200:] if t.strip() else "empty"))' "$err" 2>/dev/null || echo unknown)"

  if [[ $rc -eq 0 && -n "$id" ]]; then
    log "Launched $id"
    for _ in $(seq 1 90); do
      st=$(timeout 30 oci compute instance get --instance-id "$id" --query 'data."lifecycle-state"' --raw-output 2>/dev/null || echo UNKNOWN)
      log "lifecycle=$st"
      [[ "$st" == RUNNING ]] && break
      sleep 8
    done
    ip=$(timeout 30 oci compute instance list-vnics --instance-id "$id" --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)
    log "instance_ocid=$id"
    log "public_ip=$ip"
    rm -f "$err" "$out"
    exit 0
  fi

  if [[ $rc -eq 137 || $rc -eq 124 ]]; then
    log "timeout/hang (attempt ${attempt}) fd=${fd_label} — killed after ${OCI_TIMEOUT_S}s"
  else
    log "miss (attempt ${attempt}) fd=${fd_label} rc=${rc} msg=${msg}"
  fi
  rm -f "$err" "$out"
  sleep "$SLEEP_S"
done
