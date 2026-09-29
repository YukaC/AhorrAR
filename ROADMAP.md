# Roadmap — AhorrAR

> Hacia dónde va el proyecto, a alto nivel. La vista **operativa** (tareas, estados) es
> `SPEC.md` §T; el estado **actual** (qué está hecho/en curso/falta) es `docs/progress.md`.
> Este doc comunica dirección y prioridades. Sin datos inventados: cada ítem referencia
> una feature/issue o una tarea de §T.

## Ahora (v0.2 → v0.4 Micro)

- [x] Despliegue a producción — **hoy:** Vercel UI + OCI Micro API · Render backup · Fly retirado — ref `docs/PROD.md`
- [x] ML ON en prod (`MELI_*` secrets + `INCLUDE_ML=1`) — §T16 / `docs/ML.md`
- [x] ML auto-refresh on 401 + token file volume — §T38
- [x] Señal real de envío gratis + pill UI — §T37
- [x] ML circuit breaker (degradación con gracia) — §T43 · fallback HTML **descartado por ToS ML** — §T17
- [x] Relevance anti-accesorio + class evidence — §T44–T45 / §V27/§V28
- [x] UI result caps 25→50→100 + SearchBar sync — §T46

## Luego (v0.4 pulido)

- [x] Golden set + métricas (precision@10, min-price rel, hosts, ML) — §T58
- [x] Defensas Micro (bytes cap, discover SSRF) + stock/dedupe variantes — §T59/T60
- [x] Re-probe periódico `ar-shops.json` — §T52 (`scripts/reprobe-ar-shops.sh`)
- [x] Relevancia adaptativa query-agnostic — §T56 / §V31
- [x] Perf price-first + corte yield + set-satisfecho explícito — §T55 / §V30 / §V34
- [ ] Degraded+recheck + residual Micro wall — §T61 / §V19 / §V34
- [x] Suite E2E Playwright SSE — §T53
- [ ] Stage Docker opcional browsers `STEALTH_FETCH=1` — diferido Micro

## Más adelante

- [ ] App React nativa (Expo) o PWA con notificaciones de precio
- [ ] Alertas de precios: seguir un producto y avisar cuando baja
- [ ] Historial de precios por artículo (serie temporal)
- [ ] `capture_xhr` (DynamicFetcher/browser siempre): ROI bajo vs fingerprint+API; diferido — no en plan Scrapling max-util

## No planeado (o descartado)

- Actores de scraping externos (Apify) — descartado, §C confía en crawler propio.
- Scrapear listado ML por HTML — prohibido (§C.12, ver `docs/ML.md`).
- Redis/Broker para jobs (por ahora jobs en memoria alcanzan) — si escala, ver ADR.
- Migrar BFS a Scrapling `Spider`/`CrawlSpider`/`ShopifySpider` — descartado (reescritura cara; search live incompatible con catálogo completo).