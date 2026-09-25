#!/usr/bin/env python3
"""Offline probe: fingerprint AR shops and fill platform / entry / alive.

Uses Scrapling Fetcher (same TLS stack as the crawler). Marks alive=false only
on DNS failure or total timeout — not on HTTP 403/5xx (site may still exist).

Writes shared/ar-shops.json atomically (tmp + replace).
"""

from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import quote

from scrapling.fetchers import Fetcher

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "shared" / "ar-shops.json"
PROBE_Q = "notebook"
HOME_TIMEOUT_S = 6.0
ENTRY_TIMEOUT_S = 6.0
WORKERS = 6
INDEX_VERSION = 3

Platform = str  # vtex|shopify|woo|tiendanube|oscommerce|unknown


def _fetch(url: str, timeout: float) -> tuple[int | None, str | None, str | None]:
    """Return (status, body, error_kind). error_kind is 'dead' | 'other' | None."""
    try:
        page = Fetcher.get(
            url,
            stealthy_headers=True,
            impersonate="chrome",
            timeout=timeout,
            retries=0,
            retry_delay=0,
        )
        if page is None:
            return None, None, "dead"
        status = getattr(page, "status", None) or getattr(page, "status_code", None)
        body = page.body
        if isinstance(body, bytes):
            text = body.decode("utf-8", errors="replace")
        elif body is None:
            text = ""
        else:
            text = str(body)
        return (int(status) if isinstance(status, int) else 200), text, None
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        # DNS / connect / timeout → dead. Everything else (incl. unexpected) → alive-unknown.
        dead_markers = (
            "name or service not known",
            "nodename nor servname",
            "getaddrinfo failed",
            "failed to resolve",
            "dns",
            "timed out",
            "timeout",
            "connection refused",
            "network is unreachable",
            "no route to host",
            "name resolution",
            "could not resolve",
        )
        if any(m in msg for m in dead_markers):
            return None, None, "dead"
        return None, None, "other"


def fingerprint_platform(body: str) -> Platform:
    lower = body.lower()
    if "cdn.shopify.com" in lower or "shopify.theme" in lower or "shopify-section" in lower:
        return "shopify"
    if "vtexassets" in lower or "vteximg" in lower or "vtex.com" in lower or "vtexid" in lower:
        return "vtex"
    if "tiendanube" in lower or "nuvemshop" in lower or "cdn.tnwstatic" in lower:
        return "tiendanube"
    if "woocommerce" in lower or "wp-json/wc" in lower or "/wp-content/" in lower:
        return "woo"
    if "enhancedclick(" in lower:
        return "oscommerce"
    return "unknown"


def platform_from_entry(entry: str | None) -> Platform | None:
    if not isinstance(entry, str):
        return None
    if "catalog_system/pub/products/search" in entry:
        return "vtex"
    if "wp-json/wc/store" in entry:
        return "woo"
    if "suggest.json" in entry or "/products.json" in entry:
        return "shopify"
    if "products_search" in entry:
        return "tiendanube"
    if "resultado-busqueda" in entry:
        return "oscommerce"
    return None


def entry_candidates(host: str, platform: Platform) -> list[tuple[Platform, str]]:
    """Ordered (platform, template) candidates. Templates use {q}."""
    q = "{q}"
    base = f"https://www.{host}"
    vtex = f"{base}/api/catalog_system/pub/products/search?ft={q}&_from=0&_to=11"
    woo = f"{base}/wp-json/wc/store/v1/products?search={q}&per_page=12"
    shopify_suggest = f"{base}/search/suggest.json?q={q}&resources[type]=product"
    shopify_products = f"{base}/products.json?limit=12"
    tienda = f"{base}/products_search/?q={q}"
    venex = f"{base}/resultado-busqueda.htm?keywords={q}"

    by_platform: dict[str, list[tuple[Platform, str]]] = {
        "vtex": [("vtex", vtex)],
        "woo": [("woo", woo)],
        "shopify": [("shopify", shopify_suggest), ("shopify", shopify_products)],
        "tiendanube": [("tiendanube", tienda)],
        "oscommerce": [("oscommerce", venex)],
        "unknown": [
            ("vtex", vtex),
            ("woo", woo),
            ("shopify", shopify_suggest),
            ("shopify", shopify_products),
            ("tiendanube", tienda),
            ("oscommerce", venex),
        ],
    }
    primary = by_platform.get(platform, by_platform["unknown"])
    # After platform-specific, try the rest once (dedupe by template).
    seen = {t for _, t in primary}
    rest: list[tuple[Platform, str]] = []
    for plat, tmpl in by_platform["unknown"]:
        if tmpl not in seen:
            rest.append((plat, tmpl))
            seen.add(tmpl)
    return primary + rest


