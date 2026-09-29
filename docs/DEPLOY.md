# Deploy — Vercel (UI) + OCI Micro (API primario) · Render backup · A1 DISABLED

> **Estado vivo:** [`docs/PROD.md`](PROD.md) · Micro: [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md) · A1: [`deploy/oci/DISABLED.md`](../deploy/oci/DISABLED.md)

## URLs canónicas

| Qué | URL |
|---|---|
| UI (prod) | https://ahorrarg.vercel.app |
| API health (**primario**: OCI Micro) | `https://147.15.72.239.sslip.io/api/health` |
| API health (**backup**: Render Free) | `https://ahorrar-api.onrender.com/api/health` |
| Repo | https://github.com/YukaC/AhorrAR |

> **Fly (`ahorrar-api.fly.dev`) está retirado.** No health-check, no secrets, no redirect ML.

Aliases Vercel (`ahorrar-wine.vercel.app`, `*-yukas-projects-*.vercel.app`, …) → **308** → `ahorrarg.vercel.app`.

## Arquitectura (hoy — OCI Micro)

```
Browser → Vercel Hobby  https://ahorrarg.vercel.app
              │  VITE_API_BASE=https://147.15.72.239.sslip.io
              │  VITE_FREE_HOST=1
              ▼
         OCI E2.1.Micro  Docker Node :4000 + Scrapling :4100 + Caddy :443
              perfil slim ~1 GB — deploy/oci/docker-compose.micro.yml
```

**Backup:** Render Free (cold start ~15m). Revert: [`deploy/oci/REVERT-RENDER.md`](../deploy/oci/REVERT-RENDER.md).

**OCI A1 Flex** (Ampere, perfil full) está **preparado pero DISABLED** hasta cupo en `sa-saopaulo-1`. Ver `deploy/oci/DISABLED.md`.

## Arquitectura (objetivo — A1 cuando haya cupo)

```
Browser → Vercel Hobby
              │  VITE_API_BASE=https://<IP>.sslip.io
              │  VITE_FREE_HOST=0
              ▼
         OCI Always Free ARM  A1 Flex 1 OCPU / 6 GB
              Caddy :443 · perfil FULL — deploy/oci/.env.example
```

### Perfil Micro (slim — prod hoy)

| Variable | Valor típico |
|---|---|
| `WARM_CACHE` | `0` |
| `FETCH_WORKERS` | `2` |
| `MAX_NODES` | `80` |
| `MAX_RESULTS` | `50` |
| `INCLUDE_ML` | `1` |
| `CONCURRENCY` | `1` |
| `MELI_TOKEN_FILE` | `/data/meli_tokens.json` |
| `VITE_FREE_HOST` | `1` (caps UI 25→50) |

Detalle: [`deploy/oci/MICRO-PLAN.md`](../deploy/oci/MICRO-PLAN.md) · [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md).

### Perfil A1 (full — futuro)

| Variable | Valor típico |
|---|---|
| `WARM_CACHE` | `1` |
| `FETCH_WORKERS` | `4` |
| `MAX_NODES` | `120` |
| `MAX_RESULTS` | `100` |
| `INCLUDE_ML` | `1` |
| `CONCURRENCY` | `2` |
| `VITE_FREE_HOST` | `0` |

### Anti-idle OCI

Oracle puede **reclamar** instancias con uso promedio de CPU/red/memoria **bajo ~20% durante 7 días**.

```cron
0 */6 * * * /opt/ahorrar/scripts/oci-anti-idle.sh >> /var/log/ahorrar-anti-idle.log 2>&1
```

### Optimizaciones Render Free (solo backup)

| Capa | Qué |
|---|---|
| Front JS | `api-wake.ts`: ping health antes de buscar + al focus; keep-warm cada 12m (tab visible) |
| UX | Caps UI **25→50** (`VITE_FREE_HOST=1`) |
| Fetch RAM | `FETCH_WORKERS=2` · límites hub/api/html bajos |
| Crawl | `MAX_NODES=80` · `WARM_CACHE=0` |
| Tokens | `/tmp` efímero |

**No** cron 24/7 en Render: quema las 750 Free instance-hours.

## Deploy OCI Micro (prod)

1. VM E2.1.Micro + reserved IP + Caddy (`deploy/oci/STATUS.md`).
2. Compose: `deploy/oci/docker-compose.micro.yml` + `.env.micro`.
3. Imagen: push a `main` → GHCR `:micro` (`.github/workflows/docker-ghcr.yml`) → `docker compose pull` en la VM.
4. Vercel Production: `VITE_API_BASE=https://147.15.72.239.sslip.io`, `VITE_FREE_HOST=1`.
5. ML secrets en `.env.micro` + DevCenter redirect/webhook → Micro (`docs/ML.md`).

## Deploy Render (backup)

1. [Deploy Blueprint](https://render.com/deploy?repo=https://github.com/YukaC/AhorrAR) (o Dashboard → Blueprint → `render.yaml`)
2. Secrets `MELI_*`
3. Solo si Micro cae: apuntar Vercel `VITE_API_BASE` a Render (`deploy/oci/REVERT-RENDER.md`)

## Deploy automático (GitHub)

| Host | Qué redeploya | Señal |
|---|---|---|
| **Vercel** | frontend | check `Vercel` |
| **GHCR → OCI Micro** | imagen `:micro` | workflow `docker-ghcr.yml` · pull en VM |
| **Render** | Docker API (backup) | Deployments Render |

Push a **`main`** → UI en Vercel + imagen API. **No** hay redeploy Fly.

Env Vercel (Micro — prod):

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://147.15.72.239.sslip.io` |
| `VITE_FREE_HOST` | `1` |

Env Vercel (Render fallback):

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://ahorrar-api.onrender.com` |
| `VITE_FREE_HOST` | `1` |

Secrets API (Micro `.env.micro` o Render dashboard): `MELI_*`. `CORS_ORIGINS` debe incluir `https://ahorrarg.vercel.app`.

ML access ~6h: auto-refresh on 401 → `/data/meli_tokens.json` (Micro) o `/tmp` (Render).

## Deploy manual (emergencia)

### 1) API en OCI Micro

Ver [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md) · compose micro.

### 1a) API en Render

```bash
render blueprints validate render.yaml
```

### 1b) API en Fly — RETIRADO

Fly ya no se usa. No instalar `flyctl` ni redeployar `ahorrar-api`.

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

## Local con Docker

Simula Micro / Render slim:

```bash
docker compose up --build
# API http://localhost:4000
```

Perfil Micro compose:

```bash
cd deploy/oci
cp .env.micro.example .env.micro
docker compose -f docker-compose.micro.yml up --build
```

## Costos / límites free

| Host | Rol | Límites |
|---|---|---|
| Vercel Hobby | UI | Generoso para estático |
| **OCI Micro** | API+crawler **primario** | E2.1 ~1 GB · reserved IP |
| **OCI A1** (DISABLED) | API full futuro | 1 OCPU/6GB · cupo Oracle |
| **Render Free** | API **backup** | 512 MB · sleep 15m · 750 h/mes |
| Fly | **retirado** | — |

## Archivos

- `Dockerfile` — imagen única API+Scrapling
- `deploy/oci/` — compose micro/full, Caddy, bootstrap
- `.github/workflows/docker-ghcr.yml` — publish `:micro`
- `render.yaml` — Blueprint Free 512MB (backup)
- `fly.toml` — legado; no usar
- `vercel.json` — build frontend
- `frontend/src/lib/api-wake.ts` — wake + keep-warm (Render; opcional en Micro)
