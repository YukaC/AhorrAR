# SPEC — AhorrAR / price scraper recursivo geolocalizado full-stack

§G
Comparador de precios AR: [PRODUCTO] → crawler LIVE rankea ofertas REALES (precio, link, imagen) sitios AR + filtros/orden + banner evento. ⊥ mock/demo.

§C
- stack: Node 26 TS API/UI + **Scrapling Python PRIMARY** (`scraper/`) · Express 5 · React 19 · Vite 7 · Tailwind 4
- monorepo: backend/ + frontend/ + scraper/ + shared/contract.ts
- crawl PRIMARY: Scrapling `FetcherSession` per worker (TLS impersonate rotativo) · fetch kinds `hub|api|html` · SERP + VTEX/Woo/Shopify JSON · early-stop agresivo · `STEALTH_FETCH` gated (default off prod; browser cascade solo local/opt-in) · ⊥ `capture_xhr`/Spiders (ROADMAP)
- discovery AR: hubs SERP + VTEX + guessSearchUrls platform-aware (índice `platform`+`entry` → 1 URL; `alive:false` ⊥ seed) + **índice curado v3 `shared/ar-shops.json`** (gaming/perfumeria/electro/moda/bazar · `platform`/`alive`/`entry`) · probe offline `scripts/probe_ar_shops.py` · auto-expansión: tienda nueva con results se agrega al índice (persistida) · ⊥ indexar resultados directos del índice (siempre crawlear via guess URLs)
- **streaming SSE**: `POST :4100/crawl/stream` → ndjson eventos (offer/progress/done) · backend reenvía `SearchProgress.results` (parciales) por SSE · frontend renderiza cards a medida llegan (skeleton real) · top-N cap 20 · ML share ≤50% on balance con resto
- ranking: reputación tienda (curated) + precio + bonus financiación cuotas sin interés `installments` · VTEX `Installments` parse
- crawl SECONDARY: Node BFS legacy (HTTP-fast + Playwright) si `CRAWLER=legacy` o auto-fallback
- **ML PRIMARY (implementado):** API oficial catálogo OAuth: `products/search` → `products/{id}` → `products/{id}/items` (precio del item competidor más barato por producto, ARS + §V1) con permiso funcional app "Publicación y sincronización" r/w + re-consent OK (2026-09-23) · buy box NOT GATE: precios vía `/items` aunque `buy_box_winner` `null` · **cuenta token YUCA no vendedora** (`billing.allow=false address_pending`, list=false, kyc imposible — error ML) → `sale_price`/`/items/{id}`/`/sites/MLA/search` 403 por mejoramiento + items sin competencia ⊥ (404 "No winners found" por diseño, no compensable) · `sites/{site}/search` ⊥ (muerto 403 desde 2025) · ⊥ HTML listado · ⊥ Octoparse/GitHub scrapers · fallback solo StealthyFetcher+proxy residencial AR · ML ON en prod (`INCLUDE_ML=1` + secrets Fly; local default OFF `.env.example`) · auto-refresh OAuth on 401 → persist `/data/meli_tokens.json` (Fly volume) · docs/ML.md
- KISS/DRY: normalize/shipping/scoring en Node; Scrapling entrega offers crudas → finalize §V1
- reputación AR (.ar + bootstrap .com) · ML solo con `MELI_ACCESS_TOKEN`
- búsqueda SOLO AR · ∀ result → shipping.confirmed
- live-only · tests herméticos Node con fixtures · caché TTL 15min SWR (Fase 1, `CACHE_*` env) · jobs persistidos SQLite `node:sqlite` (Fase 3, `JOBS_DB` env) · robots.txt: legacy respeta vía helper compartido `robots.ts`, primario Scrapling NO consulta por política documentada (VTEX API pública + índice curado) · parser schema: `shared/ar-shops.json` único ya; contrato entre motores por fixtures de ambos lados
- speed scraper (Firecrawl-inspired): caché ofertas por host `offer_cache.py` (TTL 10min, query-agnostic, filtro relevancia al reutilizar, skip fetch si ≥3 ofertas frescas) · sitemap discovery no-VTEX curado (5 hosts/categoría, 8 URLs, caché 24h, worker background) · pipeline 2 etapas (fetch batch N+1 mientras probe N) · warm cache populares `WARM_CACHE=1` (5 queries, 300s, presupuesto bajo) · ML cap adaptativo ⊥ (preserva §V17)
- env: PORT, CRAWLER, SCRAPLING_URL, INCLUDE_ML, MELI_*, STEALTH, STEALTH_FETCH, STEALTH_PROXY, MAX_*
- UI: país fijo AR · **prerender home SSG post-build** (`scripts/prerender-home.mjs`: Vite `createServer`+`ssrLoadModule`+`renderToStaticMarkup` inyecta home en `dist/index.html`) → crawlers sin JS (Claude.ai/Google) ven contenido real · ⊥ SSR completo/hidratación (cliente re-renderiza con createRoot)
- UI polish: header tagline sutil + footer disclaimer no-afiliados · chips búsquedas populares (idle) · banner eventos LIVE pulse + countdown real (`useCountdown` tick 1s alineado, dep string YYYY-MM-DD) · filtros estado activo filled · card #1 destacada "Mejor precio" + `displayName` (normaliza ALL CAPS preservando marcas) · stagger 35ms · íconos Lucide consistentes (⊥ emojis bandera/🗓️)

