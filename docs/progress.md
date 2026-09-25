# Progreso — AhorrAR

> Estado **actual** del proyecto: qué está hecho, en curso y falta. Fuente canónica y
> operativa: `SPEC.md` §T (plan, estados `.`/`~`/`x`) y §B (bugs). Este doc es la vista
> narrativa/temporal para arrancar cada sesión sabiendo dónde está uno; **no** duplica
> el SPEC, lo referencia. Actualizar al cerrar cada sesión (junto con §T).

## En una línea

v0.2 en **prod** (https://ahorrarg.vercel.app + https://ahorrar-api.fly.dev) · T1–T43 hechos; T17 descartado (ToS ML) · ML ON prod + circuit breaker · Scrapling + índice AR · 0 bugs §B.

## Hecho

- [x] Backend Express 5 con jobs en memoria + SSE (`/api/search/:id/events`) — §T16
- [x] Crawler Python (Scrapling) primario con BFS + parsers VTEX/HTML — §T17
- [x] ML integrado por API oficial (products/search + /items), token obligatorio — §T15
- [x] **Streaming real por SSE**: cards parciales en vivo durante el crawl (ndjson `/crawl/stream`) — §T19–T20
- [x] Frontend React muestra resultados **mientras** el crawler corre (live section) — §T21
- [x] **Descubrimiento fuerte**: índice curado `shared/ar-shops.json` (14 tiendas, categorías) + `guessSearchUrls` ampliado + auto-expansión de tiendas nuevas — §T22
- [x] **Ranking balanceado**: reputación (índice) + precio + bonus cuotas sin interés (VTEX installments) + cap ML ≤50% del top-N — §T23
- [x] **Fase 0 speed**: ML N+1 paralelo (ThreadPool + client por thread + auth por arg) + BFS batches + timeouts por tipo + ML concurrente — s24: done 24.1s→1.6s, primer offer 2-3s→0.5s — §T24
- [x] **Fase 1 caché**: `normalizeQueryKey` (lower + sin tildes + orderless) + TTL 15min + SWR (stale + bg refresh) integrado en `runLiveJob` — §T25
- [x] **Fase 2 robots**: helper compartido `robots.ts` (cache por host + fail-open) extraído de Fetcher; política de robots del primario documentada en SPEC — §T26
- [x] **Fase 3 jobs SQLite**: persistencia con `node:sqlite`, restore al arranque + reconexión SSE en frontend (resume de job done tras refresh) — §T27
- [x] **Fase 4 contrato parsers**: fixture compartido VTEX + test que corre ambos motores (Node in-process + Python vía uv) y compara name/price/url; gap installments (§V18) documentado — §T28
- [x] **Índice expandido 14→88 tiendas**: scrapeo de comparaya.net (API `/api/stores`) + precialo.com.ar (facetas `webDomains`) + probe VTEX con el fetcher real (Scrapling) → +32 entries VTEX +42 entry-null; paridad `categoryFor`/`build_seed_urls` Node↔Python con orden entries-first por categoría — §T29
- [x] **Scrapling session + platform seeds** (plan max-util):
  - `FetcherSession` por worker + kinds `hub|api|html` + early-stop — §T30
  - `ar-shops.json` v3 (`platform`/`alive`/`entry`) + `scripts/probe_ar_shops.py` → 81 alive / 7 dead (vtex 52, woo 9, unknown 26) — §T31
  - Parsers Woo Store API + Shopify suggest/products + seeds platform-aware Node↔Python — §T32
  - `STEALTH_FETCH` gated (off default Fly; nota en `docs/DEPLOY.md`); `capture_xhr` diferido (ROADMAP) — §T33
- [x] Frávega PDP itemId + prerender home SSG + UI polish — §T34–T36
- [x] **Prod**: https://ahorrarg.vercel.app + https://ahorrar-api.fly.dev · GitHub `main` → Vercel+Fly · relevance filter · header GitHub repo link
- [x] **ML ON en prod**: Fly secrets `MELI_*` + `INCLUDE_ML=1` (`fly.toml`); refresh vía `ml_login.py refresh` — §T16
- [x] **ML auto-refresh on 401** + volume `/data/meli_tokens.json` — §T38
- [x] **Speed Firecrawl-inspired** (scraper Python): caché ofertas por host (TTL 10min, dedupe, cap 30/host) + sitemap discovery (hosts no-VTEX curados, caché 24h) + probes en paralelo (pipeline 2 etapas) + warm cache populares (`WARM_CACHE=1`) — §T39–T42 · E2E: 2da búsqueda misma query 0 fetches (1008ms vs 2447ms)
- [x] **Filtro Envío gratis con señal real**: `shipping.free` desde VTEX `ShippingSLA[].Price==0` y ML `free_shipping` (gana sobre regex del hint) + pill SortBar re-activado + paridad Node↔Python (fixture contrato con ShippingSLA) — §T37 / §V25
- [x] **ML circuit breaker**: `_CircuitBreaker` en `search_mla` (threshold 3, cooldown 300s, half-open) — 401/403/429/≥400/network/shape cuentan; éxito resetea; skip rápido mientras abierto — §T43 / §V26 · tests unittest 7
- [x] **Warm cache ON en prod**: `WARM_CACHE=1` en `fly.toml` (pre-calienta 5 búsquedas populares cada 300s) — §T42

## En curso

- Nada. T17 (fallback HTML ML) **descartado por ToS** — scraping HTML no autorizado; API oficial es el único camino legal. Ver `docs/ML.md`.

## Falta

- [x] Deploy prod Vercel+Fly conectados a GitHub (`main` → redeploy UI+API)
- [x] ML ON en prod (`MELI_*` secrets + `INCLUDE_ML=1`; re-consent OK) — §T16 / `docs/ML.md`
- [x] Dominio canónico UI `ahorrarg.vercel.app` (+ redirects 308)
- [x] Live bench local (2026-09-24, scraper `:4100`, `includeMl=false`, maxResults=20):

  | query | elapsedMs | pagesFetched | #results | min price |
  |---|---:|---:|---:|---:|
  | `ryzen 5 5600` | 2001 | 11 | 20 | 226990 |
  | `perfume bensimon` | 1126 | 6 | 20 | 31843.5 |
  | `smart tv 55` | 3747 | 8 | 20 | 282999 |

## Bugs conocidos

- Ninguno abierto en `SPEC.md` §B. El error preexistente de typecheck `CrawlStats` en `backend/src/search/bfs.ts:18` (noUnusedLocals) está aceptado sin fix.

## Bloqueantes

- Ninguno. Access token ML ~6h: auto-refresh on 401 (+ persist volume). Solo re-consent manual si refresh revoke.
