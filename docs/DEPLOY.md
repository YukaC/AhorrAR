# Deploy — Vercel (UI) + Render Free (API puente) · OCI Always Free (DISABLED hasta cupo A1)

> **Estado vivo:** [`docs/PROD.md`](PROD.md) · OCI: [`deploy/oci/DISABLED.md`](../deploy/oci/DISABLED.md) / [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md)

## URLs canónicas

| Qué | URL |
|---|---|
| UI (prod) | https://ahorrarg.vercel.app |
| API health (**activo ahora**: Render) | `https://ahorrar-api.onrender.com/api/health` |
| API health (OCI, cuando haya A1) | `https://<IP>.sslip.io/api/health` |
| API health (Fly) | ~~https://ahorrar-api.fly.dev/api/health~~ **caído** (no usar) |
| Repo | https://github.com/YukaC/AhorrAR |

Aliases Vercel (`ahorrar-wine.vercel.app`, `*-yukas-projects-*.vercel.app`, …) → **308** → `ahorrarg.vercel.app`.

## Arquitectura (hoy — puente Render)

```
Browser → Vercel Hobby  https://ahorrarg.vercel.app
              │  VITE_API_BASE=https://ahorrar-api.onrender.com
              │  VITE_FREE_HOST=1
              ▼
         Render Free Docker  Node :4000 + Scrapling :4100
              perfil 512 MB — render.yaml · sleep ~15m
```

**OCI Always Free** (Ampere A1 full profile) está **preparado pero DISABLED** hasta que Oracle tenga host capacity en `sa-saopaulo-1`. Ver `deploy/oci/`.

## Arquitectura (objetivo — OCI)

```
Browser → Vercel Hobby
              │  VITE_API_BASE=https://<IP>.sslip.io
              │  VITE_FREE_HOST=0
              ▼
         OCI Always Free ARM  A1 Flex 1 OCPU / 6 GB
              Caddy :443 · perfil FULL — deploy/oci/.env.example
```

### Perfil OCI (full)

| Variable | Valor típico |
|---|---|
| `WARM_CACHE` | `1` |
| `FETCH_WORKERS` | `4` |
| `MAX_NODES` | `120` |
| `MAX_RESULTS` | `100` |
| `INCLUDE_ML` | `1` |
| `CONCURRENCY` | `2` |
| `MELI_TOKEN_FILE` | `/data/meli_tokens.json` (volume Docker) |

Detalle: [`deploy/oci/README.md`](../deploy/oci/README.md).

### Anti-idle OCI (no confundir con Render)

Oracle puede **reclamar** instancias con uso promedio de CPU/red/memoria **bajo ~20% durante 7 días**. No es el spin-down de Render (~15m).

```cron
0 */6 * * * /opt/ahorrar/scripts/oci-anti-idle.sh >> /var/log/ahorrar-anti-idle.log 2>&1
```

`WARM_CACHE=1` también mantiene actividad útil de producto; el script es un pulso ligero adicional.

### Optimizaciones Render Free (solo fallback)

Si usás Render en lugar de OCI:

| Capa | Qué |
|---|---|
| Front JS | `api-wake.ts`: ping health antes de buscar + al focus; keep-warm cada 12m (tab visible) |
| UX | Caps UI **25→50** (`VITE_FREE_HOST=1`, sin 100) |
| Fetch RAM | `FETCH_WORKERS=2` · límites hub/api/html bajos |
| Crawl | `MAX_NODES=80` · `WARM_CACHE=0` |
| Tokens | `/tmp` efímero |

**No** cron 24/7 en Render: quema las 750 Free instance-hours.

## OCI Always Free (API recomendada)

Perfil **full** (warm cache, ML, caps altos) en **VM.Standard.A1.Flex** 1 OCPU / 6 GB. **$0** si respetás [`deploy/oci/always-free-guards.md`](../deploy/oci/always-free-guards.md) (solo región home, sin LB/ADB de pago, sin regiones extra).

**Guía paso a paso:** [`deploy/oci/README.md`](../deploy/oci/README.md) — Docker en la VM, API solo en `127.0.0.1:4000`, HTTPS con Caddy (`docker compose --profile caddy`) y **`DOMAIN=<IP>.sslip.io`** sin comprar dominio. Vercel: `VITE_API_BASE=https://$DOMAIN`, **`VITE_FREE_HOST=0`**. Anti-idle: `scripts/oci-anti-idle.sh` cada 6h.

## Deploy OCI (primera vez)

