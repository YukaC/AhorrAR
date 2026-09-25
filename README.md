# AhorrAR

Comparador de precios **live** (Argentina). Ingresás **[PRODUCTO]** y el sistema
rankea ofertas **reales** con envío confirmado, imagen y link + calendario comercial AR.

## Arquitectura

| Capa | Rol |
|---|---|
| **`scraper/`** (PRIMARY) | [Scrapling](https://github.com/d4vinci/Scrapling) — TLS impersonate, SERP + VTEX API |
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

Ver [`docs/DEPLOY.md`](docs/DEPLOY.md):

```bash
# API + Scrapling → Fly.io
./scripts/deploy-api.sh

# UI → Vercel (seteá VITE_API_BASE=https://ahorrar-api.fly.dev)
./scripts/deploy-frontend.sh --prod
```

## Docs

- SPEC: [`SPEC.md`](SPEC.md)
- Scraper: [`scraper/README.md`](scraper/README.md)
- API: [`docs/API.md`](docs/API.md)
- Deploy: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- Mercado Libre: [`docs/ML.md`](docs/ML.md)
- Arquitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Progreso: [`docs/progress.md`](docs/progress.md) · Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Decisiones (ADRs): [`docs/decisions/`](docs/decisions/)

## License & legal

- License: [MIT](LICENSE)
- Privacy: [PRIVACY.md](PRIVACY.md)
- Security: [SECURITY.md](SECURITY.md)
- Third-party notices: [NOTICE](NOTICE)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
