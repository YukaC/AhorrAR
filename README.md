# AhorrAR

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Scrapling](https://img.shields.io/badge/crawler-Scrapling-0ea5e9)](https://github.com/d4vinci/Scrapling)
[![Demo](https://img.shields.io/badge/demo-ahorrarg.vercel.app-black)](https://ahorrarg.vercel.app)

Comparador de precios **live** en Argentina ([demo](https://ahorrarg.vercel.app)).
Ingresás un producto y el sistema rankea ofertas **reales** con envío confirmado,
imagen y link + calendario comercial AR. Stack: Scrapling + Express + React · SSE en vivo · tiendas AR (VTEX/Woo/Shopify).

**Repo:** [github.com/YukaC/AhorrAR](https://github.com/YukaC/AhorrAR) · **UI:** https://ahorrarg.vercel.app · **API:** https://ahorrar-api.fly.dev

## Arquitectura

| Capa | Rol |
|---|---|
| **`scraper/`** (PRIMARY) | [Scrapling](https://github.com/d4vinci/Scrapling) — TLS impersonate, SERP + VTEX/Woo/Shopify |
| **`backend/`** (API + secondary) | Express: jobs/SSE/shipping/scoring · Node BFS legacy si Scrapling cae |
| **`frontend/`** | React 19 + Vite 7 + Tailwind 4 |
| Contrato | [`shared/contract.ts`](shared/contract.ts) |

MercadoLibre: **apagado por defecto** (`INCLUDE_ML=0`) hasta cerrar estrategia (API OAuth / proxy / StealthyFetcher).

## Requisitos

- Node ≥ 22.18
- Python ≥ 3.12 + [uv](https://github.com/astral-sh/uv)
- Chromium Playwright solo para **legacy** Node: `cd backend && npx playwright install chromium`

## Setup

```bash
npm run install:all
cd scraper && uv sync
```

## Correr

```bash
# Terminal A — Scrapling primary (:4100)
npm run dev:scraper

# Terminal B — API (:4000)  CRAWLER=auto
npm run dev:backend

# Terminal C — UI (:5173)
npm run dev:frontend
```

O todo junto: `npm run dev`.

Env útil (`backend/.env.example`):

- `CRAWLER=auto|scrapling|legacy`
- `SCRAPLING_URL=http://127.0.0.1:4100`
- `INCLUDE_ML=0`

## Deploy (prod)

Live: **https://ahorrarg.vercel.app** (Vercel) + **https://ahorrar-api.fly.dev** (Fly).

Detalle en [`docs/DEPLOY.md`](docs/DEPLOY.md):

- **Vercel** y **Fly** están conectados al repo GitHub: un push a `main` redeploya UI y API.
- Deploy manual de emergencia:
  ```bash
  ./scripts/deploy-api.sh          # Fly (API + Scrapling)
  ./scripts/deploy-frontend.sh --prod  # Vercel
  ```
- Canónico UI: `ahorrarg.vercel.app` (otros aliases del proyecto → 308 ahí).
- CORS Fly: `CORS_ORIGINS=https://ahorrarg.vercel.app,http://localhost:5173`

## Docs

- SPEC: [`SPEC.md`](SPEC.md)
- Scraper: [`scraper/README.md`](scraper/README.md)
- API: [`docs/API.md`](docs/API.md)
- Deploy: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- Mercado Libre: [`docs/ML.md`](docs/ML.md)
- Arquitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Progreso: [`docs/progress.md`](docs/progress.md) · Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Decisiones (ADRs): [`docs/decisions/`](docs/decisions/)
- Agentes: [`AGENTS.md`](AGENTS.md)

## License & legal

- License: [MIT](LICENSE)
- Privacy: [PRIVACY.md](PRIVACY.md)
- Security: [SECURITY.md](SECURITY.md)
- Third-party notices: [NOTICE](NOTICE)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
