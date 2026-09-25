# ADR-0002 — Streaming real del crawler por SSE (ndjson)

- **Estado**: aceptada
- **Fecha**: 2026-09-23
- **Decisores / participantes**: usuario + IA
- **Relacionado**: `SPEC.md` §C.14 · §V16 · §T19/T20/T21

## Contexto
El producto comparador tarda ~24 s en un crawl completo, pero los primeros resultados
llegan en ~2–3 s. Una UI que espera el 100% muestra una pantalla de carga larga sin
valor. Opciones: mostrar skeletons de "carga" (atuendo, no datos reales) o streamming
real de ofertas a medida que se encuentran.

## Decisión
Streaming **real**: `POST /crawl/stream` en el scraper emite líneas ndjson
(`offer`/`progress`/`done`/`error`) a medida que el BFS encuentra ofertas; el backend
las convierte en `SearchProgress.results?` parciales y las propaga por SSE
(`/api/search/:id/events`). El frontend pinta cards en vivo. Sin resultados ficticios.

## Consecuencias
Positivas:
- El usuario ve resultado del buscador en segundos, no al final del crawl.
- El ranking final se re-calcula sobre el set completo; los partials son solo vista previa.

Negativas / costos:
- El contrato SSE crece (`SearchProgress.results?` opcional, §V16); el backend debe
  tolerar líneas basura del ndjson (`parseScraplingLine` ignora líneas no JSON).
- Timeout de 180 s del stream para crawls largos; si se corta, fallback a legacy.

## Alternativas consideradas
| Alternativa | Por qué se descartó |
|---|---|
| Esqueleto ficticio con cards fake mientras carga | Falso, engañoso; decisión del usuario: streaming real |
| Esperar el 100 % y luego pintar todo | UX lenta, sin valor de live cards |
| Polling de progreso periódico | SSE ya existía para jobs; pushear es más simple y directo |