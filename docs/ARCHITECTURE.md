# Arquitectura — AhorrAR

> Cómo está armado el proyecto y por qué. Fuente canónica: `SPEC.md`
> (en especial §C decisiones y §I interfaces). Este doc es la vista ampliada y
> navegable de la estructura; no reemplaza al SPEC. La parte de "por qué se
> tomaron estas decisiones" vive en `docs/decisions/` (ADRs).

## Vista general

```
 ┌───────────┐  SSE cards en vivo    ┌─────────────────────┐
 │ frontend  │ ────────────────────► │  backend (Express)  │
 │ React/Vite│ ◄────── JSON result ── │  :4000 · jobs in-mem│
 └───────────┘                        └──────────┬──────────┘
          :5173                     runLiveSearch │  crawler: auto
                                                  │  (Scrapling → legacy fallback)
                                                  ▼
                                    ┌──────────────────────────┐
                                    │  scraper (FastAPI)  :4100 │
                                    │  Scrapling BFS + parsers  │
                                    │  VTEX API / HTML / ML API │
                                    │  POST /crawl/stream ndjson│
                                    └──────────┬───────────────┘
                                               │
                       ┌───────────────────────┼───────────────────┐
                       ▼                       ▼                   ▼
              shared/ar-shops.json     MercadoLibre API      Tiendas AR (VTEX/HTML)
              (índice curado,          (solo token oficial)  (BFS + guessSearchUrls)
               auto-expansión V19)
```

## Stack y versiones

| Capa | Tecnología | Versión |
|---|---|---|
| Backend runtime | Node.js | >=22.18 |
| Backend framework | Express | 5.x |
| Frontend | React + Vite | 19.x / 7.x |
| Types / contratos | TypeScript estricto | 7.x |
| Crawler primario | Python + Scrapling | >=3.12 / >=0.4.15 |
| Crawler API | FastAPI + Uvicorn | 0.115.x / 0.32.x |
| Crawler legacy | Node BFS + Crawlee + Playwright | 3.x / 1.63 |
| Tests | Vitest | 5.x |

Stack, límites y restricciones exactas: `SPEC.md` §C.

## Estructura de módulos

```
backend/src/            Express 5 — API + jobs en memoria
├── server.ts           rutas /api/search·id·events, /api/calendar, /webhooks/ml
├── config.ts           config por env (port, crawler, maxDepth/maxResults/maxNodes)
├── jobs.ts             job store in-memory + SSE fan-out (TTL cleanup)
├── search/             búsqueda en vivo: seeds, scrapling-client, bfs legacy, fetcher
│   ├── seeds.ts        índice ar-shops (load/register, guessSearchUrls, buildSeedUrls)
│   ├── scrapling-client.ts  stream ndjson ← scraper :4100 (primario)
│   ├── bfs.ts          BFS legacy (respaldo)
│   └── parsers/        extractores de página (VTEX / HTML)
├── scoring/score.ts    ranking: reputación + precio + cuotas sin interés, cap ML 50%
├── pipeline.ts         finalizeRawItem → ProductResult (validación §V)
├── calendar/           feriados/eventos de trading por país
└── utils/              logger

shared/                 contratos compartidos Node↔frontend
├── contract.ts         SearchParams/ProductResult/SearchResponse/SSE guards
└── ar-shops.json       índice de tiendas AR (¡misma fuente que Python! §V19)

scraper/src/ahorrar_scraper/
├── server.py           FastAPI :4100 — POST /crawl (sync) y /crawl/stream (ndjson SSE)
├── crawl.py            BFS con callbacks on_offer/on_progress + auto-expansión índice
├── seeds.py            seeds espejo del índice ar-shops (mismo JSON que Node)
├── parsers.py          _parse_vtex_catalog (JSON API), _parse_vtex_installments, HTML
└── meli_api.py         MercadoLibre API oficial (products/search + /items), token obligatorio

frontend/src/
├── App.tsx             búsqueda + sección de cards en vivo durante el crawl
├── hooks/useSearch.ts  estado de búsqueda (SSE)
├── api/client.ts       cliente + guards de contrato (isSearchProgress, isProductResult)
├── components/         PriceCard (precio, cuotas sin interés, envío, tienda)
└── lib/                format (precio ARS, host, iniciales)
```

> Regla: **no poner lógica de negocio en componentes de React**. El ranking y la
> validación viven en backend (`scoring/` + `pipeline.ts`); el frontend solo renderiza.

## Componentes clave

- **Flujo live (primario)**: `POST /api/search` → job → `runLiveJob` →
  `runLiveSearch` → `crawlViaScraplingStream` (lee ndjson del scraper) →
  `rankByPriority` → job `done` + SSE. Las cards parciales se emiten por
  `SearchProgress.results` mientras el crawler corre (§V16).
- **Ranking (§V17/V18)**: `scoreFor` = tier local/intl + precio efectivo con
  descuento reputación (índice curado/discovered) + bonus cuotas sin interés;
  `rankByPriority` clampa ML a ≤50% del top-N y ranks contiguos 1..n.
- **Seeds compartidas (§V19)**: `buildSeedUrls` = hubs SERP + índice curado
  (entry VTEX o guessSearchUrls) + ML (solo si token). Descubrimiento nuevo →
  `registerDiscoveredShop` persiste en `ar-shops.json` (tmp+rename atómico) desde
  Node y Python indistintamente.
- **ML (§C.12/§V17)**: solo API oficial (`products/search` + `products/{id}/items`),
  nunca el HTML de listado; `installments` no existe en la API → solo VTEX.

## Decisiones pasadas

Ver `docs/decisions/` (ADRs).

## Producción

| Pieza | URL |
|---|---|
| UI | https://ahorrarg.vercel.app |
| API | https://ahorrar-api.fly.dev |
| Repo | https://github.com/YukaC/AhorrAR |

Push a `main` redeploya Vercel + Fly. Detalle: `docs/DEPLOY.md`.

## Deuda / notas

- Caché de resultados: TTL 15 min + SWR (§T25); hosts del índice no re-descubren URL scheme.
- `crawl/stream` con `maxResults=10` y `maxDepth=3` tarda ~24 s en "samsung s24",
  pero los primeros partials llegan en ~2–3 s (SSE en vivo).
- ML ON en prod (`INCLUDE_ML=1` + secrets `MELI_*`). Token ~6h → refresh + re-set Fly secrets (`docs/ML.md`).