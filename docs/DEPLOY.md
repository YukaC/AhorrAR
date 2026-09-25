# Deploy — Vercel (UI) + Render Free (API + Scrapling) · Fly opcional

## URLs canónicas

| Qué | URL |
|---|---|
| UI (prod) | https://ahorrarg.vercel.app |
| API health (Render) | `https://<servicio>.onrender.com/api/health` (tras Blueprint) |
| API health (Fly, opcional) | https://ahorrar-api.fly.dev/api/health |
| Repo | https://github.com/YukaC/AhorrAR |

Aliases Vercel (`ahorrar-wine.vercel.app`, `*-yukas-projects-*.vercel.app`, …) → **308** → `ahorrarg.vercel.app`.

## Arquitectura

```
Browser → Vercel Hobby (frontend)  https://ahorrarg.vercel.app
              │  VITE_API_BASE=https://<api>.onrender.com
              │  VITE_FREE_HOST=1  (caps UI 25→50)
              │  JS: wake /api/health + keep-warm 12m + focus ping
              ▼
         Render Free (Docker)  Node :4000 + Scrapling :4100
              512MB profile — see render.yaml
```

Vercel **no** corre el crawler. Render Free: spin-down ~15m idle, cold ~1m, **512 MB**, sin disco (tokens en env + `/tmp`).

### Optimizaciones free (JS + perfil RAM 512MB)

| Capa | Qué |
|---|---|
| Front JS | `api-wake.ts`: ping health antes de buscar + al focus del input; keep-warm cada 12m (tab visible) |
| UX | LoadingState “Despertando…”; caps UI **25→50** (`VITE_FREE_HOST=1`, sin 100) |
| Fetch RAM | `FETCH_WORKERS=2` (menos FetcherSession) · límites hub/api/html bajos · batch/probe chicos |
| Crawl | `MAX_NODES=80` techo real (`nodesBudgetFor` ceiling) · ML workers 3 · sin warm cache |
| Caches | offer_cache 24×12 · SearchCache max 32 · sitemap 3 hosts |
| Runtime | `NODE_OPTIONS=160MB` · `MALLOC_ARENA_MAX=2` · uvicorn concurrency 2 |
| Tokens | `MELI_*` secrets; archivo `/tmp` (efímero) |

**No** cron 24/7: quema las 750 Free instance-hours. Dormido = $0 horas.

## Deploy Render (primera vez)

1. [Dashboard Render](https://dashboard.render.com/) → **New → Blueprint** → repo `YukaC/AhorrAR` → `render.yaml`
2. Completar secrets `sync: false` (MELI_*)
3. Esperar build Docker + health `/api/health`
4. Vercel env Production:
   - `VITE_API_BASE=https://<nombre>.onrender.com`
   - `VITE_FREE_HOST=1`
5. Redeploy frontend

## Deploy automático (GitHub)

| Host | Qué redeploya | Señal |
|---|---|---|
| **Vercel** | frontend | check `Vercel` |
| **Render** | Docker API (`render.yaml`) | Deployments Render |
| **Fly** (opcional) | si seguís usando Fly | check `Fly.io` |

Push a **`main`** → UI + API (Blueprint autoDeploy).

Env Vercel:

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://<api>.onrender.com` |
| `VITE_FREE_HOST` | `1` |

Secrets Render: `MELI_ACCESS_TOKEN`, `MELI_REFRESH_TOKEN`, `MELI_APP_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`. `CORS_ORIGINS` en `render.yaml`.

ML access ~6h: auto-refresh on 401 → `/tmp`. Tras sleep, entrypoint re-siembra desde secrets. Si refresh falla (revoke): `cd scraper && uv run python scripts/ml_login.py refresh` y re-setear secrets.

### Warm cache

`WARM_CACHE=0` en Render free. Fly puede usar `1`.

## Deploy manual (emergencia)

### 1) API en Render

```bash
render blueprints validate render.yaml
```

Health: `https://<servicio>.onrender.com/api/health`

### 1b) API en Fly (alternativa)

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
chmod +x scripts/deploy-api.sh
FLY_APP=ahorrar-api ./scripts/deploy-api.sh
```

`fly.toml`: `CRAWLER=scrapling`, `MAX_NODES=400` (techo tras fix `nodesBudgetFor`). Volume: `fly volumes create meli_data --region gru --size 1 -a ahorrar-api`

### Stealth fetch (opcional, solo local)

```bash
cd scraper && uv run scrapling install
STEALTH_FETCH=1 npm run dev:scraper
```

Imagen Docker = HTTP-only (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). Prod: `STEALTH_FETCH` unset/`0`.

### 2) Frontend en Vercel

```bash
chmod +x scripts/deploy-frontend.sh
./scripts/deploy-frontend.sh --prod
```

Root: **repo root** (`vercel.json` → `frontend/dist`).

## Orden recomendado (primera vez)

1. Blueprint Render → health OK  
2. Vercel `VITE_API_BASE` + `VITE_FREE_HOST=1`  
3. Push `main` / redeploy Vercel  
4. UI: https://ahorrarg.vercel.app  

## Local con Docker (simula 512MB)

```bash
docker compose up --build
# API http://localhost:4000  (mem_limit 512m)
```

## Costos / límites free

| Host | Rol | Límites |
|---|---|---|
| Vercel Hobby | UI | Generoso para estático |
| **Render Free** | API+crawler | 512 MB · sleep 15m · 750 h/mes · sin disco |
| Fly (card) | API+crawler | Mejor fit; volume ML |
| Railway créditos | API | Se agota |

## Archivos

- `Dockerfile` — imagen única API+Scrapling  
- `render.yaml` — Blueprint Free 512MB  
- `fly.toml` — app `ahorrar-api` (opcional)  
- `docker-compose.yml` — smoke local con `mem_limit: 512m`  
- `vercel.json` — build frontend  
- `frontend/src/lib/api-wake.ts` — wake + keep-warm  
