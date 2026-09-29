# Golden baseline — T58 + core-phrase (§V31) (2026-09-28)

Replay de ofertas etiquetadas por `isRelevantResult` + `rankByPriority`. Sin red.

- **Tuning** (`shared/golden/tuning/`): iteración / afinado.
- **Holdout** (`shared/golden/holdout/`): sellado — no mirar al tunear.
- Legacy symlink: `shared/golden/queries` → `tuning/`.

Comando: `npm --prefix backend run test -- test/golden.test.ts`  
Métricas: `backend/src/golden/metrics.ts` (P@10, R@10, Rpub, `missedProducts`)

## Resumen (post frase-núcleo)

| Split | Queries | P@10 | R@10 | Rpub | hosts |
|---|---:|---:|---:|---:|---:|
| **tuning** | 10 | **0.983** | **0.943** | 0.943 | ~4.7 |
| **holdout** | 8 | **0.917** | **0.850** | 0.850 | ~4.6 |

Umbral adaptativo `MIN_STRONG_FOR_SET_SIGNALS=8`: **sin bajar**. Mediana = subset con hit de frase núcleo (no score del gate). Holdout no justifica tocar el umbral.

## Tuning (por query)

| Query | P@10 | R@10 | Rpub |
|---|---:|---:|---:|
| cable | 1.00 | 1.00 | 1.00 |
| funda iphone 15 | 1.00 | 0.83 | 0.83 |
| heladera | 1.00 | 1.00 | 1.00 |
| iphone 15 | 0.86 | 1.00 | 1.00 |
| mouse gamer | 1.00 | 1.00 | 1.00 |
| notebook | 1.00 | 1.00 | 1.00 |
| perfume | 1.00 | 1.00 | 1.00 |
| ryzen 5 5600 | 1.00 | 1.00 | 1.00 |
| smart tv 55 | 1.00 | 1.00 | 1.00 |
| zapatillas nike | 1.00 | 0.60 | 0.60 |

## Holdout (por query)

| Query | P@10 | R@10 | Rpub |
|---|---:|---:|---:|
| auriculares bluetooth | 1.00 | 1.00 | 1.00 |
| cargador | 1.00 | 1.00 | 1.00 |
| jeans levis | ~0.8 | 1.00 | 1.00 |
| monitor 27 | 1.00 | 1.00 | 1.00 |
| mouse | ~0.8 | 1.00 | 1.00 |
| ps5 | ~0.7 | 0.40 | 0.40 |
| tablet samsung | ~0.5 | 0.40 | 0.40 |
| teclado mecanico | 1.00 | 1.00 | 1.00 |

## Misses de recall (producto etiquetado fuera de top-10)

- tuning `funda iphone 15`: Case cover iPhone 15 anti-golpe
- tuning `zapatillas nike`: Nike Revolution 6 Running | Nike Pegasus 40 hombre
- holdout `ps5` / `tablet samsung`: títulos sin token de query en núcleo (PlayStation / Tab)

## Lectura

- Frase núcleo unifica FPs (enrollador/compatible/repuesto/negación/vidrio) sin listas por familia de producto.
- Caída de R@10 en holdout (`ps5`, `tablet`) = cobertura de sinónimos, no señal para bajar umbral.
- Actualizar al cambiar gate/ranking; re-correr **ambos** splits.
