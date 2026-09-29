# Progreso — AhorrAR

> Estado **actual** del proyecto: qué está hecho, en curso y falta. Fuente canónica y
> operativa: `SPEC.md` §T (plan, estados `.`/`~`/`x`) y §B (bugs). Este doc es la vista
> narrativa/temporal para arrancar cada sesión sabiendo dónde está uno; **no** duplica
> el SPEC, lo referencia. Actualizar al cerrar cada sesión (junto con §T).

## En una línea

v0.2 · **ROLLBACK** prod → `e1db4fb`/`e9504ec0` tras cold 8q en `cab0797` (zapatillas hosts 3→1; iphone wall↑) · #29 sigue en main · floors 175/63/95/1.

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

### Swap log producción (regla: hora · digest antes · digest después · motivo)

| # | Hora UTC | Antes | Después | Motivo |
|---|---|---|---|---|
| 1 | 16:20:40Z | `e9504ec0…` / `e1db4fb` | local-retag `sha-9f9bee6` → `:micro` | bench frío pre-merge #29 (GHCR `:micro` no retagueado) |
| 2 | 16:40:24Z | `sha-9f9bee6` | `e9504ec0…` / `e1db4fb` | restore post-bench pre-merge |
| 3 | ~16:46Z | `e9504ec0…` | **`8a90de96…` / `cab0797`** | auto `deploy-micro` post-merge #29 (run 36599659920) |
| 4 | 17:44–18:00Z | (sigue `cab0797`) | — | cold 8q HTTP ×3 restart-each sobre imagen viva |
| 5 | 18:01:19Z | `8a90de96…` / `cab0797` | **`e9504ec0…` / `e1db4fb`** | **ROLLBACK** tras cold 8q (ver causa abajo) |
| 6 | 18:03Z | pin `.env` | sigue `e9504ec0…` | deploy-micro del fix pull-script **honró pin** (no re-subió T61) |

**Identidad digest `e9504ec0`:** `docker image inspect` → `Id=sha256:e9504ec0086e1e67a23a56c30e796e7ebed684d302a2605d2ab74d5f4a68888d` = `RepoDigests=[ghcr.io/yukac/ahorrar-api@sha256:e9504ec0…]` · rev `e1db4fb0…`. En imágenes single-manifest el content digest **es** el Id. Sirve para `docker pull …@sha256:e9504ec0…`.

**Identidad `cab0797`:** Id/`8a90de96…` · rev `cab07972…` · RepoDigests vacío en VM (solo quedó por Id post-retag); pull registry fue vía tag `:micro` en deploy #3.

**Causa rollback (no precaución vaga):**
1. **hosts zapatillas 3→1** vs cold Micro previo `sha-9f9bee6` (criterio “hosts≪previo”).
2. **iphone p50 22.6s > prod 16.1s** (wall peor).
3. Script también marcó cable 9.1>8.5 — **ruido**; no alcanza solo.
4. **No** fue OOM · **no** RestartCount>0 · swap pico 372 y bajó (no runaway).

**Métricas HTTP cold que SÍ hay:** wall · hosts · n · stop_reason (logs) · rss · swap.  
**Que NO midió este bench HTTP:** P@10 · recall · ml_arrived rate (API Node no expone `stopReason`/`mlArrived` en `stats` aún).

**Auto-deploy hoy:** frenado de facto — `AHORRAR_IMAGE=@sha256:e9504ec0…` en `deploy/oci/.env` + `oci-micro-pull.sh` sourcea `.env`. Un merge a main **no** sube T61 mientras el pin viva. ⊥ Fase 2 hasta decisión redeploy.



### Deploy T61 prod (2026-09-29) — preflight + mechanism

