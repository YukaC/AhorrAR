#!/usr/bin/env bash
# Merge deploy/oci/.env.example + local scraper/.env MELI_* → /tmp/ahorrar-oci.env
# Never commit the output.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="${ROOT}/deploy/oci/.env.example"
SCRAPER_ENV="${ROOT}/scraper/.env"
OUT="${1:-/tmp/ahorrar-oci.env}"

if [[ ! -f "$EXAMPLE" ]]; then
  echo "missing $EXAMPLE" >&2
  exit 1
fi
if [[ ! -f "$SCRAPER_ENV" ]]; then
  echo "missing $SCRAPER_ENV (MELI secrets)" >&2
  exit 1
fi

cp "$EXAMPLE" "$OUT"
chmod 600 "$OUT"

python3 - "$OUT" "$SCRAPER_ENV" <<'PY'
import sys
from pathlib import Path

out_path = Path(sys.argv[1])
scraper = Path(sys.argv[2])
keys = {
    "MELI_ACCESS_TOKEN",
    "MELI_REFRESH_TOKEN",
    "MELI_APP_ID",
    "MELI_CLIENT_SECRET",
    "MELI_REDIRECT_URI",
    "MELI_SITE_ID",
}
scrap = {}
for line in scraper.read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    if k in keys:
        scrap[k] = v

lines = out_path.read_text().splitlines()
seen = set()
new_lines = []
for line in lines:
    if "=" in line and not line.startswith("#"):
        k = line.split("=", 1)[0]
        if k in scrap:
            new_lines.append(f"{k}={scrap[k]}")
            seen.add(k)
            continue
    new_lines.append(line)
for k, v in scrap.items():
    if k not in seen:
        new_lines.append(f"{k}={v}")
out_path.write_text("\n".join(new_lines) + "\n")
print(f"wrote {out_path} (secrets not printed)")
for k in sorted(keys):
    present = k in scrap and bool(scrap[k])
    print(f"  {k}: {'ok' if present else 'MISSING'}")
PY
