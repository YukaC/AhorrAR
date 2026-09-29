# AhorrAR

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Scrapling](https://img.shields.io/badge/crawler-Scrapling-0ea5e9)](https://github.com/d4vinci/Scrapling)
[![Demo](https://img.shields.io/badge/demo-ahorrarg.vercel.app-black)](https://ahorrarg.vercel.app)

Comparador de precios **live** en Argentina ([demo](https://ahorrarg.vercel.app)).
Ingresás un producto y el sistema rankea ofertas **reales** con envío confirmado,
imagen y link + calendario comercial AR. Stack: Scrapling + Express + React · SSE en vivo · tiendas AR (VTEX/Woo/Shopify).

**Repo:** [github.com/YukaC/AhorrAR](https://github.com/YukaC/AhorrAR) · **UI:** https://ahorrarg.vercel.app · **API:** https://147.15.72.239.sslip.io (OCI Micro)

## Arquitectura

| Capa | Rol |
|---|---|
| **`scraper/`** (PRIMARY) | [Scrapling](https://github.com/d4vinci/Scrapling) — TLS impersonate, SERP + VTEX/Woo/Shopify |
| **`backend/`** (API + secondary) | Express: jobs/SSE/shipping/scoring · Node BFS legacy si Scrapling cae |
| **`frontend/`** | React 19 + Vite 7 + Tailwind 4 |
| Contrato | [`shared/contract.ts`](shared/contract.ts) |

MercadoLibre: **ON en prod** (`INCLUDE_ML=1` + API OAuth). Local: `INCLUDE_ML=0` hasta setear `scraper/.env` (`docs/ML.md`).

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

Live: **https://ahorrarg.vercel.app** (Vercel) + **https://147.15.72.239.sslip.io** (OCI Micro E2.1).

| Rol | Host |
|---|---|
| UI | Vercel Hobby |
| API **primario** | OCI Micro (`147.15.72.239.sslip.io`) |
| API **backup** | Render Free (`ahorrar-api.onrender.com`) |
| Fly | **muerto** — no usar |

Detalle: [`docs/PROD.md`](docs/PROD.md) · [`docs/DEPLOY.md`](docs/DEPLOY.md).

- Push a `main` → Vercel (UI) + GHCR imagen API ([`.github/workflows/docker-ghcr.yml`](.github/workflows/docker-ghcr.yml)) → pull en Micro.
- Caps UI en Micro: `VITE_FREE_HOST=1` (25→50). A1 futuro: `VITE_FREE_HOST=0`.
- Canónico UI: `ahorrarg.vercel.app` (aliases → 308).
- CORS: `CORS_ORIGINS=https://ahorrarg.vercel.app,http://localhost:5173`

## Docs

- SPEC: [`SPEC.md`](SPEC.md)
- Scraper: [`scraper/README.md`](scraper/README.md)
- API: [`docs/API.md`](docs/API.md)
- Deploy: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- Crawl policy: [`docs/CRAWL.md`](docs/CRAWL.md)
- Golden baseline: [`docs/golden-baseline.md`](docs/golden-baseline.md)
- ML coverage: [`docs/ML-COVERAGE.md`](docs/ML-COVERAGE.md)
- Mercado Libre: [`docs/ML.md`](docs/ML.md)
- Arquitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Progreso: [`docs/progress.md`](docs/progress.md) · Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Decisiones (ADRs): [`docs/decisions/`](docs/decisions/)
- Agentes: [`AGENTS.md`](AGENTS.md)

## License & legal

- License: [MIT](LICENSE)
- Privacy: [PRIVACY.md](PRIVACY.md)
- Security: [SECURITY.md](SECURITY.md)
- Crawl policy: [docs/CRAWL.md](docs/CRAWL.md)
- Third-party notices: [NOTICE](NOTICE)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
