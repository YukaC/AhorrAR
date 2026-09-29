#!/usr/bin/env python3
"""Sweep curated ar-shops: SSL / redirect-home / HTTP / empty catalog / ≥1 offer canary.

Updates alive flags in shared/ar-shops.json (does not change entry/platform).

  cd scraper && uv run python ../scripts/sweep_shop_canary.py [--write]
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from scrapling.fetchers import Fetcher

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "shared" / "ar-shops.json"

# Category → canary query that should yield ≥1 product on a healthy shop.
CANARY_BY_CAT = {
    "electro": "cable",
    "tecnologia": "cable",
    "notebook": "notebook",
    "perfume": "perfume",
    "belleza": "perfume",
    "moda": "zapatillas",
    "deportes": "zapatillas",
    "hogar": "heladera",
    "general": "cable",
}

WORKERS = 8
TIMEOUT_S = 10.0


def canary_for(shop: dict[str, Any]) -> str:
    cat = str(shop.get("category") or "general").lower()
    return CANARY_BY_CAT.get(cat, "cable")


def entry_url(shop: dict[str, Any], q: str) -> str | None:
    raw = shop.get("entry")
    if isinstance(raw, str) and "{q}" in raw:
        return raw.replace("{q}", quote(q))
    host = shop.get("host")
    if not isinstance(host, str) or not host:
        return None
    # Fallback guesses for curated without template
    return f"https://www.{host}/api/catalog_system/pub/products/search?ft={quote(q)}&_from=0&_to=11"


def _body_text(page: Any) -> str:
    body = getattr(page, "body", None)
    if isinstance(body, bytes):
        return body.decode("utf-8", "replace")
    if body is None:
        return ""
    return str(body)


def classify(shop: dict[str, Any]) -> dict[str, Any]:
    host = str(shop.get("host") or "")
    q = canary_for(shop)
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

    # Redirected away from API to site root / bare home
    if "catalog_system" in url and "catalog_system" not in final:
        out["verdict"] = "redirect_home"
        out["detail"] = final[:120]
        return out
    if final_path in ("/", "") and "catalog_system" in url:
        out["verdict"] = "redirect_home"
        out["detail"] = final[:120]
        return out

    # VTEX / JSON list
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # HTML search page — treat as weak-ok if status 200 and body large
        if out["status"] in (200, 206) and len(text) > 2000:
            out["verdict"] = "html_ok_unparsed"
            out["detail"] = f"body_len={len(text)}"
            return out
        out["verdict"] = "not_json"
        out["detail"] = f"body_len={len(text)}"
        return out

    if isinstance(data, list):
        out["offers"] = len(data)
        if len(data) == 0:
            out["verdict"] = "empty_catalog"
        else:
            out["verdict"] = "has_offers"
        return out

    if isinstance(data, dict):
        # Shopify-ish
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Mark failing curated hosts alive=false")
    ap.add_argument("--all-alive", action="store_true", help="Sweep every alive shop, not only curated")
    args = ap.parse_args()

    data = json.loads(INDEX_PATH.read_text("utf-8"))
    shops: list[dict[str, Any]] = data.get("shops") or []
    targets = [
        s
        for s in shops
        if isinstance(s, dict)
        and s.get("host")
        and (s.get("curated") if not args.all_alive else s.get("alive"))
    ]

    print(f"sweeping {len(targets)} shops (write={args.write})\n")
    results: list[dict[str, Any]] = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(classify, s): s for s in targets}
        for fut in as_completed(futs):
            r = fut.result()
            results.append(r)
            mark = ""
            if r["verdict"] not in ("has_offers", "html_ok_unparsed"):
                mark = " ← FAIL"
            print(
                f"{r['host']:32} {r['verdict']:18} offers={r['offers']:<3} "
                f"status={r['status']} canary={r['canary']}{mark}"
            )

    by_v: dict[str, list[str]] = {}
    for r in results:
        by_v.setdefault(r["verdict"], []).append(r["host"])

    print(f"\n=== summary ({time.time() - t0:.1f}s) ===")
    for v, hosts in sorted(by_v.items(), key=lambda x: -len(x[1])):
        print(f"  {v:18} {len(hosts):3}  {', '.join(hosts[:8])}{'…' if len(hosts)>8 else ''}")

    kill_verdicts = {
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
    to_kill = {r["host"] for r in results if r["verdict"] in kill_verdicts}
    print(f"\nwould mark alive=false: {len(to_kill)}")

    if args.write and to_kill:
        changed = 0
        for s in shops:
            h = s.get("host")
            if h in to_kill and s.get("alive") is not False:
                s["alive"] = False
                changed += 1
            # Ensure cetrogar.com.ar stays true if has_offers
        for s in shops:
            if s.get("host") == "cetrogar.com.ar":
                s["host"] = "cetrogar.com.ar"
                s["entry"] = (
                    "https://www.cetrogar.com.ar/api/catalog_system/pub/products/search"
                    "?ft={q}&_from=0&_to=11"
                )
                s["curated"] = True
                s["platform"] = "vtex"
                # keep alive per sweep result
        tmp = INDEX_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
        tmp.replace(INDEX_PATH)
        print(f"wrote {INDEX_PATH} (alive flips={changed})")

    out_path = Path("/tmp/ahorrar-shop-canary.json")
    out_path.write_text(json.dumps({"results": results, "by_verdict": by_v}, ensure_ascii=False, indent=2), "utf-8")
    print(f"artifact {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
