# Changelog

Todos los cambios notables van acá (Keep a Changelog). Formato: [WIP]/[x.y.z] — fecha.

Unreleased = lo que aún no se desplegó. Los refs §T apuntan al plan en `SPEC.md`.

## [WIP]

### Added
- **ML ON en prod**: Fly secrets `MELI_*` + `INCLUDE_ML=1` (`fly.toml`); OAuth refresh documentado — §T16
- **Prod live**: UI https://ahorrarg.vercel.app (Vercel) + API https://ahorrar-api.fly.dev (Fly); GitHub `main` redeploya ambos; dominio canónico + redirects 308
- **Relevance query↔title**: filtro Node+Python — marca/modelo sola (`iphone`) exige substring; categoría sola (`perfume`) no — evita junk tipo baffle en #1
- UI: logo → home idle; link GitHub del repo en header; filtro “Solo local” eliminado; pill “Envío gratis” oculta hasta señal real (§T37)
- **Scrapling session + platform seeds**: `FetcherSession` por worker, fetch kinds `hub|api|html`, early-stop; índice `ar-shops.json` v3 (`platform`/`alive`/`entry`) + probe offline `scripts/probe_ar_shops.py`; parsers Woo Store API + Shopify suggest/products; seeds platform-aware Node↔Python; `STEALTH_FETCH` gated (off en Fly) — §T30–T33
- Streaming real por SSE: cards parciales en el frontend mientras el crawler corre — §T19/T20/T21
- Índice curado de tiendas AR `shared/ar-shops.json` expandido de 14 a **88 tiendas** (32 con entry VTEX probeado con el fetcher real): fuentes comparaya.net API + precialo.com.ar — §T29
- Test de contrato de seeds Node↔Python: misma query → mismos 24 seeds en el mismo orden (paridad §V19)
- Caché de resultados con TTL 15 min + SWR (stale + refresh en background) y clave normalizada sin tildes/orden — §T25
- Persistencia de jobs en SQLite (`node:sqlite`, env `JOBS_DB`): los jobs sobreviven al restart del backend y el frontend retoma búsquedas done tras un refresh — §T27
- Test de contrato de parsers VTEX entre el motor Node y el Python (fixture compartido en `shared/fixtures/`) — §T28
- Índice curado de tiendas AR `shared/ar-shops.json` (14 tiendas, 6 categorías) + auto-expansión — §T22
- Ranking: reputación (índice) + precio + bonus cuotas sin interés (VTEX installments) + cap ML ≤50% — §T23

### Changed
- Crawler primario: `Fetcher` one-shot → `FetcherSession` reutilizada por worker; guesses de seeds acotados por `platform` del índice (menos 404) — §T30/T32
- Crawler primario migrado de Node BFS a Scrapling (Python) con stream ndjson `POST /crawl/stream`
- `shared/contract.ts`: `ProductResult.installments?`, `SearchProgress.results?`
- Fetcher de BFS legacy (Node): política robots delegada a helper compartido `backend/src/robots.ts` — §T26

### Fixed
- Scraper: `visited` usado antes de definirse en el loop de ML (`crawl.py`)
- Seeds Node: `ALLOWED_DOMAINS` (export muerto) poblaba el caché del índice a nivel de módulo y anulaba el override `AR_SHOPS_JSON` de los tests; `categoryFor` devolvía `perfume` vs índice `perfumeria` (prioridad por categoría rota) — §B5
- `onProgress`/tipado de streaming y defaults de depth/nodesVisited
- Prod Fly desactualizado vs `main` (solo secrets redeploy): `fly deploy` con imagen nueva restableció Carrefour/iPhone vs junk Farmacity

## [0.1.0] — primeras iteraciones (histórico)

### Added
- **ML ON en prod**: Fly secrets `MELI_*` + `INCLUDE_ML=1` (`fly.toml`); OAuth refresh documentado — §T16
- API Express 5 con jobs en memoria + SSE, calendar de trading, webhook ML (stub)
- Crawler Node BFS (legacy, respaldo) y crawler Python Scrapling (primario)
- ML integrado por API oficial (products/search + products/{id}/items), token obligatorio, OFF en prod
- Frontend React/Vite con cards de precios (envío, tienda, ranking)
- SPEC.md/README/legal (MIT, PRIVACY, SECURITY, NOTICE) — `docs/` iniciales