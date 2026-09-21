# SPEC — AhorrAR / price scraper recursivo geolocalizado full-stack

§G
Comparador de precios AR: [PRODUCTO] → crawler LIVE rankea ofertas REALES (precio, link, imagen) sitios AR + filtros/orden + banner evento. ⊥ mock/demo.

§C
- stack: Node 26 TS API/UI + **Scrapling Python PRIMARY** (`scraper/`) · Express 5 · React 19 · Vite 7 · Tailwind 4
- monorepo: backend/ + frontend/ + scraper/ + shared/contract.ts
- crawl PRIMARY: Scrapling `Fetcher` (TLS impersonate chrome) · SERP + VTEX catalog API · discovery AR
- crawl SECONDARY: Node BFS legacy (HTTP-fast + Playwright) si `CRAWLER=legacy` o auto-fallback
- **ML PRIMARY:** API oficial OAuth (`/sites/MLA/search` + Bearer) · ⊥ HTML listado · ⊥ Octoparse/GitHub scrapers · fallback solo StealthyFetcher+proxy residencial AR (docs/ML.md)
- KISS/DRY: normalize/shipping/scoring en Node; Scrapling entrega offers crudas → finalize §V1
- reputación AR (.ar + bootstrap .com) · ML solo con `MELI_ACCESS_TOKEN`
- búsqueda SOLO AR · ∀ result → shipping.confirmed
- live-only · tests herméticos Node con fixtures
- env: PORT, CRAWLER, SCRAPLING_URL, INCLUDE_ML, MELI_*, STEALTH, MAX_*
- UI: país fijo AR

§I
api: POST /api/search {product} → 202 (country AR)
api: GET /api/search/:id → job (V10)
api: GET /api/search/:id/events → SSE
api: GET /api/calendar/AR → eventos
api: GET /api/health → ok + crawler + scraplingUrl
scraper: GET :4100/health · POST :4100/crawl {product,maxResults,maxNodes,maxDepth,includeMl}
cmd: `npm run dev` (scraper+backend+frontend) · `cd scraper && uv sync && uv run ahorrar-scraper`
env: PORT(4000) · CRAWLER(auto) · SCRAPLING_URL(http://127.0.0.1:4100) · INCLUDE_ML(0) · MAX_DEPTH(2) · MAX_NODES(60)

§V
V1: ∀ result publicado → shipping.confirmed=true ∧ country=Query.country
V2: price > 0 ∧ currency = moneda país destino (normalizada)
V3: visited set ⇒ URL procesada ≤ 1 vez por búsqueda
V4: mismo score → local (ccTLD país) antes que internacional
V5: ∀ request → max_depth ∧ max_nodes aplicados (⊥ explosión)
V6: modo educado default; stealth legacy solo STEALTH=1; Scrapling usa impersonate
V7: evento/hoy + próximo derivados de calendario estático país; ⊥ inventar fechas
V8: respuesta JSON válida contra contract (SearchResponse shape)
V9: ∀ payload job API → runtime guard frontend lo acepta (error nullable; fixture payload real en test)
V10: ∀ GET job → keys opcionales result/error presentes solo si existen; ⊥ null en wire en estado no terminal
V11: ∀ resultado live publicado → image extraída (og:image | primera <img> válida); ⊥ hardcodear null en parsers
V12: ∀ filtro/orden estándar de UI → aplicado ∧ testeado sobre results (precio min/max, envío gratis, orden)
V13: ∀ host crawlable → reputación AR (ccTLD .ar ∨ bootstrap .com AR ∨ hub discovery); ∀ result publicado → isPublishableResult (⊥ SERP hubs)
V14: CRAWLER=auto|scrapling → intentar Scrapling primero; legacy solo fallback o CRAWLER=legacy

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
T15|~|ML API OAuth client (gated MELI_ACCESS_TOKEN) + docs/ML.md · falta app+token live|V1,V14
T16|.|ML OAuth refresh flow + wire INCLUDE_ML end-to-end tras gate 200|V1,V14
T17|.|ML fallback StealthyFetcher+proxy residencial (solo si API falla gate)|V14

§B
id|date|cause|fix
B1|2026-09-20|guard isSearchResultJob rechazaba error:null (typeof null ≠ 'string') → toda búsqueda fallaba en cliente con 502 V8|V9: guard acepta null; cliente.test.ts fixture payload real (22 tests frontend verdes)
B2|2026-09-20|server serializaba result:null (job.result ?? null) en jobs no terminales vs contrato result?: → guard V8 rechazaba el primer poll en vuelo (502 "perfume AR")|V10: server omite result/error inexistentes; guard rechaza null en wire; tests regresión api.test.ts + client.test.ts (backend 58/58, frontend 26/26)
B3|2026-09-20|ML shippingHintOf exigía `>` tras match → fallaba en body `<p>Envío gratis…</p>` → listing sin hint → §V1 descartaba (1 result vs ≥2 en live fixture)|regex body-safe + mercadolibre.test.ts; live 4/4 + backend 70/70
