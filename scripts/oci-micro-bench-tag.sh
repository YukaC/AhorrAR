#!/usr/bin/env bash
# Temporary Micro bench against a GHCR tag WITHOUT retagging :micro on the registry.
# Usage on VM:
#   sudo AHORRAR_IMAGE=ghcr.io/yukac/ahorrar-api:sha-815d4eb ./scripts/oci-micro-bench-tag.sh
# Restore prod pin:
#   sudo AHORRAR_IMAGE=ghcr.io/yukac/ahorrar-api:micro ./scripts/oci-micro-bench-tag.sh
set -euo pipefail
ROOT="${AHORRAR_ROOT:-/opt/ahorrar}"
IMAGE="${AHORRAR_IMAGE:?set AHORRAR_IMAGE to sha-* or branch-* tag}"
export AHORRAR_GIT_PULL=0 AHORRAR_IMAGE="$IMAGE"
exec "$ROOT/scripts/oci-micro-pull.sh"
