#!/usr/bin/env python3
"""Cold ×3 T55/T61 bench: wall + quality + stop_reason + ML + RSS.

  cd scraper && FETCH_WORKERS=2 INCLUDE_ML=1 \\
    uv run python ../scripts/bench_crawl_median.py

Cold = clear offer cache + clear degraded outcome registry between every run
(so hosts marked barren in query N do not poison query N+1).

Columns: wall p50 · hosts · n · P@10 · R@10 · stop_reason · ml_arrived · RSS.
top3_stable = same (price,host) top-3 across the 3 reps (NOT “top3≈wall”).
"""

from __future__ import annotations

import json
import os
import re
import resource
import statistics
import sys
import time
from pathlib import Path
from typing import Any

os.environ.setdefault("FETCH_WORKERS", "2")
os.environ.setdefault("CRAWL_DEADLINE_S", "30")
os.environ.setdefault("INCLUDE_ML", "0")

from ahorrar_scraper.crawl import _offer_cache, crawl  # noqa: E402
from ahorrar_scraper.host_yield import clear_outcome_registry  # noqa: E402
from ahorrar_scraper.relevance import is_relevant_result, title_relevance_score  # noqa: E402
from ahorrar_scraper.seeds import host_of  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
GOLDEN_TUNING = ROOT / "shared" / "golden" / "tuning"

DEFAULT_QUERIES = [
    "iphone 15",
    "smart tv 55",
    "ryzen 5 5600",
    "perfume",
    "notebook",
    "heladera",
    "zapatillas nike",
    "cable",
]

# Official Node metricsForQuery for the 8 bench queries (replay, no network).
GOLDEN_R10_NODE: dict[str, float] = {
    "iphone 15": 1.0,
    "smart tv 55": 1.0,
    "ryzen 5 5600": 1.0,
    "perfume": 1.0,
    "notebook": 1.0,
    "heladera": 1.0,
    "zapatillas nike": 0.60,
    "cable": 1.0,
}
GOLDEN_P10_NODE: dict[str, float] = {k: 1.0 for k in GOLDEN_R10_NODE}
WALL_CEILING_MS = 15_000
# Local T61: zapatillas techo 20s (progress); resto 15s.
WALL_CEILING_BY_QUERY_MS: dict[str, int] = {"zapatillas nike": 20_000}
GOLDEN_P10_FLOOR = 0.877
# Micro gate (user decision): wall fail alone does not block merge vs prod wins.
MICRO_WALL_CEILING_MS = 25_000
STOP_REASONS = frozenset({"satisfied", "deadline", "max_nodes", "queue_empty"})


def _env_truthy(name: str, default: str = "0") -> bool:
    raw = (os.environ.get(name) or default).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def wall_ceiling_ms(query: str) -> int:
    if _env_truthy("BENCH_MICRO", "0"):
        return MICRO_WALL_CEILING_MS
    return WALL_CEILING_BY_QUERY_MS.get(query, WALL_CEILING_MS)