1. Capacidad A1: `TENANCY_OCID=… ./scripts/oci-launch-a1.sh …` o `scripts/oci-a1-rotate-retry.sh` (retry en background).
2. Con IP pública: `./scripts/oci-finish-when-ready.sh <PUBLIC_IP>` (make-env + bootstrap Docker/Caddy/anti-idle).
3. O manual: Security List 80/443/22 → `setup-vm.sh` → clone `/opt/ahorrar` → `.env` con `DOMAIN=<IP>.sslip.io` → `docker compose --profile caddy up -d --build`.
4. Vercel Production: `VITE_API_BASE=https://$DOMAIN`, **`VITE_FREE_HOST=0`**.
5. Estado vivo / anti-cargo: [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md), [`deploy/oci/always-free-guards.md`](../deploy/oci/always-free-guards.md).

## Deploy Render (puente prod — activo)

1. [Deploy Blueprint](https://render.com/deploy?repo=https://github.com/YukaC/AhorrAR) (o Dashboard → New → Blueprint → `render.yaml`)
2. Secrets `MELI_*` (sync: false en el yaml)
3. Vercel Production:
   - `VITE_API_BASE=https://ahorrar-api.onrender.com`
   - `VITE_FREE_HOST=1`
4. **Redeploy** Vercel tras cambiar env (Vite bakea en build)

Cold start: el front ya hace wake/keep-warm (`api-wake.ts`) con tab visible.

## Deploy automático (GitHub)

| Host | Qué redeploya | Señal |
|---|---|---|
| **Vercel** | frontend | check `Vercel` |
| **OCI** | manual / CI propio (`docker compose pull/build` en VM) | — |
| **Render** | Docker API (`render.yaml`) | Deployments Render |
| **Fly** (opcional) | si seguís usando Fly | check `Fly.io` |

Push a **`main`** → UI en Vercel; API en OCI se actualiza con pull + rebuild en la VM (o pipeline que elijas).

Env Vercel (OCI):

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://<api-host>` |
| `VITE_FREE_HOST` | `0` |

Env Vercel (Render fallback):

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://<api>.onrender.com` |
| `VITE_FREE_HOST` | `1` |

Secrets API (OCI `.env` o Render dashboard): `MELI_ACCESS_TOKEN`, `MELI_REFRESH_TOKEN`, `MELI_APP_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`. `CORS_ORIGINS` debe incluir `https://ahorrarg.vercel.app`.

ML access ~6h: auto-refresh on 401 → `/data/meli_tokens.json` (OCI) o `/tmp` (Render). Si refresh falla: `cd scraper && uv run python scripts/ml_login.py refresh` y actualizar secrets.

## Deploy manual (emergencia)

### 1) API en OCI

Ver [`deploy/oci/README.md`](../deploy/oci/README.md).

### 1a) API en Render

```bash
render blueprints validate render.yaml
```

### 1b) API en Fly (alternativa)

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
chmod +x scripts/deploy-api.sh
FLY_APP=ahorrar-api ./scripts/deploy-api.sh
```

`fly.toml`: volume ML en `/data`. No modificar billing Fly desde este doc.

### Stealth fetch (opcional, solo local)

```bash
cd scraper && uv run scrapling install
STEALTH_FETCH=1 npm run dev:scraper
```

Imagen Docker = HTTP-only. Prod: `STEALTH_FETCH` unset/`0`.

### 2) Frontend en Vercel

```bash
chmod +x scripts/deploy-frontend.sh
./scripts/deploy-frontend.sh --prod
```

Root: **repo root** (`vercel.json` → `frontend/dist`).

## Orden recomendado (primera vez, OCI)

1. OCI VM + Docker + health en `:4000`  
2. Caddy TLS + health público  
3. Vercel `VITE_API_BASE` + `VITE_FREE_HOST=0`  
4. UI: https://ahorrarg.vercel.app  

## Local con Docker

Simula Render 512MB:

```bash
docker compose up --build
# API http://localhost:4000  (mem_limit 512m)
```

Simula OCI (~4G container):

```bash
cd deploy/oci
cp .env.example .env   # ajustar INCLUDE_ML etc.
docker compose up --build
```

## Costos / límites free

| Host | Rol | Límites |
|---|---|---|
| Vercel Hobby | UI | Generoso para estático |
| **OCI Always Free** | API+crawler | A1 Flex 1 OCPU/6GB · build arm64 · reclamo por idle 7d |
| **Render Free** | API fallback | 512 MB · sleep 15m · 750 h/mes |
| Fly (card) | API opcional | Volume ML; revisar billing aparte |

## Archivos

- `Dockerfile` — imagen única API+Scrapling (arm64 + amd64 desde base slim)
- `deploy/oci/` — compose, `.env.example`, Caddy, `setup-vm.sh`, README
- `scripts/oci-anti-idle.sh` — pulso cron anti-reclaim OCI
- `render.yaml` — Blueprint Free 512MB (fallback)
- `fly.toml` — app `ahorrar-api` (opcional)
- `docker-compose.yml` — smoke local 512MB
- `vercel.json` — build frontend
- `frontend/src/lib/api-wake.ts` — wake + keep-warm (útil en Render; opcional en OCI)
