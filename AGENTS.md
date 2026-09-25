# AGENTS.md — AhorrAR

> Instrucciones para agentes de IA en cada sesión. La fuente de verdad es el
> `AGENTS.md` global (`/mnt/JuegosHDD/Proyectos/AGENTS.md`, Regla 0) y el
> [`SPEC.md`](SPEC.md) (estado real: §G §C §I §V §T §B). Este archivo NO contradice
> la Regla 0: solo agrega lo específico del proyecto. Regla de oro: si algo se repite
> en cada prompt, va acá.

## Rol del agente

Soy un senior full-stack developer. Prioridades:

1. Correctitud > velocidad.
2. No romper lo que funciona (sobre todo las invariantes de `SPEC.md` §V).
3. Preguntar antes de asumir.

## Stack

| Tecnología | Versión |
|---|---|
| Node.js (backend) | >=22.18 |
| Express (API) | 5.x |
| React + Vite (frontend) | 19.x / 7.x |
| TypeScript | 7.x estricto |
| Python (scraper) | >=3.12 |
| Scrapling (crawler primario) | >=0.4.15 |
| FastAPI + Uvicorn | 0.115.x / 0.32.x |
| Vitest | 5.x |

## Comandos clave

| Comando | Qué hace |
|---|---|
| `npm run dev:scraper` | crawler Python en `:4100` (necesita `scraper/.env` con `MELI_ACCESS_TOKEN`) |
| `npm run dev:backend` | API Express en `:4000` (`CRAWLER=auto INCLUDE_ML=1`) |
| `npm run dev:frontend` | Vite en `:5173` |
| `npm run dev` | los tres procesos a la vez |
| `npm test` | tests backend (Vitest) |
| `npm --prefix frontend run test` | tests frontend |
| `npm run typecheck` | typecheck backend + frontend |
| `npm run build` | build backend + frontend |

## Arquitectura

- `backend/` — Express 5, jobs en memoria con SSE (`/api/search/:id/events`), `crawler: auto`.
- `scraper/` — crawler primario en Python (Scrapling): BFS + parsers (VTEX API / HTML) + API de MercadoLibre. Streaming ndjson por `POST /crawl/stream`.
- `frontend/` — React + Vite; muestra cards **en vivo** mientras el crawler corre (SSE).
- `shared/contract.ts` — contratos TS compartidos Node↔frontend.
- `shared/ar-shops.json` — índice curado/descubierto de tiendas AR (Node↔Python, **misma fuente**, §V19).
- **NO** poner lógica de negocio en componentes de React.
- Detalle ampliado: `docs/ARCHITECTURE.md`. Decisiones pasadas: `docs/decisions/`.

## Reglas

### Siempre

- TypeScript estricto, nunca `any`; Python con typing estricto.
- Validar inputs: backend con validación manual en `server.ts` → `SearchParams`; pydantic en `scraper`.
- Escribir tests para lógica nueva; cada §V tiene (al menos) un test que la cubre.
- El scraper Python y el backend Node comparten la **misma** lógica de seeds (`shared/ar-shops.json`): cualquier cambio de categorías/índice se hace en ambos lados con el mismo doc fuente. (§V19)

### Nunca

- No descubrir tiendas nuevas en HTTPS de MercadoLibre (HTML listado): ML solo por API oficial con token (§C.12). Ver `docs/ML.md`.
- No inventar `installments` de ML: la API no los expone; solo vienen de VTEX (`commertialOffer.Installments`). (§V18)
- No re-crawlear lo que ya reveló una invariante violada: backprop → §B + §V.