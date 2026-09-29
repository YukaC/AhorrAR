# Progreso — AhorrAR

> Estado **actual** del proyecto: qué está hecho, en curso y falta. Fuente canónica y
> operativa: `SPEC.md` §T (plan, estados `.`/`~`/`x`) y §B (bugs). Este doc es la vista
> narrativa/temporal para arrancar cada sesión sabiendo dónde está uno; **no** duplica
> el SPEC, lo referencia. Actualizar al cerrar cada sesión (junto con §T).

## En una línea

v0.2 · Fase 0 cerrada (`#36` @ `4854ab9`) · stashes en ramas `backup/*` · Fase 2: #30 SSRF merged · siguiente #32 golden · T61 bench paralelo · ML ON · 0 bugs §B abiertos.

## §F — protocolo agente (fin de fase)

1. **Auto-avanza entre fases** (F0→F1→F2…) sin pedir OK, salvo que falle un criterio de esta §F.
2. **Para solo ante merge a `main`** (incl. squash): reportar floors + URL del PR, esperar OK explícito del user, recién ahí `gh pr merge`.
3. **Criterios que frenan** (no seguir a la fase siguiente):
   - Evidencia contradictoria / claim sin comando en ledger
   - Suite por debajo del piso actual (pisos **solo suben** en cada merge a main)
   - Gate de seguridad incompleto en PRs de riesgo (SSRF = checklist abajo)
   - Conflicto de rebase no resuelto / CI rojo en el PR a mergear
4. **Stash:** ⊥ `stash pop` / `stash drop` hasta cerrar el plan. Referir por **hash**, no `stash@{N}`.
5. **Pisos tests (ratchet):** anotar en ledger tras cada merge; e2e pasa a ≥1 cuando entre #29.

### Gate SSRF (#30) antes de merge

| Requisito | Estado en rama |
|---|---|
| Rangos privados IPv4/IPv6 + mapped `::ffff:` + `169.254/16` | ✅ tests Node↔Python |
| Literales decimal/octal/hex | ✅ |
| URL tricks (userinfo, non-http) | ✅ |
| Revalidar redirects | ✅ Node `httpGetText` manual; Python post-fetch `final` |
| DNS pin + cache TTL 30s | ✅ Node `pinnedLookup`; Python cache (Scrapling no pinneá TCP) |
| Gate en **fetch** (no solo discovery) | ✅ `fetcher` + `_FetchPool` |
| Filtro shape sobre índice | ✅ 94 hosts shape OK; 6 ENOTFOUND al DNS (muertos) |
| Paridad Node↔Python mismos casos | ✅ |
| Bench DNS-cache effect | ⏳ medir en Micro / local ×3 post-merge |

## Ledger (evidencia — no afirmar de memoria)

### Post-merge #30 SSRF (2026-09-29)

| Check | Salida |
|---|---|
| Merge | squash → `e5a42f4` |
| Floors | backend **156** · frontend **63** · Python **68** · e2e **0** (↑ 148/63/60/0) |
| Gate | private ranges + URL tricks + redirects + DNS pin/cache + fetch-time · shape 94/94 |



### Post-Fase 0 (2026-09-29) — backups + #36

| Check | Comando | Salida |
|---|---|---|
| `#36` merged | `gh pr view 36` | **MERGED** @ `4854ab9` |
| Backup WIP | `origin/backup/wip-stash` | `ea670cd…` |
| Backup aside-golden | `origin/backup/stash-aside-golden-t56-measure` | `d031129…` |
| Backup P0 | `origin/backup/stash-p0-wip-20260928` | `6ce0eeb…` |
| Stash list (intactos) | `git stash list` | 3 entradas; ⊥ drop |
| PRs #29–#35 base | `gh pr list` | todos `base=main`, merge-base=`1ecd88e` → **no apilados** |
| Floors main post-#36 | docs-only | backend **148** · frontend **63** · Python **60** · e2e **0** |
| Floors rama SSRF (pre-merge) | vitest/unittest | backend **156** · frontend **63** · Python **68** · e2e **0** |

### Fase 0 re-audit (2026-09-29) — gate antes de Fase 1

| Check | Comando | Salida |
|---|---|---|
| Backup remoto | `git ls-remote origin refs/heads/backup/wip-stash` | `ea670cd3e09ce0b9f2ed783ad3e228eac84d29d6` |
| Match | `git rev-parse origin/backup/wip-stash` | mismo `ea670cd…` |
| Stash (no borrar) | `git stash list` | `@{0}` aside-golden-t56 · `@{1}` wip non-T55 · `@{2}` P0-wip-backup |
| T61 HEAD | `git rev-parse origin/perf/t61-ml-degraded` | `815d4eb` (≠ claimed `82218a7`; ese es ancestro) |
| e2e T61 | `git ls-tree -r origin/perf/t61-ml-degraded \| rg e2e\|playwright` | `frontend/e2e/search-sse.spec.ts` + `playwright.config.ts` |
| e2e main | idem `origin/main` | vacío |
| Clean dry-run | `git clean -nd` | vacío (nada a borrar) |
| `git clean` real previo | `rg git clean` en transcript | **no hubo** — claim previo sin evidencia |
| Floors main `@1ecd88e` | worktree + vitest/unittest | backend **148** · frontend **63** · Python **60** · e2e **0** |

