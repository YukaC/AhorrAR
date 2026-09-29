# Changelog

Todos los cambios notables van acá (Keep a Changelog). Formato: [WIP]/[x.y.z] — fecha.

Unreleased = lo que aún no se desplegó. Los refs §T apuntan al plan en `SPEC.md`.

## [WIP]

### Added
- **Render Free deploy**: `render.yaml` perfil 512MB (`FETCH_WORKERS=2`, `MAX_NODES=80` techo, caches acotados) + front `api-wake.ts` (wake/keep-warm/focus) + caps UI 25→50 · entrypoint `/tmp` tokens — §T48
- **Result caps UI 25 → 50 → 100**: default 25, botón "Mostrar más", API `maxResults` 1–100; caché claveada por cap (`producto:n25`) — §T46/§V17/§V18
- **SearchBar sync**: chips populares / resume / retry escriben el query en el input
- **Design system Tailwind v4**: tokens semánticos (`background`/`primary`/`muted`/…) + Geist self-hosted + dark vía CSS vars (sin pares `dark:*`) — theme toggle con View Transitions (fade 320ms)
- **Relevance anti-accesorio / class evidence**: categoría sola exige sinónimo; reject funda/RAM/crema/para X; ranking con relevance tier — §T44–T45/§V27/§V28
- **ML auto-refresh on 401**: `meli_auth.py` + persist `MELI_TOKEN_FILE` (Fly volume `/data`) — §T38
- **ML ON en prod**: Fly secrets `MELI_*` + `INCLUDE_ML=1` (`fly.toml`); OAuth refresh documentado — §T16
- **Prod live**: UI https://ahorrarg.vercel.app (Vercel) + API https://ahorrar-api.fly.dev (Fly); GitHub `main` redeploya ambos; dominio canónico + redirects 308
- **Relevance query↔title**: filtro Node+Python — marca/modelo sola (`iphone`) exige substring; categoría sola (`perfume`) no — evita junk tipo baffle en #1
- **Envío gratis con señal real**: `shipping.free` desde VTEX `ShippingSLA[].Price==0` y ML `free_shipping` (gana sobre regex del hint) · pill SortBar re-activado · paridad Node↔Python (fixture contrato con ShippingSLA) — §T37/§V25
- **Speed Firecrawl-inspired** (scraper Python): caché de ofertas por host (TTL 10min, dedupe, cap 30/host) · sitemap discovery (hosts no-VTEX curados, caché 24h) · probes en paralelo (pipeline 2 etapas) · warm cache de búsquedas populares (`WARM_CACHE=1`) — §T39–T42 · E2E: 2da búsqueda misma query 0 fetches (1008ms vs 2447ms) · **conceptos reimplementados desde cero, sin código de Firecrawl (AGPL-3.0)** — atribución en `docs/ATTRIBUTIONS.md` + `NOTICE`
- **ML circuit breaker**: `_CircuitBreaker` en `search_mla` (threshold 3, cooldown 300s, half-open) — tras N fallos consecutivos skip ML por cooldown; éxito resetea; búsqueda degrada sin ML, nunca falla — §T43/§V26
- **Warm cache ON en prod**: `WARM_CACHE=1` en `fly.toml` — §T42
- **Tema automático del dispositivo**: `useTheme` sigue `prefers-color-scheme` del SO (incluidos cambios en vivo) y persiste en `localStorage` **solo tras un toggle manual** — 3 tests nuevos
- UI: logo → home idle; link GitHub del repo en header; filtro “Solo local” eliminado
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
- Top-N UI/API: default **25**, steps **50/100** (antes ≤20); `MAX_RESULTS`/`MAX_NODES` Fly → 25/120; early-stop scraper al cap pedido (ya no corta en 8) — §T46
- Crawler primario: `Fetcher` one-shot → `FetcherSession` reutilizada por worker; guesses de seeds acotados por `platform` del índice (menos 404) — §T30/T32
- Crawler primario migrado de Node BFS a Scrapling (Python) con stream ndjson `POST /crawl/stream`
- `shared/contract.ts`: `ProductResult.installments?`, `SearchProgress.results?`
- Fetcher de BFS legacy (Node): política robots delegada a helper compartido `backend/src/robots.ts` — §T26

### Fixed
- Theme toggle dark→light: View Transition con old-layer fade (crossfade default se “lavaba”)
- Scraper: `visited` usado antes de definirse en el loop de ML (`crawl.py`)
- Seeds Node: `ALLOWED_DOMAINS` (export muerto) poblaba el caché del índice a nivel de módulo y anulaba el override `AR_SHOPS_JSON` de los tests; `categoryFor` devolvía `perfume` vs índice `perfumeria` (prioridad por categoría rota) — §B5
- `onProgress`/tipado de streaming y defaults de depth/nodesVisited
- Prod Fly desactualizado vs `main` (solo secrets redeploy): `fly deploy` con imagen nueva restableció Carrefour/iPhone vs junk Farmacity

## [0.1.0] — primeras iteraciones (histórico)

### Added
- **ML auto-refresh on 401**: `meli_auth.py` + persist `MELI_TOKEN_FILE` (Fly volume `/data`) — §T38
- **ML ON en prod**: Fly secrets `MELI_*` + `INCLUDE_ML=1` (`fly.toml`); OAuth refresh documentado — §T16
- API Express 5 con jobs en memoria + SSE, calendar de trading, webhook ML (stub)
- Crawler Node BFS (legacy, respaldo) y crawler Python Scrapling (primario)
- ML integrado por API oficial (products/search + products/{id}/items), token obligatorio, OFF en prod
- Frontend React/Vite con cards de precios (envío, tienda, ranking)
- SPEC.md/README/legal (MIT, PRIVACY, SECURITY, NOTICE) — `docs/` iniciales