# Roadmap — AhorrAR

> Hacia dónde va el proyecto, a alto nivel. La vista **operativa** (tareas, estados) es
> `SPEC.md` §T; el estado **actual** (qué está hecho/en curso/falta) es `docs/progress.md`.
> Este doc comunica dirección y prioridades. Sin datos inventados: cada ítem referencia
> una feature/issue o una tarea de §T.

## Ahora (v0.2)

- [x] Despliegue a producción (Fly API + Vercel web, GitHub → auto-deploy) — ref `docs/DEPLOY.md` · UI https://ahorrarg.vercel.app
- [x] ML ON en prod (`MELI_*` secrets + `INCLUDE_ML=1`) — §T16 / `docs/ML.md`
- [x] ML auto-refresh on 401 + Fly volume token file — §T38
- [x] Señal real de envío gratis + pill UI — §T37
- [x] ML circuit breaker (degradación con gracia) — §T43 · fallback HTML **descartado por ToS ML** — §T17
- [x] Relevance anti-accesorio + class evidence — §T44–T45 / §V27/§V28
- [x] UI result caps 25→50→100 + SearchBar sync — §T46

## Luego (v0.3)

- [x] Caché de resultados por producto (TTL + SWR) — §T25
- [x] Índice `ar-shops.json` v3 platform/alive + seeds platform-aware + parsers Woo/Shopify — §T31/T32
- [ ] Cubrir más categorías/templates en `shared/ar-shops.json` (moda, bazar) + re-probe periódico — ref §T22/V19
- [ ] Suite E2E automatizada (Playwright) sobre el flujo live SSE — ref `docs/testing-strategy.md`
- [ ] Stage Docker opcional con browsers si se quiere `STEALTH_FETCH=1` en un entorno no-Fly — §T33 / `docs/DEPLOY.md`
- [x] **Filtro “Envío gratis” con señal real:** `shipping.free` desde VTEX `ShippingSLA[].Price==0` y ML `free_shipping` (gana sobre regex del hint) · pill SortBar re-activado · paridad Node↔Python (fixture contrato con ShippingSLA) — §T37 / §V25

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