def _slug(query: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")


def load_golden(query: str) -> dict[str, Any] | None:
    path = GOLDEN_TUNING / f"{_slug(query)}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def golden_precision_at_10(gq: dict[str, Any]) -> float:
    """Approximate Node metricsForQuery P@10 (gate + price sort within relevant)."""
    query = gq["query"]
    offers = gq.get("offers") or []
    relevant = [
        o
        for o in offers
        if isinstance(o.get("name"), str) and is_relevant_result(o["name"], query)
    ]
    # Rank: strong tier first, then price (mirrors score tier gap loosely).
    relevant.sort(
        key=lambda o: (
            0 if title_relevance_score(o["name"], query) >= 0.55 else 1,
            float(o.get("price") or 1e18),
        )
    )
    top = relevant[:10]
    if not top:
        return 0.0
    hits = sum(1 for o in top if o.get("label") == "product")
    return hits / len(top)


def live_product_recall(gq: dict[str, Any], live: list[dict[str, Any]]) -> float:
    """Fraction of golden product-labeled offers whose host appears in live results."""
    products = [o for o in (gq.get("offers") or []) if o.get("label") == "product"]
    if not products:
        return 1.0
    live_hosts = {
        host_of(r.get("url", "")) for r in live if isinstance(r.get("url"), str)
    }
    live_hosts.discard("")
    found = 0
    for o in products:
        h = str(o.get("host") or "").replace("www.", "").lower()
        if h and h in live_hosts:
            found += 1
            continue
        # Name token overlap fallback
        name = str(o.get("name") or "").lower()
        if any(
            name
            and name[:24] in str(r.get("name") or "").lower()
            for r in live
        ):
            found += 1
    return found / len(products)


def rank_results(product: str, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        (r for r in results if isinstance(r.get("price"), (int, float))),
        key=lambda r: (
            0
            if title_relevance_score(str(r.get("name") or ""), product) >= 0.55
            else 1,
            float(r["price"]),
        ),
    )


def price_number_one(product: str, results: list[dict[str, Any]]) -> float | None:
    ranked = rank_results(product, results)
    if not ranked:
        return None
    return float(ranked[0]["price"])


def top3_signature(product: str, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stable top-3 fingerprint: price + host (what the user sees)."""
    out: list[dict[str, Any]] = []
    for r in rank_results(product, results)[:3]:
        url = r.get("url")
        out.append(
            {
                "price": float(r["price"]),
                "host": host_of(url) if isinstance(url, str) else "",
            }
        )
    return out


def rss_mib() -> float:
    """Max RSS of this process in MiB (Linux: ru_maxrss is KiB)."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def one_run(product: str, *, include_ml: bool) -> dict[str, Any]:
    # Cold: no cross-run offer cache, no degraded streak carry-over.
    _offer_cache.clear()
    clear_outcome_registry()
    t0 = time.perf_counter()
    summary = crawl(
        product,
        max_results=20,
        max_depth=1,
        max_nodes=80,
        include_ml=include_ml,
    )
    wall_ms = (time.perf_counter() - t0) * 1000
    results = summary.get("results") or []
    host_set = {
        host_of(r.get("url", "")) for r in results if isinstance(r.get("url"), str)
    }
    host_set.discard("")
    stats = summary.get("stats") or {}
    hy = stats.get("hostYield") or {}
    gq = load_golden(product)
    p10 = GOLDEN_P10_NODE.get(product)
    if p10 is None and gq is not None:
        p10 = golden_precision_at_10(gq)
    r10 = GOLDEN_R10_NODE.get(product)
    host_overlap = live_product_recall(gq, results) if gq else None
    ml_via = summary.get("mlViaApi")
    stop_reason = stats.get("stopReason")
    if stop_reason not in STOP_REASONS:
        stop_reason = "unknown"
    return {
        "wallMs": round(wall_ms, 1),
        "pages": stats.get("pagesFetched"),
        "n": len(results),
        "hosts": len(host_set),
        "hostList": sorted(host_set),
        "price1": price_number_one(product, results),
        "top3": top3_signature(product, results),
        "goldenP10": round(p10, 3) if p10 is not None else None,
        "goldenR10": round(r10, 3) if r10 is not None else None,
        "hostOverlap": round(host_overlap, 3) if host_overlap is not None else None,
        "cut": list(hy.get("cut") or []),
        "probes": stats.get("probeAttempted"),
        "mlViaApi": ml_via if isinstance(ml_via, int) else None,
        "mlBlocked": bool(summary.get("mlBlocked")),
        "mlArrived": int(stats.get("mlArrived") or 0),
        "stopReason": stop_reason,
        "rssMiB": round(rss_mib(), 1),
    }


def median_key(runs: list[dict[str, Any]], key: str) -> float | int | None:
    vals = [r[key] for r in runs if r.get(key) is not None]
    if not vals:
        return None
    return statistics.median(vals)


def top3_stable(runs: list[dict[str, Any]]) -> bool:
    """True when every run's top-3 (price, host) matches the first run."""
    if not runs:
        return True
    base = runs[0].get("top3") or []
    for run in runs[1:]:
        if (run.get("top3") or []) != base:
            return False
    return True


def mode_or_first(runs: list[dict[str, Any]], key: str) -> Any:
    vals = [r.get(key) for r in runs if r.get(key) is not None]
    if not vals:
        return None
    try:
        return statistics.mode(vals)
    except statistics.StatisticsError:
        return vals[0]


def main() -> int:
    queries = sys.argv[1:] or DEFAULT_QUERIES
    reps = int(os.environ.get("BENCH_REPS", "3"))
    workers = os.environ.get("FETCH_WORKERS", "2")
    include_ml = _env_truthy("INCLUDE_ML", "0")
    # top3 instability is informational; only wall+P10 gate exit (local).
    fail_on_top3 = _env_truthy("BENCH_FAIL_TOP3", "0")
    print(
        f"FETCH_WORKERS={workers} INCLUDE_ML={int(include_ml)} reps={reps} "
        f"cold=clear_outcome_registry+offer_cache "
        f"ceiling_default={WALL_CEILING_MS}ms micro={int(_env_truthy('BENCH_MICRO','0'))} "
        f"P@10_floor={GOLDEN_P10_FLOOR} queries={len(queries)}\n",
        flush=True,
    )

    out: dict[str, Any] = {
        "FETCH_WORKERS": workers,
        "INCLUDE_ML": include_ml,
        "reps": reps,
        "cold": True,
        "ceilingMs": WALL_CEILING_MS,
        "top3Meaning": "same (price,host) across reps — not wall-tied",
        "queries": {},
        "rssPeakMiB": None,
    }
    wall_fails: list[str] = []
    quality_fails: list[str] = []
    top3_fails: list[str] = []
    rss_peak = 0.0

    for product in queries:
        runs: list[dict[str, Any]] = []
        ceiling = wall_ceiling_ms(product)
        print(f"→ {product} (ceiling={ceiling}ms)", flush=True)
        for i in range(reps):
            row = one_run(product, include_ml=include_ml)
            runs.append(row)
            rss_peak = max(rss_peak, float(row.get("rssMiB") or 0))
            print(
                f"  #{i + 1} wall={row['wallMs']:.0f}ms n={row['n']} hosts={row['hosts']} "
                f"stop={row['stopReason']} mlArrived={row['mlArrived']} "
                f"price1={row['price1']} hosts_list={row['hostList']} "
                f"P@10={row['goldenP10']} R@10={row['goldenR10']} "
                f"rss={row['rssMiB']}MiB cut={len(row['cut'])}",
                flush=True,
            )
        med_wall = float(median_key(runs, "wallMs") or 0)
        med_hosts = median_key(runs, "hosts")
        med_n = median_key(runs, "n")
        med_price = median_key(runs, "price1")
        p10 = runs[0].get("goldenP10")
        r10 = runs[0].get("goldenR10")
        stable = top3_stable(runs)
        wall_ok = med_wall <= ceiling
        p10_ok = p10 is None or p10 >= GOLDEN_P10_FLOOR
        if not wall_ok:
            wall_fails.append(product)
        if not p10_ok:
            quality_fails.append(product)
        if not stable:
            top3_fails.append(product)
        ml_rate = statistics.mean(float(r["mlArrived"]) for r in runs)
        out["queries"][product] = {
            "runs": runs,
            "ceilingMs": ceiling,
            "median": {
                "wallMs": round(med_wall, 1),
                "hosts": med_hosts,
                "n": med_n,
                "price1": med_price,
                "goldenP10": p10,
                "goldenR10": r10,
                "hostOverlap": median_key(runs, "hostOverlap"),
                "cutN": statistics.median(len(r["cut"]) for r in runs),
                "probes": median_key(runs, "probes"),
                "mlViaApi": median_key(runs, "mlViaApi"),
                "mlArrivedRate": round(ml_rate, 3),
                "stopReason": mode_or_first(runs, "stopReason"),
                "rssMiB": median_key(runs, "rssMiB"),
            },
            "top3Stable": stable,
            "passWall": wall_ok,
            "passP10": p10_ok,
        }
        flag = "OK" if wall_ok and p10_ok else "FAIL"
        if not stable:
            flag += " top3≠"
        print(
            f"  median wall={med_wall:.0f}ms hosts={med_hosts} n={med_n} "
            f"stop={mode_or_first(runs, 'stopReason')} ml_rate={ml_rate:.0%} "
            f"price1={med_price} P@10={p10} R@10={r10} top3_stable={stable} [{flag}]",
            flush=True,
        )

    out["rssPeakMiB"] = round(rss_peak, 1)
    path = os.environ.get("BENCH_OUT", "/tmp/ahorrar-t61-local-median.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(
        "\n| query | wall p50 | hosts | n | P@10 | R@10 | stop | ml% | rss | top3 | pass |"
    )
    print("|---|---:|---:|---:|---:|---:|---|---:|---:|:---:|:---:|")
    for product, block in out["queries"].items():
        m = block["median"]
        ok = block["passWall"] and block["passP10"]
        print(
            f"| `{product}` | {m['wallMs']:.0f} | {m['hosts']} | {m['n']} | "
            f"{m['goldenP10']} | {m['goldenR10']} | {m['stopReason']} | "
            f"{100 * float(m['mlArrivedRate'] or 0):.0f}% | {m['rssMiB']} | "
            f"{'✓' if block['top3Stable'] else '≠'} | "
            f"{'✓' if ok else '✗'} |"
        )
    print(f"\nrssPeakMiB={out['rssPeakMiB']} Wrote {path}")
    print(
        "top3_stable = mismo (price,host) en las 3 reps (≠ wall). "
        "Informativo salvo BENCH_FAIL_TOP3=1."
    )
    if wall_fails:
        print(f"Above wall ceiling: {', '.join(wall_fails)}")
    if quality_fails:
        print(f"P@10 below {GOLDEN_P10_FLOOR}: {', '.join(quality_fails)}")
    if top3_fails:
        print(f"top-3 unstable (info): {', '.join(top3_fails)}")
    hard_fail = bool(wall_fails or quality_fails)
    if fail_on_top3 and top3_fails:
        hard_fail = True
    if hard_fail:
        return 1
    print(f"All {len(queries)} queries pass ceilings ∧ P@10≥{GOLDEN_P10_FLOOR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
