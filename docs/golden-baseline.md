# Golden baseline — T58 (pre–frase núcleo, gate main)

Replay de ofertas etiquetadas por `isRelevantResult` + `rankByPriority`. Sin red.

- **Tuning** (`shared/golden/tuning/`): iteración / afinado.
- **Holdout** (`shared/golden/holdout/`): **sellado** — no mirar al tunear (Fase 4 / §V31).
- Legacy symlink: `shared/golden/queries` → `tuning/`.

Comando: `npm --prefix backend run test -- test/golden.test.ts`  
Métricas: `backend/src/golden/metrics.ts` (P@10, R@10, Rpub, `missedProducts`)

Medido en `main` + fixtures de este PR (2026-09-29):

| Split | Queries | P@10 | R@10 | hosts |
|---|---:|---:|---:|---:|
| **tuning** | 10 | **0.877** | **0.983** | ~5.0 |
| **holdout** | 8 | **0.714** | **0.850** | ~4.9 |

Piso plan: tuning P@10 ≥ **0.877**. Holdout baja vs tuning es esperado sin frase núcleo — no tunear contra holdout.

## Tuning (por query)

| Query | P@10 | R@10 | hosts |
|---|---:|---:|---:|
| cable | 0.75 | 1.00 | 6 |
| funda iphone 15 | 1.00 | 0.83 | 5 |
| heladera | 0.83 | 1.00 | 4 |
| iphone 15 | 0.86 | 1.00 | 5 |
| mouse gamer | 0.83 | 1.00 | 5 |
| notebook | 1.00 | 1.00 | 5 |
| perfume | 1.00 | 1.00 | 5 |
| ryzen 5 5600 | 0.83 | 1.00 | 5 |
| smart tv 55 | 0.83 | 1.00 | 5 |
| zapatillas nike | 0.83 | 1.00 | 5 |

## Holdout (sellado — solo validación)

| Query | P@10 | R@10 | hosts |
|---|---:|---:|---:|
| auriculares bluetooth | 0.71 | 1.00 | 6 |
| cargador | 0.50 | 1.00 | 6 |
| jeans levis | 0.83 | 1.00 | 5 |
| monitor 27 | 1.00 | 1.00 | 5 |
| mouse | 0.83 | 1.00 | 6 |
| ps5 | 0.50 | 0.40 | 3 |
| tablet samsung | 0.50 | 0.40 | 3 |
| teclado mecanico | 0.83 | 1.00 | 5 |

Funnel audit (live): `cd scraper && uv run python ../scripts/audit_offer_funnel.py '<query>'`  
ML coverage notes: [`docs/ML-COVERAGE.md`](ML-COVERAGE.md)
