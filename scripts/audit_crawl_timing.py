#!/usr/bin/env python3
"""Crawl timing breakdown by fetch kind + host (latency bisect helper).

  FETCH_WORKERS=2 uv run python ../scripts/audit_crawl_timing.py 'ryzen 5 5600' 'perfume bensimon' 'iphone 15'
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict
from typing import Any

# Must set before crawl imports resolve workers at call time (fetch_workers reads env live).
os.environ.setdefault("FETCH_WORKERS", "2")
os.environ.setdefault("CRAWL_DEADLINE_S", "30")
os.environ.setdefault("INCLUDE_ML", "0")

from ahorrar_scraper.crawl import PageFetch, _FetchPool, _fetch_kind, crawl  # noqa: E402
from ahorrar_scraper.seeds import host_of  # noqa: E402


def main() -> int:
    queries = sys.argv[1:] or ["ryzen 5 5600", "perfume bensimon", "iphone 15", "smart tv 55"]
    workers = os.environ.get("FETCH_WORKERS", "2")
    print(f"FETCH_WORKERS={workers} CRAWL_DEADLINE_S={os.environ.get('CRAWL_DEADLINE_S', '30')}\n")

    original_fetch = _FetchPool._fetch
    original_probe = _FetchPool._probe_one

    records: list[dict[str, Any]] = []

    def timed_fetch(self: Any, url: str, session: Any) -> PageFetch:
        kind = _fetch_kind(url)
        host = host_of(url) or "unknown"
        t0 = time.perf_counter()
        ok = False
        try:
            out = original_fetch(self, url, session)
            ok = out.ok
            return out
        finally:
            ms = (time.perf_counter() - t0) * 1000
            records.append(
                {
                    "phase": "fetch",
                    "kind": kind,
                    "host": host,
                    "ms": ms,
                    "ok": ok,
                    "url": url[:100],
                }
            )

    def timed_probe(self: Any, url: str, session: Any) -> bool:
        host = host_of(url) or "unknown"
        t0 = time.perf_counter()
        alive = False
        try:
            alive = original_probe(self, url, session)
            return alive
        finally:
            ms = (time.perf_counter() - t0) * 1000
            records.append(
                {
                    "phase": "probe",
                    "kind": "probe",
                    "host": host,
                    "ms": ms,
                    "ok": alive,
                    "url": url[:100],
                }
            )

    _FetchPool._fetch = timed_fetch  # type: ignore[method-assign]
    _FetchPool._probe_one = timed_probe  # type: ignore[method-assign]

    summaries = []
    for product in queries:
        records.clear()
        print(f"→ {product} ...", flush=True)
        t0 = time.perf_counter()
        summary = crawl(product, max_results=20, max_depth=1, max_nodes=80, include_ml=False)
        wall = (time.perf_counter() - t0) * 1000
        results = summary.get("results") or []
        hosts = {host_of(r.get("url", "")) for r in results if isinstance(r.get("url"), str)}
        hosts.discard("")
        host_yield = (summary.get("stats") or {}).get("hostYield") or {}

        by_kind: dict[str, list[float]] = defaultdict(list)
        by_host: dict[str, list[float]] = defaultdict(list)
        probe_ms = 0.0
        for r in records:
            by_kind[r["kind"]].append(r["ms"])
            by_host[r["host"]].append(r["ms"])
            if r["phase"] == "probe":
                probe_ms += r["ms"]

        def agg(xs: list[float]) -> dict[str, float | int]:
            if not xs:
                return {"n": 0, "sum_ms": 0, "p50": 0, "max": 0}
            s = sorted(xs)
            return {
                "n": len(s),
                "sum_ms": round(sum(s), 1),
                "p50": round(s[len(s) // 2], 1),
                "max": round(s[-1], 1),
            }

        row = {
            "query": product,
            "wallMs": round(wall, 1),
            "elapsedMs": summary.get("stats", {}).get("elapsedMs"),
            "pagesFetched": summary.get("stats", {}).get("pagesFetched"),
            "n": len(results),
            "hosts": len(hosts),
            "hostList": sorted(hosts),
            "byKind": {k: agg(v) for k, v in sorted(by_kind.items())},
            "probeSumMs": round(probe_ms, 1),
            "hostYieldCut": host_yield.get("cut", []),
            "hostYieldByHost": host_yield.get("byHost", {}),
            "topHostsBySumMs": sorted(
                ((h, round(sum(v), 1), len(v)) for h, v in by_host.items()),
                key=lambda x: -x[1],
            )[:8],
        }
        summaries.append(row)
        print(
            f"  wall={row['wallMs']:.0f}ms pages={row['pagesFetched']} n={row['n']} hosts={row['hosts']} "
            f"cut={len(row['hostYieldCut'])} probe={row['probeSumMs']:.0f}ms "
            f"kinds={ {k: v['n'] for k, v in row['byKind'].items()} }"
        )
        for h, sm, n in row["topHostsBySumMs"][:5]:
            print(f"    host {h}: {sm:.0f}ms across {n} ops")

    path = "/tmp/ahorrar-crawl-timing.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"FETCH_WORKERS": workers, "queries": summaries}, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {path}")

    print("\n| query | wallMs | pages | n | hosts | cut | api_n | html_n | hub_n | probe_ms |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in summaries:
        bk = r["byKind"]
        print(
            f"| `{r['query']}` | {r['wallMs']:.0f} | {r['pagesFetched']} | {r['n']} | {r['hosts']} | "
            f"{len(r['hostYieldCut'])} | "
            f"{bk.get('api', {}).get('n', 0)} | {bk.get('html', {}).get('n', 0)} | "
            f"{bk.get('hub', {}).get('n', 0)} | {r['probeSumMs']:.0f} |"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
