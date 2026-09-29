# Audit — iphone 15 funnel + latency bisect (2026-09-28)

Scripts: `scripts/audit_offer_funnel.py`, `scripts/audit_crawl_timing.py`, `scripts/sweep_shop_canary.py`, `scripts/bench_crawl_median.py`  
Artifacts: `/tmp/ahorrar-t55-median.json`

## 1–4. (funnel · canario · mediana pre-corte · commits probe)

Ver historial git / sesión previa. Pre-corte iphone p50 ~21 s.

## 5. Corte yield + set-satisfecho explícito — T55 closed

**Set satisfecho** (§V30) = cupo lleno ∧ ≥K hosts (K=4) ∧ ⊥ candidato pendiente que mejore `(tier, precio)` (misma cota `filter_probe_candidates`). Sin soft-floor.

**Trade-off probes:** mid-crawl `PROBE_PER_PAGE=3`; skip mid-crawl probes solo si set satisfecho; **solo top-3 PDP verify** al final → posiciones 4–N pueden incluir PDP muerto (HTML/Woo).

**ML gate:** `include_ml and token` (⊥ token solo).

Bench cold ×3 (`FETCH_WORKERS=2`, clear offer-cache), techo wall **15 s**:

| query | wall p50 | hosts | n | price#1 | P@10 | R@10 | probes | ≤15s |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| iphone 15 | **11.5 s** | 3 | 7 | 1.47M | 1.00 | 1.00 | 3 | ✓ |
| smart tv 55 | 17.3 s | 6 | 16 | 455k | 1.00 | 1.00 | 3 | ✗ |
| ryzen 5 5600 | 19.5 s | 7 | 20 | 229k | 1.00 | 1.00 | 21 | ✗ |
| perfume | 4.7 s | 7 | 20 | 6.7k | 1.00 | 1.00 | 3 | ✓ |
| notebook | 18.3 s | 7 | 20 | 27k | 1.00 | 1.00 | 18 | ✗ |
| heladera | 11.2 s | 10 | 20 | 112k | 1.00 | 1.00 | 12 | ✓ |
| zapatillas nike | 30.6 s | 5 | 20 | 49k | 1.00 | 0.60 | 13 | ✗ |
| cable | 7.7 s | 8 | 20 | 2.6k | 1.00 | 1.00 | 3 | ✓ |

P@10/R@10 = Node `metricsForQuery` (golden tuning, sin red). Mean P@10 8q = **1.00** (≥0.877).

iphone: hosts=3 = límite de índice (⊥ K=4); yield-cut sí aplica. Residual wall (tv/ryzen/notebook/zapatillas) bajo set-satisfecho estricto → **T61**, no más iterar T55.
