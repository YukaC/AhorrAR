# ADR-0001 — ML solo por API oficial, nunca HTML de listado

- **Estado**: aceptada
- **Fecha**: 2026-09-23
- **Decisores / participantes**: usuario + IA
- **Relacionado**: `SPEC.md` §C.12 · §V17/V18 · §T18 · `docs/ML.md` · `DONT_DO.md`

## Contexto
Descubrir tiendas nuevas en el HTML del listado de MercadoLibre es técnicamente posible
(parsing de SERP), pero rompe los términos del sitio y depende de HTML que cambia. ML
expone una API oficial con OAuth: `/products/search` + `/products/{id}/items` (camino
catalogo post-Abr/2025, cuando `/sites/{site}/search` dejó de andar). Se evaluaron
actores externos (Apify) que simplifican el scraping de ML y de otros sitios.

## Decisión
Todo dato de MercadoLibre sale **exclusivamente** de la API oficial con token válido.
Crawlear el listado HTML de ML está prohibido. Actores externos (Apify) se descartan:
el crawler es propio (Scrapling) y ML es API pura.

## Consecuencias
Positivas:
- Cumple términos del sitio; menos riesgos de bloqueos/403.
- `meli_api.py` es el único punto de contacto; token secreto en `scraper/.env`, prod OFF hasta inyectar secrets.

Negativas / costos:
- La API es estricta: requiere permiso funcional "Publicación y sincronización"
  (read-write) y cuenta validada para ciertos campos → los offers ML llevan menos datos
  que VTEX (sin `installments`, ver ADR-0004).

## Alternativas consideradas
| Alternativa | Por qué se descartó |
|---|---|
| Apify actores | Costo externo + datos ajenos; decisión del usuario mantener crawler propio |
| HTML listado ML | Prohibido por términos (§C.12); fragile |
| `/sites/{site}/search` | Muerto desde Abr/2025 (403 incluso anon/autenticado) |