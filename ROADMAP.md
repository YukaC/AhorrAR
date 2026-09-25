# Roadmap — AhorrAR

> Hacia dónde va el proyecto, a alto nivel. La vista **operativa** (tareas, estados) es
> `SPEC.md` §T; el estado **actual** (qué está hecho/en curso/falta) es `docs/progress.md`.
> Este doc comunica dirección y prioridades. Sin datos inventados: cada ítem referencia
> una feature/issue o una tarea de §T.

## Ahora (v0.2)

- [x] Despliegue a producción (Fly API + Vercel web, GitHub → auto-deploy) — ref `docs/DEPLOY.md` · UI https://ahorrarg.vercel.app
- [x] ML ON en prod (`MELI_*` secrets + `INCLUDE_ML=1`) — §T16 / `docs/ML.md`
- [x] ML auto-refresh on 401 + Fly volume token file — §T38
- [~] Señal real de envío gratis + pill UI — §T37

## Luego (v0.3)

- [x] Caché de resultados por producto (TTL + SWR) — §T25
- [x] Índice `ar-shops.json` v3 platform/alive + seeds platform-aware + parsers Woo/Shopify — §T31/T32
- [ ] Cubrir más categorías/templates en `shared/ar-shops.json` (moda, bazar) + re-probe periódico — ref §T22/V19
- [ ] Suite E2E automatizada (Playwright) sobre el flujo live SSE — ref `docs/testing-strategy.md`
- [ ] Stage Docker opcional con browsers si se quiere `STEALTH_FETCH=1` en un entorno no-Fly — §T33 / `docs/DEPLOY.md`
- [ ] **Filtro “Envío gratis” (UI oculta):** hoy `shipping.free` casi siempre `false` porque VTEX/Woo hardcodean `shippingHint: "Envío a domicilio"` (§V1 confirm) sin señal free. Re-habilitar pill en `SortBar` cuando haya fuente real: HTML listing (`envio gratis`), logística VTEX, y/o ML `free_shipping` (`INCLUDE_ML`). Lógica `filterResults.freeShipping` ya lista. “Solo local” eliminado (búsqueda AR-only → `store.local` siempre true).

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