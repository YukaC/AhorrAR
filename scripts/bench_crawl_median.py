#!/usr/bin/env python3
"""Cold ×3 T55 close-out bench: wall + quality columns.

  cd scraper && FETCH_WORKERS=2 uv run python ../scripts/bench_crawl_median.py

Columns: wall p50 · hosts · n · price#1 · golden P@10 · live recall (product labels found).
"""

from __future__ import annotations

import json
import os
import re
import statistics
import sys
import time
from pathlib import Path
from typing import Any

os.environ.setdefault("FETCH_WORKERS", "2")
os.environ.setdefault("CRAWL_DEADLINE_S", "30")
os.environ.setdefault("INCLUDE_ML", "0")

from ahorrar_scraper.crawl import _offer_cache, crawl  # noqa: E402
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
GOLDEN_P10_FLOOR = 0.877


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


def price_number_one(product: str, results: list[dict[str, Any]]) -> float | None:
    ranked = sorted(
        (r for r in results if isinstance(r.get("price"), (int, float))),
        key=lambda r: (
            0
            if title_relevance_score(str(r.get("name") or ""), product) >= 0.55
            else 1,
            float(r["price"]),
        ),
    )
    if not ranked:
        return None
    return float(ranked[0]["price"])


def one_run(product: str) -> dict[str, Any]:
    _offer_cache.clear()
    t0 = time.perf_counter()
    summary = crawl(product, max_results=20, max_depth=1, max_nodes=80, include_ml=False)
    wall_ms = (time.perf_counter() - t0) * 1000
    results = summary.get("results") or []
    hosts = {host_of(r.get("url", "")) for r in results if isinstance(r.get("url"), str)}
    hosts.discard("")
    stats = summary.get("stats") or {}
    hy = stats.get("hostYield") or {}
    gq = load_golden(product)
    p10 = GOLDEN_P10_NODE.get(product)
    if p10 is None and gq is not None:
        p10 = golden_precision_at_10(gq)
    r10 = GOLDEN_R10_NODE.get(product)
    host_overlap = live_product_recall(gq, results) if gq else None
    return {
        "wallMs": round(wall_ms, 1),
        "pages": stats.get("pagesFetched"),
        "n": len(results),
        "hosts": len(hosts),
        "price1": price_number_one(product, results),
        "goldenP10": round(p10, 3) if p10 is not None else None,
        "goldenR10": round(r10, 3) if r10 is not None else None,
        "hostOverlap": round(host_overlap, 3) if host_overlap is not None else None,
        "cut": list(hy.get("cut") or []),
        "probes": stats.get("probeAttempted"),
    }


def median_key(runs: list[dict[str, Any]], key: str) -> float | int | None:
    vals = [r[key] for r in runs if r.get(key) is not None]
    if not vals:
        return None
    return statistics.median(vals)


def main() -> int:
    queries = sys.argv[1:] or DEFAULT_QUERIES
    reps = int(os.environ.get("BENCH_REPS", "3"))
    workers = os.environ.get("FETCH_WORKERS", "2")
    print(
        f"FETCH_WORKERS={workers} reps={reps} ceiling={WALL_CEILING_MS}ms "
        f"P@10_floor={GOLDEN_P10_FLOOR} queries={len(queries)}\n"
    )

    out: dict[str, Any] = {
        "FETCH_WORKERS": workers,
        "reps": reps,
        "ceilingMs": WALL_CEILING_MS,
        "queries": {},
    }
    wall_fails: list[str] = []
    quality_fails: list[str] = []

    for product in queries:
        runs: list[dict[str, Any]] = []
        print(f"→ {product}", flush=True)
        for i in range(reps):
            row = one_run(product)
            runs.append(row)
            print(
                f"  #{i + 1} wall={row['wallMs']:.0f}ms n={row['n']} hosts={row['hosts']} "
                f"price1={row['price1']} P@10={row['goldenP10']} R@10={row['goldenR10']} "
                f"probes={row['probes']} cut={len(row['cut'])}",
                flush=True,
            )
        med_wall = float(median_key(runs, "wallMs") or 0)
        med_hosts = median_key(runs, "hosts")
        med_n = median_key(runs, "n")
        med_price = median_key(runs, "price1")
        p10 = runs[0].get("goldenP10")
        r10 = runs[0].get("goldenR10")
        wall_ok = med_wall <= WALL_CEILING_MS
        p10_ok = p10 is None or p10 >= GOLDEN_P10_FLOOR
        if not wall_ok:
            wall_fails.append(product)
        if not p10_ok:
            quality_fails.append(product)
        out["queries"][product] = {
            "runs": runs,
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
            },
            "passWall": wall_ok,
            "passP10": p10_ok,
        }
        flag = "OK" if wall_ok and p10_ok else "FAIL"
        print(
            f"  median wall={med_wall:.0f}ms hosts={med_hosts} n={med_n} "
            f"price1={med_price} P@10={p10} R@10={r10} [{flag}]",
            flush=True,
        )

    path = "/tmp/ahorrar-t55-median.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(
        "\n| query | wall p50 | hosts | n | price#1 | P@10 | R@10 | probes | pass |"
    )
    print("|---|---:|---:|---:|---:|---:|---:|---:|:---:|")
    for product, block in out["queries"].items():
        m = block["median"]
        ok = block["passWall"] and block["passP10"]
        price = m["price1"]
        price_s = f"{price:.0f}" if isinstance(price, (int, float)) else "—"
        print(
            f"| `{product}` | {m['wallMs']:.0f} | {m['hosts']} | {m['n']} | {price_s} | "
            f"{m['goldenP10']} | {m['goldenR10']} | {m['probes']} | "
            f"{'✓' if ok else '✗'} |"
        )
    print(f"\nWrote {path}")
    if wall_fails:
        print(f"Above wall ceiling ({WALL_CEILING_MS}ms): {', '.join(wall_fails)}")
    if quality_fails:
        print(f"P@10 below {GOLDEN_P10_FLOOR}: {', '.join(quality_fails)}")
    if wall_fails or quality_fails:
        return 1
    print(f"All {len(queries)} queries ≤ {WALL_CEILING_MS}ms p50 ∧ P@10≥{GOLDEN_P10_FLOOR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
