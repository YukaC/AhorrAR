# Deploy — Oracle Cloud Always Free (API + Scrapling)

> **Prod API hoy:** **OCI Micro** `https://147.15.72.239.sslip.io` ([`docs/PROD.md`](../../docs/PROD.md)).  
> **Backup:** Render Free — [`REVERT-RENDER.md`](REVERT-RENDER.md).  
> **A1 ARM full:** futuro upgrade cuando haya cupo — [`DISABLED.md`](DISABLED.md).

Frontend on [Vercel](https://ahorrarg.vercel.app) con `VITE_API_BASE` → Micro.

---

## Micro E2.1 (x86, ~1 GB — primario)

Always Free `VM.Standard.E2.1.Micro`. Preferir pull GHCR amd64; build en Micro solo fallback.

| Item | Detalle |
|---|---|
| Instancia | `ahorrar-api-micro` · IP reservada **147.15.72.239** · `147.15.72.239.sslip.io` |
| Compose | `docker-compose.micro.yml` — `mem_limit` ~768m, perfil slim (knobs tipo Render) |
| Imagen | `ghcr.io/yukac/ahorrar-api:micro` (CI: `.github/workflows/docker-ghcr.yml`) |
| Env plantilla | `deploy/oci/.env.micro.example` → copiar a `.env` en la VM (nunca commit) |
| Bootstrap | `./scripts/oci-bootstrap-micro.sh 147.15.72.239 [/path/to/env]` |
| Smoke | `DOMAIN=147.15.72.239.sslip.io ./scripts/oci-micro-smoke.sh` |
| Revert prod | [`REVERT-RENDER.md`](REVERT-RENDER.md) |

En la VM (tras bootstrap):

```bash
cd /opt/ahorrar/deploy/oci
docker compose -f docker-compose.micro.yml --profile caddy pull
docker compose -f docker-compose.micro.yml --profile caddy up -d
curl -fsS "https://${DOMAIN}/api/health"
```

Env: `./scripts/oci-make-env.sh --micro` (mezcla `.env.micro.example` + `scraper/.env` MELI_*).

Vercel (activo): `VITE_API_BASE=https://147.15.72.239.sslip.io`, `VITE_FREE_HOST=1`.

---

## A1 Flex ARM (full profile — upgrade futuro)

Host the **full** API profile (warm cache, ML, higher crawl caps) on a single **ARM** VM when Oracle grants `VM.Standard.A1.Flex` capacity.

## Always Free guardrails (read before creating anything)

**Goal: $0 on the card.** Full rules: [`always-free-guards.md`](always-free-guards.md).

| Never do this | Why |
|---|---|
| Paid Load Balancer, Autonomous DB, MySQL HeatWave | Easy to bill |
| Resources outside home region `sa-saopaulo-1` | Out of Always Free scope |
| Extra block volumes “just in case” | Counts toward 200 GB tenancy cap |

| Item | Recommendation |
|---|---|
| Shape | `VM.Standard.A1.Flex` — **1 OCPU / 6 GB** (fits Docker mem limit ~4 GB + OS + Caddy) |
| Arch | **aarch64** — build the image **on the VM** (`docker compose build`) |
| Disk | Boot volume **50 GB** |
| Public IP | Reserved IPv4 on the VNIC; Security List: **80**, **443**, SSH **22** (restrict source IP) |
| TLS | **Caddy** in Docker (`--profile caddy`) or on the host — **not** a paid OCI LB |
| Idle reclaim | OCI may reclaim VMs under ~20% CPU/network/memory for **7 days** — cron `scripts/oci-anti-idle.sh` every **6h** |

Launch helper (CLI, retries capacity misses every 90s): `scripts/oci-launch-a1.sh`.

**DOMAIN:** `<PUBLIC_IP>.sslip.io` (free TLS via Caddy; no domain purchase).

## Quick start (laptop — recommended)

1. Launch A1 (Ubuntu arm64) with `scripts/oci-launch-a1.sh`, or wait until the instance has a **public IP** (console or `public_ip=` in the launch log).

2. Build the deploy env **on your laptop** (reads `deploy/oci/.env.example` + `scraper/.env` for `MELI_*`; never commit output):

```bash
export TENANCY_OCID=ocid1.tenancy.oc1..aaaa…   # once, for launch only
./scripts/oci-make-env.sh                      # → /tmp/ahorrar-oci.env (chmod 600)
```

3. Bootstrap over SSH (installs Docker, clones repo, **uploads** `/tmp/ahorrar-oci.env` → `/opt/ahorrar/deploy/oci/.env`, patches `DOMAIN` + `API_UPSTREAM`, `docker compose --profile caddy up -d --build`, anti-idle cron):

```bash
./scripts/oci-bootstrap-remote.sh <PUBLIC_IP> [/tmp/ahorrar-oci.env]
curl -fsS "https://<PUBLIC_IP>.sslip.io/api/health"
```

While `oci-launch-a1.sh` retries **Out of host capacity**, run in another terminal:

```bash
./scripts/oci-watch-and-bootstrap.sh    # runs make-env if missing, then bootstrap when IP appears
```

The API is **not** exposed on `0.0.0.0:4000` — only **127.0.0.1:4000** on the host and **via Caddy** on 443.

4. **Vercel** (Production):

| Variable | Value |
|---|---|
| `VITE_API_BASE` | `https://<DOMAIN>` (e.g. `https://203.0.113.42.sslip.io`) |
| `VITE_FREE_HOST` | `0` (UI caps 25→50→100) |

## Quick start (manual on VM)

Use this only if you **did not** run `oci-bootstrap-remote.sh` (no laptop upload of `.env`).

```bash
sudo bash deploy/oci/setup-vm.sh
sudo git clone https://github.com/YukaC/AhorrAR.git /opt/ahorrar
cd /opt/ahorrar
cp deploy/oci/.env.example deploy/oci/.env
# edit deploy/oci/.env — MELI_* secrets, DOMAIN=<PUBLIC_IP>.sslip.io, CORS_ORIGINS (do not commit)
cd deploy/oci
docker compose --profile caddy up -d --build
curl -fsS "https://${DOMAIN}/api/health"
```

## Host-installed Caddy (optional)

If you prefer Caddy as a systemd service instead of the Docker profile, keep `API_UPSTREAM=127.0.0.1:4000` in `.env` and install Caddy on the host; use the same `Caddyfile` with `DOMAIN` exported.

## Anti-idle cron

```cron
0 */6 * * * /opt/ahorrar/scripts/oci-anti-idle.sh >> /var/log/ahorrar-anti-idle.log 2>&1
```

Default health check hits `http://127.0.0.1:4000/api/health` (works even when only Caddy is public on 443).

## Files

| File | Role |
|---|---|
| `docker-compose.micro.yml` | Micro: GHCR pull, slim mem, `--profile caddy` |
| `docker-compose.yml` | A1 full: build on VM, higher caps |
| `.env.example` | A1 full: `DOMAIN`, `API_UPSTREAM`, env profile |
| `MICRO-PLAN.md` | Plan Micro + Render backup + cutover |
| `REVERT-RENDER.md` | Runbook Vercel + ML → Render |
| `Caddyfile` | `{$DOMAIN}` → `{$API_UPSTREAM}` |
| `setup-vm.sh` | Docker + compose plugin |
| `always-free-guards.md` | Hard $0 rules for the tenancy |
| `STATUS.md` | Migration snapshot (no secrets) |

Canonical deploy overview: [`docs/DEPLOY.md`](../../docs/DEPLOY.md).