| Campo | Valor |
|---|---|
| Rollback pin (pre-T61) | rev `e1db4fb0…` · digest `sha256:e9504ec0086e1e67a23a56c30e796e7ebed684d302a2605d2ab74d5f4a68888d` |
| Mecanismo deploy | GitHub Actions `Docker GHCR` job **`deploy-micro`** (solo `refs/heads/main`) → SSH `appleboy/ssh-action` → `scripts/oci-micro-pull.sh` (pull `:micro` + compose recreate). **No** Watchtower / cron de pull. Anti-idle cron ≠ deploy. |
| Run #29 image | https://github.com/YukaC/AhorrAR/actions/runs/36599659920 · `deploy-micro` success 16:46Z |
| Live ahora | rev **`cab07972…`** · digest `sha256:8a90de96f55073ab77c1eddeda13e6c24d91b424a2f32ede97840c8a68b38e53` · RestartCount=0 · health ok |
| Criterio rollback | OOM/reinicio · swap creciendo · hosts≪previo · p50 peor que tabla prod en **>1** query → volver a `e9504ec0`/`e1db4fb` |

**Live post-deploy (antes del bench):** rev `cab07972…` · digest `sha256:8a90de96f55073ab77c1eddeda13e6c24d91b424a2f32ede97840c8a68b38e53` · RC=0 · health ok.

### Prod cold 8q en `cab0797` (2026-09-29 17:44–18:00Z) — restart-before-each · ML=1

| query | p50 | hosts | n | stop | rss | vs prod prev |
|---|---:|---:|---:|---|---:|---|
| iphone 15 | 22.6s | **2** | 2 | queue_empty | 266 | 16.1→22.6 **worse** · hosts=2 estable en frío (⊥ degraded cross-run) |
| smart tv 55 | 20.7s | 7 | 10 | queue_empty | 301 | 26.1→20.7 ok |
| ryzen 5 5600 | 12.9s | 6 | 14 | **satisfied** | 251 | 30.1→12.9 ok |
| perfume | 5.9s | 6 | 12 | satisfied | 266 | 9.1→5.9 ok · variedad OK |
| notebook | 15.5s | 6 | 12 | satisfied | 281 | 17.0→15.5 ok |
| heladera | 10.1s | 8 | 20 | satisfied | 260 | ok |
| zapatillas nike | 14.4s | **1** | 2 | queue_empty | 261 | wall↓ pero hosts **3→1** (sevensport) · criterio hosts≪previo |
| cable | 9.1s | 7 | 14 | satisfied | 262 | 8.5→9.1 ruido |

rssPeak **311 MiB** · swapPeak **372 MiB** (bajó a ~328 post-bench) · RestartCount=0 · sin OOM.

**Registro degraded:** cada búsqueda con `compose restart api` → registry in-mem limpio. Confirmado.

**stop_reason:** presente en logs scraper (`satisfied|deadline|max_nodes|queue_empty`); API Node aún no lo expone en `stats`.

### ROLLBACK ejecutado (criterio hosts + wall)

| Campo | Valor |
|---|---|
| Motivo | zapatillas hosts med 1≪3 previo · iphone p50 22.6>16.1 · (cable ±0.6s ruido, no cuenta solo) |
| Destino | rev `e1db4fb0…` · digest `sha256:e9504ec0086e1e67a23a56c30e796e7ebed684d302a2605d2ab74d5f4a68888d` |
| Ventana | rollback `2026-09-29T18:01:19Z` |
| Nota | `#29` sigue en main; GHCR `:micro` tip aún `cab0797`. VM pin digest `e9504ec0` vía `.env` + pull script sourcea `.env`. |
**Pin VM:** `deploy/oci/.env` → `AHORRAR_IMAGE=@sha256:e9504ec0…` · `oci-micro-pull.sh` ahora sourcea `.env` para que el próximo `deploy-micro` no pise el rollback.

| Artefacto | `/tmp/ahorrar-bench/t61-prod-cab0797-cold-8q.json` |