### Inventario (4 cats) — snapshot re-audit

| Ítem | Categoría | Evidencia |
|---|---|---|
| T55 / V30 keep / V34 yield / V33 bytes | **en main** | `1ecd88e` + tests |
| T61 + e2e T53 | **en rama T61** PR #29 | HEAD `815d4eb` |
| SSRF V32 / stock T60 / golden T58 / T56 / T52 / CRAWL / ML-COVERAGE | **PRs #30–#35** + backups `backup/*` | stashes intactos; ver hashes arriba |
| SSRF código en main | **no existe aún** | entra con merge #30 |

**SPEC honesty:** merged via `#36` @ `4854ab9`.

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
  - `STEALTH_FETCH` gated (off default prod; nota en `docs/DEPLOY.md`); `capture_xhr` diferido (ROADMAP) — §T33
- [x] Frávega PDP itemId + prerender home SSG + UI polish — §T34–T36
- [x] **Prod**: https://ahorrarg.vercel.app + OCI Micro `147.15.72.239.sslip.io` · Render backup · Fly retirado · relevance filter · header GitHub repo link
- [x] **ML ON en prod**: secrets `MELI_*` + `INCLUDE_ML=1` (Micro compose); refresh vía `ml_login.py refresh` — §T16
- [x] **ML auto-refresh on 401** + persist `/data/meli_tokens.json` — §T38
- [x] **Speed Firecrawl-inspired** (scraper Python): caché ofertas por host (TTL 10min, dedupe, cap 30/host) + sitemap discovery (hosts no-VTEX curados, caché 24h) + probes en paralelo (pipeline 2 etapas) + warm cache populares (`WARM_CACHE=1`) — §T39–T42 · E2E: 2da búsqueda misma query 0 fetches (1008ms vs 2447ms) · **conceptos reimplementados desde cero, sin código de Firecrawl (AGPL-3.0)** — `docs/ATTRIBUTIONS.md` + `NOTICE`
- [x] **Filtro Envío gratis con señal real**: `shipping.free` desde VTEX `ShippingSLA[].Price==0` y ML `free_shipping` (gana sobre regex del hint) + pill SortBar re-activado + paridad Node↔Python (fixture contrato con ShippingSLA) — §T37 / §V25
- [x] **ML circuit breaker**: `_CircuitBreaker` en `search_mla` (threshold 3, cooldown 300s, half-open) — 401/403/429/≥400/network/shape cuentan; éxito resetea; skip rápido mientras abierto — §T43 / §V26 · tests unittest 7
- [x] **Warm cache** (perfil A1 / opt-in): `WARM_CACHE=1` — §T42 · Micro prod suele `WARM_CACHE=0`
- [x] **Relevance anti-accesorio / class evidence** (Node+Python): categoría sola exige sinónimo; reject funda/RAM/crema/para X; relevance tier en ranking — §T44–T45 / §V27/§V28
- [x] **UI result caps 25→50→100** + SearchBar sync chips/query + early-stop scraper al cap + caché por cap — §T46 / §V17/§V18
- [x] **Design system Tailwind v4** (tokens semánticos + Geist + theme View Transition) — polish UI
- [x] **Render Free 512MB** (backup): `render.yaml` (FETCH_WORKERS=2, MAX_NODES techo) + api-wake/focus + caps 25→50 — §T48
- [x] **OCI Micro primario** + corte yield/host (T55) — ver `docs/audit-iphone-latency.md`

## En curso

- Nada en esta rama. Post-merge: T61 degraded + residual wall · holdout · T54 A1 runbook.

## Falta

- [x] Deploy prod Vercel + API (hoy Micro; históricamente Fly luego Render)
- [x] ML ON en prod (`MELI_*` secrets + `INCLUDE_ML=1`; re-consent OK) — §T16 / `docs/ML.md`
- [x] Dominio canónico UI `ahorrarg.vercel.app` (+ redirects 308)
- [ ] Bench en Micro real post-merge T55
- [ ] Holdout relevancia / frase núcleo
- [x] Live bench local (histórico 2026-09-24):

  | query | elapsedMs | pagesFetched | #results | min price |
  |---|---:|---:|---:|---:|
  | `ryzen 5 5600` | 2001 | 11 | 20 | 226990 |
  | `perfume bensimon` | 1126 | 6 | 20 | 31843.5 |
  | `smart tv 55` | 3747 | 8 | 20 | 282999 |

## Bugs conocidos

- Ninguno abierto en `SPEC.md` §B. El error preexistente de typecheck `CrawlStats` en `backend/src/search/bfs.ts:18` (noUnusedLocals) está aceptado sin fix.

## Bloqueantes

- Ninguno. Access token ML ~6h: auto-refresh on 401 (+ persist volume). Solo re-consent manual si refresh revoke.
