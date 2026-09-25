# Deploy — Vercel (UI) + Fly.io (API + Scrapling)

## Arquitectura

```
Browser → Vercel Hobby (frontend estático)
              │  VITE_API_BASE
              ▼
         Fly.io (Docker)  Node :4000 + Scrapling :4100 (mismo contenedor)
```

Vercel **no** corre el crawler. Fly corre API + Scrapling en una VM `shared-cpu-1x` / 1 GB (auto-stop en idle = ahorro free/trial).

## 1) API en Fly.io

```bash
# una vez
curl -L https://fly.io/install.sh | sh
fly auth login

# desde la raíz del repo
chmod +x scripts/deploy-api.sh
FLY_APP=ahorrar-api ./scripts/deploy-api.sh
# o: fly deploy
```

Health: `https://ahorrar-api.fly.dev/api/health`

Secrets útiles:

```bash
fly secrets set CORS_ORIGINS=https://TU-APP.vercel.app,http://localhost:5173
# opcional ML:
# fly secrets set MELI_ACCESS_TOKEN=... INCLUDE_ML=1
```

`fly.toml` ya fija `CRAWLER=scrapling` (sin Playwright en la imagen).

### Stealth fetch (opcional, solo local)

La cascada antibot `STEALTH_FETCH=1` usa Scrapling `StealthyFetcher` (browser). La imagen Fly/Docker sigue **HTTP-only** (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`); no hace falta browsers en prod.

En local, si querés reintentos ante 403/challenge:

```bash
# una vez (instala browsers de Scrapling/Playwright)
cd scraper && uv run scrapling install
# o: uv run playwright install chromium

STEALTH_FETCH=1          # default 0
# STEALTH_PROXY=http://user:pass@host:port   # opcional
npm run dev:scraper
```

Prod: dejar `STEALTH_FETCH` unset/`0`. Cobertura de tiendas viene del índice + APIs (VTEX/Woo/Shopify), no del browser.

## 2) Frontend en Vercel

```bash
npm i -g vercel   # o usá npx
chmod +x scripts/deploy-frontend.sh
./scripts/deploy-frontend.sh        # preview
./scripts/deploy-frontend.sh --prod # production
```

Root Directory: **repo root** (usa `vercel.json` → build `frontend/`).

Env Production / Preview:

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://ahorrar-api.fly.dev` |

Redeploy después de setear `VITE_API_BASE`.

## 3) Orden recomendado

1. `fly deploy` → anotá la URL del API  
2. Vercel env `VITE_API_BASE`  
3. `vercel --prod`  
4. `fly secrets set CORS_ORIGINS=https://….vercel.app`

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