**Fase 2 SSRF (#30):** ya **MERGED** `2026-09-29T11:26:43Z` @ `e5a42f4` (antes de #29). e2e piso **1** en progress post-#29.




### Micro cold 8q T61 (2026-09-29) — `sha-9f9bee6` · restart-before-each

**Decisión explícita:** swap breve del contenedor prod (retag local `sha-9f9bee6` → `:micro` en VM; GHCR `:micro` intacto) para bench frío. **Ventana:** `2026-09-29T16:20:40Z` → `2026-09-29T16:40:24Z` (~20 min). **Restore verificado:** digest `sha256:e9504ec0086e1e67a23a56c30e796e7ebed684d302a2605d2ab74d5f4a68888d` · rev `e1db4fb…` · RestartCount=0. (Pin previo post-Fase2; `a35d6c…`/`1ecd88e` quedó atrás al rebuild `:micro` tras #30–#35.)

**Cold:** `clear_outcome_registry` (local) / `docker compose restart api` antes de cada búsqueda (Micro). top3_stable = mismo (price,host) entre reps — **no** “top3≈wall”.

| query | Micro p50 | hosts | n | rss | top3 | vs prod ML=1 |
|---|---:|---:|---:|---:|:---:|---|
| ryzen | 14.5s | 6 | 12 | 239 | ✓ | 30.1→14.5 |
| notebook | 16.5s | 6 | 12 | 240 | ✓ | 17.0→16.5 |
| perfume | 5.6s | 6 | 12 | 223 | ✓ | 9.1→5.6 |
| iphone | 19.7s | **2** | 2 | 269 | ✓ | 16.1→19.7 · hosts=2 **también en frío** (local frío hosts=3) → ⊥ regresión degraded |
| smart tv | 10.3s | 5 | 7 | 256 | ≠ | 26.1→10.3 · top3≠ informativo |
| zapatillas | 31.2s | 3 | 9 | 268 | ≠ | ~flat · residual → #22 / T52 / T56 · stop local=`queue_empty` |
| heladera | 8.1s | 8 | 20 | 242 | ≠ | OK |
| cable | 11.9s | 7 | 14 | 294 | ✓ | OK |

rssPeak Micro **300 MiB**. Local cold artifact `/tmp/ahorrar-bench/t61-local-cold-8q.json` · Micro `/tmp/ahorrar-bench/t61-micro-cold-8q.json` (VM).

**Veredicto:** merge #29. Zapatillas/smart-tv top3 → issues #22–#26 + T52/T56. stop_reason shipped (`satisfied|deadline|max_nodes|queue_empty`).


### Micro bench T61 (2026-09-29) — `sha-f74d6f0`

| Query | p50 | Verdict |
|---|---:|---|
| ryzen | 9426ms | OK |
| notebook | 11438ms | OK |
| iphone | 5116ms | OK (hosts=2) |
| smart tv | 12225ms | FAIL top3 |
| perfume | 4243ms | OK |
| zapatillas | **25579ms** | FAIL ceiling |
| Restore | registry `:micro` healthy | digest e9504ec0… |



### Post-merge Fase 2 (#30–#35) — 2026-09-29

| PR | Tip merge |
|---|---|
| #30 SSRF | `e5a42f4` |
| #32 golden | `422c231` |
| #31 stock | `28de87f` |
| #33 T56 | `b13089e` |
| #34 T52 | `e1db4fb` |
| #35 docs | `c0e4f07` |
| Floors | backend **175** · frontend **63** · Python **74** · e2e **0** |



### Post-merge #30 SSRF (2026-09-29)

| Check | Salida |
|---|---|
| Merge | squash → `e5a42f4` |
| Floors | backend **156** · frontend **63** · Python **68** · e2e **0** (↑ 148/63/60/0) |
| Gate | private ranges + URL tricks + redirects + DNS pin/cache + fetch-time · shape 94/94 |

### Fase 1.1 — mediana local ML=1 FW=2

| Corrida | Artefacto | Notas |
|---|---|---|
| ×3 | `/tmp/ahorrar-bench/t61-local-ml1-20260929-010826.json` | wall fail: smart tv, zapatillas; top3 fail: tv/heladera/zapatillas; **varianza >15% todas** |
| ×5 (protocolo C) | `/tmp/ahorrar-bench/t61-local-ml1-rerun5-20260929-011359.json` | p50: iphone 11.5 · tv 10.8 · ryzen 9.5 · perfume 3.1 · notebook **15.1** · heladera 3.4 · zapatillas 15.8 · cable 3.9 · **0 queries >25s** · top3 fail solo zapatillas · heladera price1=0 (bug ML) |

Commit bench: `79324e8`. Techo local 15s: notebook p50 15058ms (borde). Techo Micro 25s: **PASS p50**.

### Fase 1.2 — workflow_dispatch

| Campo | Valor |
|---|---|
| Run | https://github.com/YukaC/AhorrAR/actions/runs/36520707786 |
| Tags | `ghcr.io/yukac/ahorrar-api:sha-79324e8` · `branch-perf-t61-ml-degraded` |
| `:micro`/`:main` | **enable=false** · job `deploy-micro` **skipped** |
| Pin prod intacto | `oci-api-1` image `:micro` rev=`1ecd88e…` digest=`sha256:a35d6c038ab6…` (SSH 2026-09-29) |

### Fase 1.1b — bug price=0 ML (§V2)

`_offer_from_listings` devolvía offer con `price=0.0` si no había listing ARS+shipping. Fix: return `None`. Test: `scraper/tests/test_meli_offer.py` (+3 → Python 80).


### Fase 1.3 — Micro fair bench (swap temporal sha-0a0c450 → restore :micro)

| Campo | Valor |
|---|---|
| Imagen bench | `ghcr.io/yukac/ahorrar-api:sha-0a0c450` @ `sha256:71b9df03…` |
| Método | recreate compose api → ×3 cold restart → restore `:micro` |
| Pin post | `:micro` rev=`1ecd88e…` digest=`sha256:a35d6c038ab6…` RestartCount=0 |
| Artefacto | `/tmp/ahorrar-bench/t61-micro-fair-bench.jsonl` (+ log) |

| query | wall p50 | baseline | Δ | top3 | hosts |
|---|---:|---:|---:|:---:|---:|
| iphone 15 | 17681 | 16100 | +1.6s | ✓ | 2 |
| smart tv 55 | 22469 | 26100 | −3.6s | ✗ | 7 |
| ryzen 5 5600 | **32488** | 30100 | +2.4s | ✓ | 7 |
| perfume | 17989 | 9100 | +8.9s | ✓ | 8 |
| notebook | **27120** | 17000 | +10.1s | ✗ | 9 |
| heladera | 16940 | 12700 | +4.2s | ✗ | 10 |
| zapatillas nike | 18621 | 24600 | −6.0s | ✗ | 3 |
| cable | **26440** | 8500 | +17.9s | ✓ | 11 |

**Veredicto T61:** NO cumple p50≤25s (ryzen/notebook/cable). 1 ciclo código ya usado (fix ML price=0). Residual → issue. PR sin merge.

Parallel-contended bench (descartado por RAM, artefact `/tmp/ahorrar-bench/t61-micro-parallel-bench.jsonl`) peor aún en perfume/cable.

### Fase 0.2 — inventario (main `1ecd88e` · stash bak `ea670cd` · T61 `82218a7`)


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

- **T61** (#29): 4 huecos pre-merge (8q + hosts iphone + registry frío + digest ledger) · merge si variedad OK.
- Holdout + frase núcleo (#25) · T52 re-probe (#24) · T54 A1 (#26) · zapatillas R@10 (#22) · CodeQL (#27) · stash en `backup/*`.

## Falta

- [x] Deploy prod Vercel + API (hoy Micro; históricamente Fly luego Render)
- [x] ML ON en prod (`MELI_*` secrets + `INCLUDE_ML=1`; re-consent OK) — §T16 / `docs/ML.md`
- [x] Dominio canónico UI `ahorrarg.vercel.app` (+ redirects 308)
- [x] **Bloque 0 cerrado** — T55 merged + gate Micro (`1ecd88e` / PR #21) · SPEC §T55=`x`
- [ ] **T61** — 8q Micro frío + stop_reason → merge #29 si iphone variedad OK
- [x] Fase 2 #30–#35 merged
- [ ] T52 / holdout+núcleo / T54 A1 · zapatillas → #22
- [ ] Holdout relevancia / frase núcleo (#25)
- [x] **Gate Micro post-T55** (2026-09-29, criterio P1.7) — veredicto **quedarse**:

  **Imagen viva:** `revision=1ecd88e…` · digest `sha256:a35d6c038ab6…`  
  **Rollback pin:** `ghcr.io/yukac/ahorrar-api:sha-42ff331` @ `sha256:1ba2efc43d3402…` (en host)

  **INCLUDE_ML=1** (prod API, cold restart entre passes, mediana ×3, `FETCH_WORKERS=2`):

  | query | wall p50 | walls | ≤15s |
  |---|---:|---|:---:|
  | `iphone 15` | 16085 | 9204 / 22472 / 16085 | ✗ |
  | `smart tv 55` | 26134 | 26134 / 28114 / 22115 | ✗ |
  | `ryzen 5 5600` | 30063 | 34298 / 30063 / 29086 | ✗ |
  | `perfume` | 9090 | 11259 / 9090 / 8845 | ✓ |
  | `notebook` | 16957 | 20054 / 12317 / 16957 | ✗ |
  | `heladera` | 12744 | 12170 / 17077 / 12744 | ✓ |
  | `zapatillas nike` | 24637 | 24637 / 21411 / 24833 | ✗ |
  | `cable` | 8514 | 10245 / 6711 / 8514 | ✓ |

  **INCLUDE_ML=0** (1× in-container; ×3 mediana pendiente en T61):

  | query | wallMs | n | hosts |
  |---|---:|---:|---:|
  | `iphone 15` | 13503 | 4 | 2 |
  | `smart tv 55` | 17232 | 11 | 5 |
  | `ryzen 5 5600` | 20605 | 20 | 7 |
  | `perfume` | 5734 | 20 | 7 |
  | `notebook` | 18569 | 20 | 7 |
  | `heladera` | 15333 | 20 | 8 |
  | `zapatillas nike` | 7172 | 6 | 2 |
  | `cable` | 5685 | 20 | 8 |

  **Memoria (P1.7):** RSS pico **~312 MiB**/768 (ML=1) · **~265 MiB** (ML=0) · OOM=false · RestartCount=0 · swap ~318→407 pico→~342–362.

  **Salvedades (no bloquean):**
  1. Swap ya ~318 MiB en reposo → Micro usa swap idle; margen chico. Bench fue 1 query a la vez — ⊥ prueba 2 búsquedas concurrentes. Seguir `docker stats` + swap host 1 día de tráfico real antes de dar memoria por resuelta.
  2. Baseline T61 = **esta** tabla ML=1 ×3 (estado prod actual). No hace falta sha anterior para comparar.
  3. Techo **15 s no se cumple en prod** (5/8 over). **Techo Micro escrito:** wall p50 ≤**25 s** orientativo + reportar **top-3 estable** (precio/host) junto al wall (lo que ve el usuario). Local FW=2 sigue ≤15 s salvo zapatillas techo 20 s. Residual wall Micro → T61.

  **ML vs wall (no atribuir aún):** zapatillas Micro 24.6 s (ML=1 ×3 p50) vs 7.2 s (ML=0 **1×** sin repetición) — hipótesis parcial `ml_absorb` wait hasta 90 s; local FW=2 ya relativiza (zapatillas ML=0 ~16 s / ML=1 ~19 s, delta chico). **⊥ escribir "ML costaba 18 s"** hasta mediana ×3 en Micro post-fix. T61: join 4 s + `ML_REQUEST_TIMEOUT_S=8` (> join, evita breaker por lentitud normal) + cancel cooperativo + discard late + log `ml_wait_ms`/`ml_arrived`/`ml_offers`/`ml_cancelled_calls`.

  **Cierre T61 (escrito — no estirar):**
  1. Micro ML=1 · 8 queries · p50 ≤25 s · top-3 estable.
  2. Cobertura ML no bajo baseline medido (tabla prod) — o caída explicada por `ml_arrived=0`.
  3. Tests cancel (wall≈timeout, 0 calls post-cancel, breaker=) + degraded (mass / single / recheck+histéresis) verdes.
  4. E2E Playwright `npm --prefix frontend run test:e2e` verde (T53 restaurado desde stash).
  5. Si tras **un** ciclo Micro más algo falla → residual a issue nuevo · **T61 se cierra igual**.

  **Nota conteo backend:** `main` y esta rama corren **148** tests Vitest (22 files). El “157” venía de WIP en `stash@{0}` (golden/host-allow/adaptive/dedupe untracked, nunca en main) — no es regresión de este PR.

  **Orden:** tests → mediana local ×3 → imagen tag propio en Micro → merge. Anotar tag corrido abajo.

  **Bench Micro pre-merge (cómo):**
  1. `workflow_dispatch` del workflow `Docker GHCR` sobre el **branch del PR** → empuja `ghcr.io/yukac/ahorrar-api:sha-<short>` (deploy auto solo corre en `main`).
  2. En la Micro: anotar pin actual (`:micro` / digest vivo) → pull del tag PR → recreate → bench ML=1 mediana ×3 + grepear logs `ml_wait_ms`/`ml_arrived`/`ml_cancelled_calls`.
  3. Volver al pin prod. Anotar acá el tag usado.
  4. Tag PR usado: _(pendiente)_. Pin rollback: `:micro` @ `revision=1ecd88e…` / digest `sha256:a35d6c038ab6…`.
- [x] Live bench local (histórico 2026-09-24):

  | query | elapsedMs | pagesFetched | #results | min price |
  |---|---:|---:|---:|---:|
  | `ryzen 5 5600` | 2001 | 11 | 20 | 226990 |
  | `perfume bensimon` | 1126 | 6 | 20 | 31843.5 |
  | `smart tv 55` | 3747 | 8 | 20 | 282999 |



### Fase 1 — T61 (rama `perf/t61-ml-degraded`)

| Afirmación | Evidencia |
|---|---|
| PR abierto sin merge | https://github.com/YukaC/AhorrAR/pull/29 |
| Residual Micro wall | https://github.com/YukaC/AhorrAR/issues/28 (ryzen/notebook/cable >25s fair) |
| Pin prod intacto | `:micro` @ `1ecd88e` digest `a35d6c038ab6…` · RestartCount=0 |
| Un ciclo código | `meli_api._offer_from_listings` → None sin ARS+shipping (evita price=0) |

### Fase 2 — WIP stash → PRs (no merge)

| Ítem | PR | Nota |
|---|---|---|
| host-allow/SSRF §V32 | #30 | prioridad seguridad |
| stock + dedupe §T60 | #31 | |
| golden T58 + holdout sellado | #32 | tuning P@10 baseline 0.877 |
| frase núcleo + adaptive §V31/T56 | #33 | commit `6ebfbeb` |

### Fase 4 — holdout + núcleo (medida local)

| Split | P@10 | R@10 |
|---|---:|---:|
| tuning (post-V31) | 0.983 | 0.943 |
| holdout | 0.917 | 0.850 |
| gap | **0.066** | <0.10 → anti-overfit OK |

zapatillas nike R@10=0.60. Conteos rama T56: backend **159** / Python **64** (floors main 148/60).

### Fase 3 — T52 (en curso)

- Script faltante en main: `scripts/reprobe-ar-shops.sh` (ROADMAP lo citaba sin archivo) — se agrega en `chore/t52-index-canary`.
- Canary ≥2 queries/cat · 2 momentos · streak≥2 para `alive=false` · mass-fail guard 0.55.
- Revive candidatos (probe dead electro/bazar): `store.sony.com.ar`, `shop.lg.com.ar`, `tramontina.com.ar`.
- Artefactos: `/tmp/ahorrar-shop-canary-*.json` · log `/tmp/ahorrar-reprobe.log` (completar tras run).


## Bugs conocidos

- Ninguno abierto en `SPEC.md` §B. El error preexistente de typecheck `CrawlStats` en `backend/src/search/bfs.ts:18` (noUnusedLocals) está aceptado sin fix.

## Bloqueantes

- Ninguno. Access token ML ~6h: auto-refresh on 401 (+ persist volume). Solo re-consent manual si refresh revoke.
