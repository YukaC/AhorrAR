#!/usr/bin/env python3
"""Sweep curated ar-shops: SSL / redirect-home / HTTP / empty catalog / ≥1 offer canary.

Category canary uses ≥2 queries (Fase 3 / §T52). A single fail does NOT flip
alive=false: --write with --state-dir requires TWO moments of failure (degraded).
Mass-fail guard: if fail rate ≥ MASS_FAIL_RATIO in one moment, skip writes
(assume network blip).

  cd scraper && uv run python ../scripts/sweep_shop_canary.py [--write] [--state-dir DIR]
  See also: scripts/reprobe-ar-shops.sh
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from scrapling.fetchers import Fetcher

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "shared" / "ar-shops.json"

# Category → ≥2 canary queries (≥1 product expected on a healthy shop).
CANARY_QUERIES_BY_CAT: dict[str, list[str]] = {
    "electro": ["cable", "heladera"],
    "tecnologia": ["cable", "notebook"],
    "notebook": ["notebook", "cable"],
    "gaming": ["notebook", "mouse"],
    "perfume": ["perfume", "colonia"],
    "perfumeria": ["perfume", "colonia"],
    "belleza": ["perfume", "colonia"],
    "moda": ["zapatillas", "remera"],
    "deportes": ["zapatillas", "remera"],
    "bazar": ["cacerola", "cubiertos"],
    "hogar": ["heladera", "cacerola"],
    "general": ["cable", "notebook"],
}

WORKERS = 8
TIMEOUT_S = 10.0
MASS_FAIL_RATIO = 0.55  # skip index writes if ≥55% of targets fail in one moment


def canaries_for(shop: dict[str, Any]) -> list[str]:
    cat = str(shop.get("category") or "general").lower()
    return list(CANARY_QUERIES_BY_CAT.get(cat, ["cable", "notebook"]))


def entry_url(shop: dict[str, Any], q: str) -> str | None:
    raw = shop.get("entry")
    if isinstance(raw, str) and "{q}" in raw:
        return raw.replace("{q}", quote(q))
    host = shop.get("host")
    if not isinstance(host, str) or not host:
        return None
    return (
        f"https://www.{host}/api/catalog_system/pub/products/search"
        f"?ft={quote(q)}&_from=0&_to=11"
    )


def _body_text(page: Any) -> str:
    body = getattr(page, "body", None)
    if isinstance(body, bytes):
        return body.decode("utf-8", "replace")
    if body is None:
        return ""
    return str(body)


def _classify_url(shop: dict[str, Any], q: str) -> dict[str, Any]:
    host = str(shop.get("host") or "")
    url = entry_url(shop, q)
    out: dict[str, Any] = {
        "host": host,
        "canary": q,
        "url": url,
        "verdict": "skip",
        "status": None,
        "offers": 0,
        "detail": "",
    }
    if not url:
        out["verdict"] = "no_entry"
        out["detail"] = "no entry template"
        return out

    try:
        page = Fetcher.get(
            url,
            stealthy_headers=True,
            impersonate="chrome",
            timeout=TIMEOUT_S,
            retries=0,
            retry_delay=0,
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "ssl" in msg or "certificate" in msg or "curl: (60)" in msg:
            out["verdict"] = "ssl_error"
        elif any(
            m in msg
            for m in (
                "resolve",
                "dns",
                "timed out",
                "timeout",
                "connection refused",
                "no route",
            )
        ):
            out["verdict"] = "dead_net"
        else:
            out["verdict"] = "fetch_error"
        out["detail"] = str(exc)[:160]
        return out

    if page is None:
        out["verdict"] = "dead_net"
        out["detail"] = "null page"
        return out

    status = getattr(page, "status", None) or getattr(page, "status_code", None)
    out["status"] = int(status) if isinstance(status, int) else None
    final = str(getattr(page, "url", None) or url)
    text = _body_text(page)
    final_path = urlparse(final).path or "/"

    if out["status"] in (403, 404, 410, 451):
        out["verdict"] = f"http_{out['status']}"
        return out
    if out["status"] is not None and out["status"] >= 500:
        out["verdict"] = "http_5xx"
        return out

    if "catalog_system" in url and "catalog_system" not in final:
        out["verdict"] = "redirect_home"
        out["detail"] = final[:120]
        return out
    if final_path in ("/", "") and "catalog_system" in url:
        out["verdict"] = "redirect_home"
        out["detail"] = final[:120]
        return out

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        if out["status"] in (200, 206) and len(text) > 2000:
            out["verdict"] = "html_ok_unparsed"
            out["detail"] = f"body_len={len(text)}"
            return out
        out["verdict"] = "not_json"
        out["detail"] = f"body_len={len(text)}"
        return out

    if isinstance(data, list):
        out["offers"] = len(data)
        out["verdict"] = "has_offers" if data else "empty_catalog"
        return out

    if isinstance(data, dict):
        products = None
        resources = data.get("resources")
        if isinstance(resources, dict):
            block = resources.get("results") if isinstance(resources.get("results"), dict) else resources
            if isinstance(block, dict) and isinstance(block.get("products"), list):
                products = block["products"]
        if products is None and isinstance(data.get("products"), list):
            products = data["products"]
        if products is not None:
            out["offers"] = len(products)
            out["verdict"] = "has_offers" if products else "empty_catalog"
            return out
        out["verdict"] = "json_object"
        out["detail"] = ",".join(list(data.keys())[:6])
        return out

    out["verdict"] = "json_other"
    return out


OK_VERDICTS = frozenset({"has_offers", "html_ok_unparsed"})
KILL_VERDICTS = frozenset(
    {
        "ssl_error",
        "dead_net",
        "fetch_error",
        "http_403",
        "http_404",
        "http_410",
        "http_451",
        "redirect_home",
        "empty_catalog",
        "not_json",
        "no_entry",
    }
)


def classify(shop: dict[str, Any]) -> dict[str, Any]:
    """Run ≥2 canaries; host is OK if ANY query yields offers/html_ok."""
    host = str(shop.get("host") or "")
    cat = str(shop.get("category") or "general")
    queries = canaries_for(shop)
    per_q: list[dict[str, Any]] = [_classify_url(shop, q) for q in queries]
    ok_rows = [r for r in per_q if r["verdict"] in OK_VERDICTS]
    best = ok_rows[0] if ok_rows else per_q[0]
    return {
        "host": host,
        "category": cat,
        "canary": "+".join(queries),
        "canaries": per_q,
        "verdict": best["verdict"] if ok_rows else best["verdict"],
        "status": best.get("status"),
        "offers": max((r.get("offers") or 0) for r in per_q),
        "detail": "" if ok_rows else (best.get("detail") or ""),
        "ok": bool(ok_rows),
    }


def _load_fail_streaks(state_dir: Path) -> dict[str, int]:
    path = state_dir / "fail-streaks.json"
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for k, v in raw.items():
        if isinstance(k, str) and isinstance(v, int) and v >= 0:
            out[k] = v
    return out


def _save_fail_streaks(state_dir: Path, streaks: dict[str, int]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    path = state_dir / "fail-streaks.json"
    path.write_text(json.dumps(streaks, ensure_ascii=False, indent=2) + "\n", "utf-8")


def _alive_by_category(shops: list[dict[str, Any]]) -> dict[str, list[str]]:
    by: dict[str, list[str]] = {}
    for s in shops:
        if not s.get("alive"):
            continue
        cat = str(s.get("category") or "?")
        host = str(s.get("host") or "")
        if host:
            by.setdefault(cat, []).append(host)
    return by


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--write",
        action="store_true",
        help="Flip alive=false only after 2 consecutive fail moments (needs --state-dir)",
    )
    ap.add_argument(
        "--state-dir",
        type=Path,
        default=Path("/tmp/ahorrar-canary-state"),
        help="Persist fail streaks across moments (default /tmp/ahorrar-canary-state)",
    )
    ap.add_argument("--all-alive", action="store_true", help="Sweep every alive shop, not only curated")
    ap.add_argument(
        "--categories",
        default="",
        help="Comma-separated category filter (e.g. electro,bazar). Empty = all",
    )
    ap.add_argument(
        "--moment",
        default="",
        help="Label for this moment (stored in artifact)",
    )
    ap.add_argument(
        "--force-kill-once",
        action="store_true",
        help="Legacy: mark fail hosts alive=false in one pass (bypass degraded). Prefer default.",
    )
    args = ap.parse_args()

    data = json.loads(INDEX_PATH.read_text("utf-8"))
    shops: list[dict[str, Any]] = data.get("shops") or []
    cat_filter = {c.strip().lower() for c in args.categories.split(",") if c.strip()}
    targets = [
        s
        for s in shops
        if isinstance(s, dict)
        and s.get("host")
        and (s.get("curated") if not args.all_alive else s.get("alive"))
        and (not cat_filter or str(s.get("category") or "").lower() in cat_filter)
    ]

    moment = args.moment or time.strftime("%Y%m%d-%H%M%S")
    print(f"sweeping {len(targets)} shops moment={moment} write={args.write}\n")
    results: list[dict[str, Any]] = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(classify, s): s for s in targets}
        for fut in as_completed(futs):
            r = fut.result()
            results.append(r)
            mark = "" if r["ok"] else " ← FAIL"
            print(
                f"{r['host']:32} {r['verdict']:18} offers={r['offers']:<3} "
                f"status={r['status']} canary={r['canary']}{mark}"
            )

    by_v: dict[str, list[str]] = {}
    for r in results:
        by_v.setdefault(r["verdict"], []).append(r["host"])

    n_fail = sum(1 for r in results if not r["ok"])
    fail_ratio = (n_fail / len(results)) if results else 0.0
    mass_fail = fail_ratio >= MASS_FAIL_RATIO

    print(f"\n=== summary ({time.time() - t0:.1f}s) moment={moment} ===")
    for v, hosts in sorted(by_v.items(), key=lambda x: -len(x[1])):
        print(f"  {v:18} {len(hosts):3}  {', '.join(hosts[:8])}{'…' if len(hosts) > 8 else ''}")
    print(f"  fail_ratio={fail_ratio:.2f} mass_fail={mass_fail} (guard≥{MASS_FAIL_RATIO})")

    failing_now = {r["host"] for r in results if not r["ok"] and r["verdict"] in KILL_VERDICTS}
    ok_now = {r["host"] for r in results if r["ok"]}

    streaks = _load_fail_streaks(args.state_dir)
    if mass_fail:
        print("MASS FAIL guard: not updating fail streaks / not writing index")
    else:
        for h in ok_now:
            streaks[h] = 0
        for h in failing_now:
            streaks[h] = streaks.get(h, 0) + 1
        _save_fail_streaks(args.state_dir, streaks)

    to_kill = {
        h
        for h in failing_now
        if (args.force_kill_once and not mass_fail) or (streaks.get(h, 0) >= 2 and not mass_fail)
    }
    print(f"\nwould mark alive=false (streak≥2 or force): {len(to_kill)} → {sorted(to_kill)[:12]}")

    if args.write and to_kill and not mass_fail:
        changed = 0
        for s in shops:
            h = s.get("host")
            if h in to_kill and s.get("alive") is not False:
                s["alive"] = False
                changed += 1
        tmp = INDEX_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
        tmp.replace(INDEX_PATH)
        print(f"wrote {INDEX_PATH} (alive flips={changed})")
    elif args.write and mass_fail:
        print("skipped --write due to mass-fail guard")

    alive_map = _alive_by_category(shops)
    print("\n=== alive hosts by category (index after pass) ===")
    shortfalls: list[str] = []
    for cat, hosts in sorted(alive_map.items()):
        flag = "OK" if len(hosts) >= 4 else "SHORT"
        if len(hosts) < 4:
            shortfalls.append(f"{cat}:{len(hosts)}")
        print(f"  {cat:12} n={len(hosts):2} [{flag}] {', '.join(hosts[:6])}{'…' if len(hosts) > 6 else ''}")
    if shortfalls:
        print(f"SHORTFALL (<4 alive): {', '.join(shortfalls)}")
    else:
        print("all categories ≥4 alive hosts")

    artifact = {
        "moment": moment,
        "fail_ratio": fail_ratio,
        "mass_fail": mass_fail,
        "to_kill": sorted(to_kill),
        "streaks": streaks,
        "alive_by_category": alive_map,
        "shortfalls": shortfalls,
        "results": results,
        "by_verdict": by_v,
    }
    out_path = Path(f"/tmp/ahorrar-shop-canary-{moment}.json")
    out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), "utf-8")
    print(f"artifact {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
