# DONT_DO — AhorrAR

> Cosas que ya fallaron o se descartaron **y no se vuelven a hacer**, para que ninguna
> sesión (ni humana ni IA) las reinvente. Registro canónico de bugs con causa: `SPEC.md` §B.
> Este doc es la vista de **decisiones** ("no usar X, usar Y"); §B es la vista de **bugs**
> ("falló, causa, fix"). Agregar acá solo lo que vale como regla de no-repetición.

| Fecha | Área | Síntoma | Causa raíz | Decisión |
|---|---|---|---|---|
| 2026-09-23 | crawler | `visited` usado antes de definirse en loop ML | referencia a variable en scope posterior | Declarar `visited = set()` al inicio del BFS, no dentro de un bloque condicional (`crawl.py`) |
| 2026-09-23 | crawler/ranking | Muy pocos nodos visitados: VTEX API llena `max_results` y corta el BFS temprano | fuente perezosa + tope único global | Cap ML por separado en la fuente; dejar que el BFS siga visitando tiendas no-VTEX |
| 2026-09-23 | e2e | `curl` `/crawl/stream` devolvía 0 offers con grep `"type":"offer"` | el stream emite `"type": "offer"` (con espacio) y el contrato pide `product`, no `q` | Usar `"type": "offer"`/`product` en verificaciones manuales; `grep -c '"type": "offer"'` |
| 2026-09-23 | tests | tests de seeds pisaban el índice real | path del índice no-configurable | `AR_SHOPS_JSON` env para fixtures temporales: nunca tocar `shared/ar-shops.json` desde tests |
| 2026-09-23 | typecheck | `CrawlStats` declarado y no usado en `bfs.ts:18` | restos de refactor | Error preexistente aceptado; no tocar sinecesidad (noUnusedLocals) |
| 2026-09 rd | ML | 50 productos sin competencia y lentos en `/products/{id}/items` | la API de ML devuelve 404 "No winners" para productos sin listings | Skip por diseño (§C.12); el 404 ES el resultado esperado, no un bug |

## Reglas clave ya decididas

- No reinventar lo que está en `docs/decisions/` (ADRs): si aparece un patrón, mirar ahí antes.
- No parchear un bug en silencio: backprop → §B (+ §V si hay invariante nueva).
- No inventar `installments` para MercadoLibre: la API no los expone; solo VTEX (`commertialOffer.Installments`) — §V18.
- No usar actores de scraping externos (Apify): crawler propio, §C.
- No scrapear listado de ML por HTML: solo API oficial con token — §C.12, `docs/ML.md`.
- El frontend nunca ordena ni calcula reputación: solo renderiza el ranking del backend.