# ML coverage — honest notes (T57)

Fuente: [`docs/golden-baseline.md`](golden-baseline.md) (T58, 2026-09-28).

## Números del golden (replay etiquetado)

| Métrica | Valor |
|---|---|
| ML coverage (% queries con ≥1 oferta ML en top-10 tras gate+rank) | **80%** |
| mean ML offers when present | 1.25 |
| Queries sin ML en top | `funda iphone 15`, `heladera` |

## Decisión: ¿cuenta vendedora?

**No urgente.** Con 80% de cobertura en el golden, el camino actual (`products/search` → `products/{id}/items`) alcanza para la mayoría de queries de producto.

Cuenta vendedora (KYC / `billing.allow`) habilitaría buy box / `sale_price` / algunos endpoints 403 hoy — ROI bajo vs costo de operar una cuenta vendedora solo para el comparador.

Revisar si el golden live (prod) baja de ~50% coverage o si queries clave (heladera, fundas) son tráfico real dominante.

## Gaps conocidos (SPEC §C / B4)

- Cuenta token YUCA no vendedora → buy box / `/sites/MLA/search` ⊥.
- Circuit breaker §V26 degrada sin fallar la búsqueda.