§I
api: POST /api/search {product} → 202 (country AR)
api: GET /api/search/:id → job (V10)
api: GET /api/search/:id/events → SSE
api: GET /api/calendar/AR → eventos
api: GET /api/health → ok + crawler + scraplingUrl
scraper: GET :4100/health · POST :4100/crawl {product,maxResults,maxNodes,maxDepth,includeMl}
cmd: `npm run dev` (scraper+backend+frontend) · `cd scraper && uv sync && uv run ahorrar-scraper`
cmd: `npm --prefix frontend run build` → tsc --noEmit && vite build && node scripts/prerender-home.mjs (prerender+check)
env: PORT · HOST · CORS_ORIGINS · CRAWLER · SCRAPLING_URL · INCLUDE_ML · MELI_* · STEALTH_FETCH · STEALTH_PROXY
deploy: Vercel (frontend https://ahorrarg.vercel.app) + Fly.io Docker API/Scrapling (https://ahorrar-api.fly.dev) · GitHub main → auto-deploy · docs/DEPLOY.md
docs: `docs/ARCHITECTURE.md` (vista ampliada) · `docs/progress.md` (estado narrativo) · `docs/testing-strategy.md` (mapa test→§V) · `docs/decisions/*.md` (ADRs) · `AGENTS.md` (instrucciones de sesión) · `ROADMAP.md` · `CHANGELOG.md` · `DONT_DO.md` (decisiones no-repetición)

§V
V1: ∀ result publicado → shipping.confirmed=true ∧ country=Query.country
V2: price > 0 ∧ currency = moneda país destino (normalizada)
V3: visited set ⇒ URL procesada ≤ 1 vez por búsqueda
V4: mismo score → local (ccTLD país) antes que internacional
V5: ∀ request → max_depth ∧ max_nodes aplicados (⊥ explosión)
V6: modo educado default; stealth legacy solo STEALTH=1; Scrapling impersonate + STEALTH_FETCH=1 gated (⊥ default prod / imagen HTTP-only)
V7: evento/hoy + próximo derivados de calendario estático país; ⊥ inventar fechas
V8: respuesta JSON válida contra contract (SearchResponse shape)
V9: ∀ payload job API → runtime guard frontend lo acepta (error nullable; fixture payload real en test)
V10: ∀ GET job → keys opcionales result/error presentes solo si existen; ⊥ null en wire en estado no terminal
V11: ∀ resultado live publicado → image extraída (og:image | primera <img> válida); ⊥ hardcodear null en parsers
V12: ∀ filtro/orden estándar de UI → aplicado ∧ testeado sobre results (precio min/max, envío gratis, orden)
V13: ∀ host crawlable → reputación AR (ccTLD .ar ∨ bootstrap .com AR ∨ hub discovery); ∀ result publicado → isPublishableResult (⊥ SERP hubs)
V14: CRAWLER=auto|scrapling → intentar Scrapling primero; legacy solo fallback o CRAWLER=legacy
V15: ML PRIMARY → só catálogo: `/products/search` + `/products/{id}/items` (precio del competidor más barato por PDP, ARS ∧ shipping §V1), gate MELI_ACCESS_TOKEN ∧ permiso funcional "Publicación y sincronización" r/w activo en app DevCenter (verificado `GET /applications/{id}` + re-consent) → precios ⊆ app r/w (⊥ `not_certified`/grant vencido); `/sites/{site}/search` ⊥; buy box/sale_price/items ⊥ cuenta vendedora validada (no gate del camino precio)
V16: ∀ streaming SSE → `SearchProgress.results` = ProductResult[] parciales (guard frontend acepta optional results) · job terminal sigue siendo V10 (result solo en done)
V17: ∀ comprobación con ML on → ML share ≤ 50% de top-N (N≤20 max) · el resto lo llena discovery (⊥ que ML ocupe todo el grid)
V18: ranking = reputación tienda (índice curado/auto-discovered tier) + precio (menor mejor) + bonus cuotas sin interés (`installments` sin tasa) · cap top-N con N=MAX_RESULTS≤20
V19: ∀ tienda curada/discovered → reputación tier + `platform`/`alive`/`entry` coherentes Node↔Python (mismo `shared/ar-shops.json` v3 + tier por hotness de discovery) · `alive:false` ⊥ seedea · seeds platform-aware paridad ambos motores · ⊥ skip index sin crawlear
V20: ∀ GET job → id overvive restart backend si `JOBS_DB` set (SQLite persistencia) → job créer en start restore
V21: ∀ caché hit (TTL vivo) → respuesta de vuelta sin crawlear; hit vencido → respuesta stale + refresh background (SWR); miss → crawlea + pobla
V22: ∀ offer Frávega (host fravega.com) → url = `/p/{slug}-{itemId}/` con itemId = VTEX `items[0].itemId` (GraphQL `sku(code:)` resuelve); ⊥ `link`/`linkText` con productId ni `/{linkText}/p` (shell vacío)
V23: ∀ build frontend → `dist/index.html` contiene home prerenderizado (root no vacío + marcador idle "¿Qué querés ahorrar hoy?") · `scripts/prerender-home.mjs` falla el build si falta
V24: ∀ result publicado → title matchea query (filtro relevancia pipeline Node+Python) · tests integración usan fixtures que pasan el pipeline completo (⊥ nombres que no matchean la query)

§T
id|status|task|cites
T1|x|scaffold repo: SPEC/README/LICENSE/.gitignore/contract/scripts|§G
T2|x|backend core puro: normalize/shipping/scoring/calendar + vitest|V1,V2,V7
T3|x|BFS crawler Crawlee + parsers (ML/AMZ/generic) + mock engine|V3,V4,V5,V6
T4|x|API Express: POST/GET search + SSE events + calendar|V8
T5|x|frontend: search/cards/banner/loading + sort + solo-local + states|V1,V8
T6|x|e2e verify mock search + contract check + lint/typecheck/build|V8
T7|x|README run docs + browsers playwright note|V6
T8|x|imágenes reales en parsers (og:image + primer <img>) + tests fixture|V11,§C
T9|x|filtros+orden estándar en UI (precio min/max, envío gratis, orden) + tests frontend|V12
T10|x|live-only: eliminar mock, fetch inyectable en runLiveSearch, tests fixture api|§C,V8,V9,V10
T11|x|solo AR + índice seeds reputados por categoría + allowlist recursión BFS|V13,§G
T12|x|discovery procedural: hubs SERP/ML + expand hosts AR + guessSearchUrls (⊥ seed shops fijos)|V13,§C
T13|x|HTTP-fast path + BFS paralelo + VTEX catalog API + ML blacklist sesión|V5,V6,V13
T14|x|Scrapling primary sidecar + Node secondary|V14,§C
T15|x|ML catálogo client: search_mla via products/search → products/{id}/items (precio competidor más barato por PDP) · get 200 + integración crawl() verificado 2026-09-23 · app pdp r/w + tópicos/callback + re-consent done (grant r/w reflejado) · cuenta YUCA no vendedora (`address_pending`, kyc imposible) → buy box/sale_price/search ⊥, camino precio OK|V1,V14,V15
T16|x|ML OAuth refresh (`ml_login.py refresh`) + INCLUDE_ML end-to-end en prod (Fly secrets MELI_* + INCLUDE_ML=1, 2026-09-25)|V1,V14,V15
T17|.|ML fallback StealthyFetcher+proxy residencial (solo si API falla gate)|V14
T18|x|Deploy: Vercel frontend + Fly Docker API/Scrapling + DEPLOY.md|§I
T19|x|streaming scrapers: crawl() on_offer/on_progress callbacks + POST /crawl/stream ndjson (offer/progress/done/error) · /crawl intacto digo|V16,§I
T20|x|backend stream: SearchProgress.results opcional (contract+guard) + scrapling stream client (ndjson→SSE) + jobStore push parciales por SSE|V16,V10,§I
T21|x|frontend streaming: LoadingState→cards a medida llegan (skeleton real) + maxResults 20|V16,V17
T22|x|índice curado discovery: shared/ar-shops.json categorías + guessSearchUrls ampliado + auto-expansión tiendea nueva|V19,V13
T23|x|ranking balance: reputación+precio+bonus cuotas sin interés + ML share≤50% + VTEX installments parse|V18,V17,V2
T24|x|Fase 0 speed: ML N+1 paralelo (ThreadPool+client por thread+auth por arg) + BFS batches (url,depth) + timeouts por tipo + ML concurrente (worker) — s24: done 24.1s→1.6s, primer offer 2-3s→0.5s|V1,V17,V16
T25|x|Fase 1 caché: normalizeQueryKey (lower+sin tildes+orderless) + TTL Map + SWR (stale+bg refresh) + integración runLiveJob — E2E: 2da búsqueda s24 16-20ms vs 2.3s primera|V21
T26|x|Fase 2 robots: helper compartido robots.ts (extraído de Fetcher, cache por host + fail-open) + decisión política primario sin robots en SPEC|V6
T27|x|Fase 3 jobs SQLite: node:sqlite persist + restore start (attachDb) + SSE reconnect frontend (localStorage lastSearchId + resume job done) — E2E: restart backend, job viejo responde|V20,V16
T28|x|Fase 4 parsers: test contrato VTEX ambos motores (fixture shared/fixtures/vtex-contract-fixture.json, Node in-process + Python vía uv) + name/price/url equivalentes; installments solo Python (gap §V18 documentado)|V18,V19
T29|x|Índice expandido 14→88 tiendas: scrapeo comparaya.net (API pública /api/stores) + precialo.com.ar (facetas webDomains) + probe VTEX con fetcher real (Scrapling) → +32 entries VTEX +42 entry-null; paridad categoryFor+build_seed_urls ambos motores (entries-first por categoría, cap 20)|V19,V13
T30|x|Scrapling latencia: FetcherSession per worker + fetch kinds hub\|api\|html (FETCH_LIMITS) + early-stop (≥8 offers ≥4 hosts → drenar api batch y salir)|V5,V6,§C
T31|x|Índice v3 platform/alive: ar-shops.json schema + probe offline scripts/probe_ar_shops.py (fingerprint+entry candidates) → 81 alive / 7 dead (vtex 52, woo 9, unknown 26)|V19,§C
T32|x|Cobertura Woo/Shopify: parsers parse_woo_store_api + parse_shopify_suggest_or_products + fixtures + seeds platform-aware Node↔Python (skip !alive; guesses por platform)|V19,V1,§C
T33|x|Stealth gated: STEALTH_FETCH=0 default · challenge/403 → StealthyFetcher 1-shot cap 3/crawl · DEPLOY.md nota HTTP-only Fly · ⊥ capture_xhr este plan|V6,§C
T34|x|Frávega PDP: `fravega_pdp_url`/`fravegaPdpUrl` arma `/p/{slug}-{itemId}/` (swap productId→itemId, keep --) · probe GraphQL sku(code) · contrato fixture+tests · HTML Frávega skip sin itemId · audit 52 VTEX: solo Frávega tiene patrón (resto CLASSIC /slug/p OK)|V22
T35|x|prerender home SSG: scripts/prerender-home.mjs (createServer+ssrLoadModule+renderToStaticMarkup) inyecta home en dist/index.html + check marcador idle · build = tsc && vite build && node scripts/prerender-home.mjs|V23,§C,§I
T36|x|UI polish (feedback capturas): header tagline/footer + chips populares + banner LIVE/countdown + filtros filled + card #1 destacada + displayName + stagger 35ms + íconos Lucide|§C,V23
T37|.|Filtro Envío gratis: señal real shipping.free (HTML/VTEX logistics/ML) + re-show pill SortBar · Solo local ⊥ (AR-only)|V12,§C
T38|x|ML auto-refresh on 401 (`meli_auth.py`) + persist MELI_TOKEN_FILE (/data volume Fly) · retry search_mla · tests unittest|V15,§C
T39|x|caché ofertas por host: offer_cache.py (TTL 10min, dedupe URL, cap 30/host, 64 hosts) + absorb_cached en seeds/expand_origin + save post-probe — E2E: 2da búsqueda misma query 0 fetches (1008ms vs 2447ms)|V24,§C
T40|x|sitemap discovery: sitemap_candidate_hosts (no-VTEX curado misma categoría) + sitemap_product_urls (caché 24h, regex <loc>, 8 URLs) + worker background en crawl()|V19,§C
T41|x|probes en paralelo: pipeline 2 etapas (launch_batch N+1 antes de process_batch N) + fix while (batch or crawl_queue)|V5,§C
T42|x|warm cache populares: server.py _warm_loop gated WARM_CACHE=1 (5 queries, 300s, max_results 8/max_nodes 30) + start_warm_cache en main()|V21,§C

§B
id|date|cause|fix
B1|2026-09-20|guard isSearchResultJob rechazaba error:null (typeof null ≠ 'string') → toda búsqueda fallaba en cliente con 502 V8|V9: guard acepta null; cliente.test.ts fixture payload real (22 tests frontend verdes)
B2|2026-09-20|server serializaba result:null (job.result ?? null) en jobs no terminales vs contrato result?: → guard V8 rechazaba el primer poll en vuelo (502 "perfume AR")|V10: server omite result/error inexistentes; guard rechaza null en wire; tests regresión api.test.ts + client.test.ts (backend 58/58, frontend 26/26)
B3|2026-09-20|ML shippingHintOf exigía `>` tras match → fallaba en body `<p>Envío gratis…</p>` → listing sin hint → §V1 descartaba (1 result vs ≥2 en live fixture)|regex body-safe + mercadolibre.test.ts; live 4/4 + backend 70/70
B4|2026-09-23|ML descontinuó `/sites/{site}/search?q=` (403 anónimo y OAuth, abr-2025); docs/ML.md diseñado sobre ese endpoint|V15 · meli_api.py → catálogo products/search + products/{id} buy box · docs/ML.md actualizado; buy box `null` aun con publish-sync r/w + re-consent → ±hipótesis corregida: NO es permiso funcional incompleto (ya r/w + grant OK), es **cuenta token no vendedora** (YUCA `billing.allow=false address_pending`, list=false, kyc error ML) → buy box/`/items`/`sale_price`/`/sites/MLA/search` ⊥; camino precio via `products/{id}/items` (competidores) implementado y verificado · `ml_login.py` PKCE added
B5|2026-09-24|doble bug preexistente en seeds Node enmascarado por la suite: (1) `ALLOWED_DOMAINS` (export muerto) llamaba `arShopTrustedHosts()` a nivel de módulo → `_arShopsCache` se poblaba con el índice REAL al importar, antes de que los tests seteen `AR_SHOPS_JSON` (el fixture nunca aplicó; seeds.test.ts pasaba de casualidad con 14 tiendas); (2) `categoryFor` devolvía `'perfume'` pero el índice usa `'perfumeria'` → prioridad por categoría silenciosamente rota en Node desde T22|ALLOWED_DOMAINS eliminado; CategoryId→`'perfumeria'` alineado al índice (fuente de verdad §V19); test de contrato seeds Node↔Python compara los 24 seeds exactos (gaming + perfumería) → paridad de orden/cap en ambos motores
B6|2026-09-24|Frávega Next resuelve SKU por trailing digits de `/p/{slug}-{id}/` vía GraphQL `sku(code:)`; el catalog VTEX emite `link`/`linkText` con **productId** y `/{linkText}/p` → redirect a shell vacío (og genérico, sku productId → Failed to fetch). Web search usa itemId → links vivos. Audit `scripts/audit_pdp_links.py` sobre 52 VTEX vivos: **solo Frávega** muestra FRAVEGA_PATTERN; resto CLASSIC_VTEX (`/slug/p` OK, `/p/…-itemId` 404)|V22: parsers Node+Python `fravegaPdpUrl`/`fravega_pdp_url` swap productId→itemId; HTML Frávega skip sin itemId; probe `_fravega_sku_alive`; tests http-fetch+parsers-contract+live GraphQL 6/6 OK
B7|2026-09-24|`platformForHost` (nuevo, WIP seeds) comparaba `s.platform !== ''` contra tipo `ShopPlatform` sin `''` → `tsc --noEmit` fallaba (guard `typeof` muerto)|fix `if (s.platform)` (semántica idéntica: índice sin `""`, verificado 0 ocurrencias) · typecheck repo verde
B8|2026-09-25|bfs.test.ts (agregado 5a97e0b) usaba nombres "Producto X" que no matchean `product:'test'`; c2014fb agregó titleMatchesQuery al pipeline sin actualizar el test → 3 tests integración devolvían results vacío (filtro relevancia correcto en prod)|V24: makeGraph genera "Test {name}" (matchea query) · bfs.test.ts 7/7 · backend 131/131
