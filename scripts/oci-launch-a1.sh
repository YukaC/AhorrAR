#!/usr/bin/env bash
# Launch VM.Standard.A1.Flex (1 OCPU / 6 GB, 50 GB boot) in home region via OCI CLI.
# Requires: oci on PATH, TENANCY_OCID set (root compartment = tenancy OCID).
#
# Usage:
#   export TENANCY_OCID=ocid1.tenancy.oc1..aaaa…
#   ./scripts/oci-launch-a1.sh DISPLAY_NAME SUBNET_OCID IMAGE_OCID AD_NAME SSH_PUBKEY_FILE
#
# Retries OutOfHostCapacity every 90s (max 120 attempts). See deploy/oci/always-free-guards.md.
set -euo pipefail

readonly MAX_ATTEMPTS=120
readonly RETRY_INTERVAL_SEC=90
readonly SHAPE='VM.Standard.A1.Flex'
readonly OCPUS=1
readonly MEMORY_GB=6
readonly BOOT_GB=50

usage() {
  echo "Usage: $0 DISPLAY_NAME SUBNET_OCID IMAGE_OCID AD_NAME SSH_PUBKEY_FILE" >&2
  echo "  Shape fixed at ${OCPUS} OCPU / ${MEMORY_GB} GB, boot ${BOOT_GB} GB." >&2
  echo "  Requires TENANCY_OCID and oci CLI." >&2
}

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then
  usage
  exit 0
fi

if [[ $# -ne 5 ]]; then
  usage
  exit 1
fi

DISPLAY_NAME=$1
SUBNET_OCID=$2
IMAGE_OCID=$3
AD_NAME=$4
SSH_PUBKEY_FILE=$5

if ! command -v oci >/dev/null 2>&1; then
  echo "oci CLI not found on PATH." >&2
  exit 1
fi

: "${TENANCY_OCID:?Set TENANCY_OCID (tenancy OCID; used as root compartment)}"
export COMPARTMENT="${TENANCY_OCID}"

if [[ ! -f "${SSH_PUBKEY_FILE}" ]]; then
  echo "SSH public key file not found: ${SSH_PUBKEY_FILE}" >&2
  exit 1
fi

shape_config=$(printf '{"ocpus":%s,"memoryInGBs":%s}' "${OCPUS}" "${MEMORY_GB}")

attempt=1
INSTANCE_OCID=''
err_file=$(mktemp)
trap 'rm -f "${err_file}"' EXIT

while [[ "${attempt}" -le "${MAX_ATTEMPTS}" ]]; do
  : >"${err_file}"
  set +e
  INSTANCE_OCID=$(
    oci compute instance launch \
      --availability-domain "${AD_NAME}" \
      --compartment-id "${COMPARTMENT}" \
      --display-name "${DISPLAY_NAME}" \
      --subnet-id "${SUBNET_OCID}" \
      --image-id "${IMAGE_OCID}" \
      --shape "${SHAPE}" \
      --shape-config "${shape_config}" \
      --assign-public-ip true \
      --ssh-authorized-keys-file "${SSH_PUBKEY_FILE}" \
      --boot-volume-size-in-gbs "${BOOT_GB}" \
      --query 'data.id' \
      --raw-output 2>"${err_file}"
  )
  launch_status=$?
  set -e

  if [[ "${launch_status}" -eq 0 && -n "${INSTANCE_OCID}" ]]; then
    echo "Launched instance (attempt ${attempt}/${MAX_ATTEMPTS})." >&2
    break
  fi

  # OCI returns either code OutOfHostCapacity or InternalError + "Out of host capacity."
  if grep -qiE 'OutOfHostCapacity|Out of host capacity|InternalError' "${err_file}"; then
    echo "capacity miss (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${RETRY_INTERVAL_SEC}s…" >&2
    if [[ "${attempt}" -eq "${MAX_ATTEMPTS}" ]]; then
      cat "${err_file}" >&2
      echo "Giving up after ${MAX_ATTEMPTS} attempts." >&2
      exit 1
    fi
    sleep "${RETRY_INTERVAL_SEC}"
    attempt=$((attempt + 1))
    continue
  fi

  cat "${err_file}" >&2
  exit "${launch_status:-1}"
done

echo "Waiting for lifecycle state RUNNING…" >&2
while true; do
  state=$(
    oci compute instance get \
      --instance-id "${INSTANCE_OCID}" \
      --query 'data."lifecycle-state"' \
      --raw-output
  )
  if [[ "${state}" == 'RUNNING' ]]; then
    break
  fi
  sleep 10
done

PUBLIC_IP=$(
  oci compute instance list-vnics \
    --instance-id "${INSTANCE_OCID}" \
    --query 'data[0]."public-ip"' \
    --raw-output
)

echo "instance_ocid=${INSTANCE_OCID}"
echo "public_ip=${PUBLIC_IP}"
echo "hint: set DOMAIN=${PUBLIC_IP}.sslip.io in deploy/oci/.env" >&2
