# ADR-0004 — Ranking balanceado: reputación + precio + cuotas, cap ML 50%

- **Estado**: aceptada
- **Fecha**: 2026-09-23
- **Decisores / participantes**: usuario + IA
- **Relacionado**: `SPEC.md` §V17/V18 · §T23 · `backend/src/scoring/score.ts`

## Contexto
Ordenar solo por precio favorecía a MercadoLibre (tiene siempre ofertas baratas) y
ahogaba tiendas locales curadas. El usuario pidió: ponderar **siempre** la reputación
del sitio y el precio, más **financiación en cuotas sin interés**, con tope de top-N
(UI 25/50/100, max 100) y cupo para ML.

## Decisión
`score.ts`: `scoreFor = tier local/intl (gap 1e6, precio nunca cruza tier) + relevance
tier (§V28) + precio efectivo con descuentos` — reputación: curado en índice −8%,
descubierto −4%, desconocido 0% · bonus cuotas sin interés −3% (solo `interestFree`,
llegado de VTEX).
`rankByPriority` clampa la cuota de ML a ≤50% del top-N (N = `maxResults`, UI steps
25/50/100, max 100 — §V17/§T46) y renumbera ranks contiguos 1..n.

## Consecuencias
Positivas:
- ML nunca copa el top: E2E "samsung s24" = 10 results, share exacto 50% (5/10).
- Tienda curada con cuotas sin interés gana a ML más caro (fravega en el top por precio efectivo).
- Los `installments` vienen solo de VTEX (`_parse_vtex_installments`); ML no expone cuotas.

Negativas / costos:
- Descuentos son heurísticos (8/4/3 %); hay que calibrarlos con métricas reales.
- Cap ML se aplica en ranking **y** en la fuente Python (`max(1, int(max_results*0.5))`)
  → dos lugares que mantener coherentes.

## Alternativas consideradas
| Alternativa | Por qué se descartó |
|---|---|
| Orden por precio puro | Ahogaba lo curado; violaba la petición del usuario |
| Multiplicador duro por tier (curated > else siempre) | Perdía sensibilidad a precio; un curado carísimo taparía todo |
| Cap ML <50% (33%) | Arbitrario por debajo de lo pedido; 50% era la consigna (§V17) |