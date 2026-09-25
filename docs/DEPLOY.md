# Deploy — Vercel (UI) + Fly.io (API + Scrapling)

## URLs canónicas

| Qué | URL |
|---|---|
| UI (prod) | https://ahorrarg.vercel.app |
| API health | https://ahorrar-api.fly.dev/api/health |
| Repo | https://github.com/YukaC/AhorrAR |

Otros aliases Vercel del proyecto (`ahorrar-wine.vercel.app`, `*-yukas-projects-*.vercel.app`, `ahorrar-git-main-…`) redirigen **308** → `ahorrarg.vercel.app`.

## Arquitectura

```
Browser → Vercel Hobby (frontend estático)  https://ahorrarg.vercel.app
              │  VITE_API_BASE=https://ahorrar-api.fly.dev
              ▼
         Fly.io (Docker)  Node :4000 + Scrapling :4100 (mismo contenedor)
```

Vercel **no** corre el crawler. Fly corre API + Scrapling en una VM `shared-cpu-1x` / 1 GB (auto-stop en idle = ahorro free/trial).

## Deploy automático (GitHub)

Ambos hosts están **conectados al repo** `YukaC/AhorrAR`:

| Host | Qué redeploya | Señal en GitHub |
|---|---|---|
| **Vercel** | frontend (`vercel.json` → `frontend/`) | commit status `Vercel` |
| **Fly** | imagen Docker API+Scrapling | Deployments / check `Fly.io` |

Push a **`main`** → UI + API. No hace falta `vercel`/`fly` CLI en el día a día.

> **Importante:** Vercel ≠ GitHub Releases. Los tags Releases no disparan deploy. El status de Vercel vive en el **check del commit**; Fly en **Deployments**.

Env Vercel (Production / Preview):

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://ahorrar-api.fly.dev` |

Secret Fly:

```bash
fly secrets set CORS_ORIGINS=https://ahorrarg.vercel.app,http://localhost:5173 -a ahorrar-api

# ML ON (prod): tokens desde scraper/.env tras OAuth / refresh
# set -a; . scraper/.env; set +a
fly secrets set \
  MELI_ACCESS_TOKEN="$MELI_ACCESS_TOKEN" \
  MELI_REFRESH_TOKEN="$MELI_REFRESH_TOKEN" \
  MELI_APP_ID="$MELI_APP_ID" \
  MELI_CLIENT_SECRET="$MELI_CLIENT_SECRET" \
  MELI_REDIRECT_URI="$MELI_REDIRECT_URI" \
  MELI_SITE_ID=MLA \
  INCLUDE_ML=1 \
  -a ahorrar-api
```

`fly.toml` también fija `INCLUDE_ML=1`. Access token ~6h: `cd scraper && uv run python scripts/ml_login.py refresh` → re-setear los dos secrets de token.

## Deploy manual (emergencia)

### 1) API en Fly.io

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
chmod +x scripts/deploy-api.sh
FLY_APP=ahorrar-api ./scripts/deploy-api.sh
# o: fly deploy -a ahorrar-api --ha=false
```

Health: `https://ahorrar-api.fly.dev/api/health`

`fly.toml` fija `CRAWLER=scrapling` (sin Playwright en la imagen).

### Stealth fetch (opcional, solo local)

La cascada antibot `STEALTH_FETCH=1` usa Scrapling `StealthyFetcher` (browser). La imagen Fly/Docker sigue **HTTP-only** (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

```bash
cd scraper && uv run scrapling install
STEALTH_FETCH=1 npm run dev:scraper
```

Prod: dejar `STEALTH_FETCH` unset/`0`.

### 2) Frontend en Vercel

```bash
chmod +x scripts/deploy-frontend.sh
./scripts/deploy-frontend.sh --prod
```

Root Directory: **repo root** (`vercel.json` → `frontend/dist`).

## Orden recomendado (primera vez / recovery)

1. `fly deploy` → health OK  
2. Vercel env `VITE_API_BASE=https://ahorrar-api.fly.dev`  
3. Push a `main` o `vercel --prod`  
4. `fly secrets set CORS_ORIGINS=https://ahorrarg.vercel.app,http://localhost:5173 -a ahorrar-api`  
5. Confirmar UI canónica: https://ahorrarg.vercel.app  

## Local con Docker

```bash
docker compose up --build
# API http://localhost:4000
```

## Costos / límites free

| Host | Rol | Límites |
|---|---|---|
| Vercel Hobby | UI | Generoso para estático |
| Fly free/trial | API+crawler | Pocas VMs; auto_stop ayuda; crawler concurrente limitado |
| Railway free | — | Se agota rápido con crawlers |

Para “muchos users”: rate-limit + cache de búsquedas + `min_machines_running=1` pago chico, o VPS.

## Archivos

- `Dockerfile` — imagen única API+Scrapling  
- `fly.toml` — app `ahorrar-api`, región `gru`  
- `docker-compose.yml` — smoke local  
- `vercel.json` — build frontend desde monorepo  
- `scripts/deploy-*.sh`
