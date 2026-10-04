# Roadmap — AhorrAR

> Dirección y prioridades a alto nivel. Vista **operativa** = `SPEC.md` §T.
> Estado **actual** (prod, pin, límites) = `docs/progress.md`.
> Sin datos inventados: cada ítem referencia §T / PR / issue.

## Hecho (v0.2 → v0.4)

- [x] Despliegue a producción — Vercel UI + OCI Micro API · Render backup · Fly retirado — `docs/PROD.md`
- [x] ML ON en prod (`MELI_*` + `INCLUDE_ML=1`) — §T16 / `docs/ML.md`
- [x] ML auto-refresh on 401 + token file volume — §T38
- [x] Señal real de envío gratis + pill UI — §T37
- [x] ML circuit breaker — §T43 · HTML ML **descartado** (ToS) — §T17
- [x] Relevance anti-accesorio + class evidence — §T44–T45 / §V27/§V28
- [x] UI result caps 25→50→100 + SearchBar sync — §T46
- [x] Golden set + métricas — §T58 · merged #32
- [x] Defensas SSRF + stock/dedupe — §T59/T60 · merged #30 #31
- [x] Re-probe periódico `ar-shops.json` — §T52 · merged #34
- [x] Relevancia adaptativa + frase núcleo — §T56 / §V31 · merged #33
- [x] Perf price-first + corte yield + set-satisfecho — §T55 / §V30 / §V34
- [x] Degraded + ML join + stop_reason + E2E Playwright SSE — §T61/T53 · merged #29
- [x] Cierre plan §T (T1–T62) · #39 = límite IP datacenter (no bug de código) — §B14

## Abierto (producto / ops, no plan §T)

- [ ] **Redeploy prod al tip de `main`** — hoy la VM está **pineada** a digest pre–T61 (`docs/progress.md`). Decisión humana.
- [ ] **Proxy / salida residencial (opcional)** — Frávega (y similares) 403 desde IP OCI; local OK. Issue #39 cerrado como límite conocido.
- [ ] Stage Docker opcional browsers `STEALTH_FETCH=1` — diferido Micro (imagen HTTP-only).

## Más adelante

- [ ] App React nativa (Expo) o PWA con notificaciones de precio
- [ ] Alertas de precios: seguir un producto y avisar cuando baja
- [ ] Historial de precios por artículo (serie temporal)
- [ ] `capture_xhr` (DynamicFetcher/browser siempre): ROI bajo vs fingerprint+API; diferido

## No planeado (o descartado)

- Actores de scraping externos (Apify) — descartado, §C confía en crawler propio.
- Scrapear listado ML por HTML — prohibido (§C.12, ver `docs/ML.md`).
- Redis/Broker para jobs (por ahora jobs en memoria / SQLite alcanzan) — si escala, ver ADR.
- Migrar BFS a Scrapling `Spider`/`CrawlSpider`/`ShopifySpider` — descartado (reescritura cara; search live incompatible con catálogo completo).
- Subir `HOST_MIN_PRODUCTIVE` 2→4 para “arreglar” #39 — refutado (#40); causa = IP, no K_cut.