def _json_is_product_endpoint(url: str, body: str) -> bool:
    """True when body looks like a product search endpoint (may be empty)."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        if "enhancedClick(" in body and '"price"' in body:
            return True
        # HTML search pages are not useful entry templates for JSON parsers.
        return False

    if isinstance(data, list):
        # VTEX catalog / Woo store: empty list still means the endpoint works.
        if len(data) == 0:
            return "catalog_system" in url or "wp-json/wc" in url
        first = data[0]
        return isinstance(first, dict) and (
            "productName" in first or "name" in first or "permalink" in first or "items" in first
        )

    if not isinstance(data, dict):
        return False

    if "products" in data and isinstance(data["products"], list):
        return True  # Shopify products.json (empty ok)

    resources = data.get("resources")
    if isinstance(resources, dict):
        results = resources.get("results")
        if isinstance(results, dict) and "products" in results:
            return True
        if "products" in resources:
            return True

    for key in ("products", "results", "items"):
        if key in data and isinstance(data[key], list):
            return True
    return False


def _json_has_products(url: str, body: str) -> bool:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        if "enhancedClick(" in body and '"price"' in body:
            return True
        return False

    if isinstance(data, list) and len(data) >= 1:
        first = data[0]
        if isinstance(first, dict) and (
            "productName" in first or "name" in first or "permalink" in first
        ):
            return True
        return False

    if not isinstance(data, dict):
        return False

    if isinstance(data.get("products"), list) and len(data["products"]) >= 1:
        return True

    resources = data.get("resources")
    if isinstance(resources, dict):
        results = resources.get("results")
        if isinstance(results, dict):
            products = results.get("products")
            if isinstance(products, list) and len(products) >= 1:
                return True
        products = resources.get("products")
        if isinstance(products, list) and len(products) >= 1:
            return True

    for key in ("products", "results", "items"):
        val = data.get(key)
        if isinstance(val, list) and len(val) >= 1 and isinstance(val[0], dict):
            return True
    return False


def probe_entry(template: str, *, require_products: bool = True) -> bool:
    url = template.replace("{q}", quote(PROBE_Q))
    status, body, err = _fetch(url, ENTRY_TIMEOUT_S)
    if err or body is None:
        return False
    if isinstance(status, int) and status >= 400:
        return False
    if require_products:
        return _json_has_products(url, body)
    return _json_is_product_endpoint(url, body)


def probe_shop(shop: dict[str, Any]) -> dict[str, Any]:
    host = str(shop.get("host", "")).lower()
    out = dict(shop)
    home = f"https://www.{host}/"
    status, body, err = _fetch(home, HOME_TIMEOUT_S)

    if err == "dead":
        out["alive"] = False
        out.setdefault("platform", "unknown")
        # Keep existing entry for documentation; seeds skip alive=false.
        print(f"  DEAD  {host}", flush=True)
        return out

    out["alive"] = True
    platform: Platform = "unknown"
    if body:
        platform = fingerprint_platform(body)
    from_entry = platform_from_entry(shop.get("entry") if isinstance(shop.get("entry"), str) else None)
    if platform == "unknown" and from_entry:
        platform = from_entry

    # Prefer existing entry if the endpoint still responds with a valid shape
    # (empty product lists are OK — probe query may not match the shop's catalog).
    existing = shop.get("entry")
    if isinstance(existing, str) and "{q}" in existing:
        if probe_entry(existing, require_products=False):
            out["entry"] = existing
            out["platform"] = from_entry or platform or "unknown"
            print(f"  OK    {host} platform={out['platform']} entry=kept", flush=True)
            return out
        # Curated entry templates (esp. VTEX) sometimes return SPA HTML for a
        # mismatched probe query; keep them — seeds still benefit.
        if shop.get("curated") and from_entry:
            out["entry"] = existing
            out["platform"] = from_entry
            print(f"  OK    {host} platform={out['platform']} entry=kept(curated)", flush=True)
            return out

    found_entry: str | None = None
    found_plat: Platform = platform
    for plat, tmpl in entry_candidates(host, platform):
        # New discoveries require ≥1 product so we don't lock onto dead empty stubs.
        if probe_entry(tmpl, require_products=True):
            found_entry = tmpl
            found_plat = plat if platform == "unknown" else platform
            break

    out["platform"] = found_plat if found_plat else platform
    out["entry"] = found_entry
    print(
        f"  {'HIT' if found_entry else 'MISS'}  {host} platform={out['platform']} "
        f"entry={'yes' if found_entry else 'null'}",
        flush=True,
    )
    return out


def main() -> int:
    raw = json.loads(INDEX_PATH.read_text("utf-8"))
    shops: list[dict[str, Any]] = list(raw.get("shops") or [])
    print(f"Probing {len(shops)} shops (q={PROBE_Q!r}, workers={WORKERS})…", flush=True)

    updated: list[dict[str, Any] | None] = [None] * len(shops)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(probe_shop, shop): i for i, shop in enumerate(shops)}
        for fut in as_completed(futures):
            i = futures[fut]
            try:
                updated[i] = fut.result()
            except Exception as exc:  # noqa: BLE001
                shop = shops[i]
                print(f"  ERR   {shop.get('host')}: {exc}", flush=True)
                updated[i] = {
                    **shop,
                    "alive": True,
                    "platform": shop.get("platform") or "unknown",
                }

    final = [s for s in updated if s is not None]
    payload = {"version": INDEX_VERSION, "shops": final}
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(tmp, INDEX_PATH)

    by_plat: dict[str, int] = {}
    alive_n = 0
    dead_n = 0
    entry_n = 0
    for s in final:
        p = str(s.get("platform") or "unknown")
        by_plat[p] = by_plat.get(p, 0) + 1
        if s.get("alive") is False:
            dead_n += 1
        else:
            alive_n += 1
        if s.get("entry"):
            entry_n += 1

    print("\nDone.", flush=True)
    print(f"  alive={alive_n} dead={dead_n} with_entry={entry_n}", flush=True)
    print(f"  by platform: {by_plat}", flush=True)
    print(f"  wrote {INDEX_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
