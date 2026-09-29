#!/usr/bin/env python3
"""One-shot funnel audit for a query: per-host stage drops (iphone 15).

Stages (VTEX-focused; Woo/Shopify analogous):
  raw_items → named → priced → in_stock → url_ok → parsed
  → publishable → match_gate → score_floor → relevant

Run: cd scraper && uv run python ../scripts/audit_offer_funnel.py 'iphone 15'
"""

from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

from scrapling.fetchers import FetcherSession

from ahorrar_scraper.relevance import (
    is_relevant_result,
    publish_floor_for,
    title_matches_query,
    title_relevance_score,
)
from ahorrar_scraper.seeds import build_seed_urls, host_of, is_publishable, is_serp
from ahorrar_scraper.parsers import (
    fravega_pdp_url,
    normalize_product_url,
    parse_page,
)


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def _is_fravega(host: str) -> bool:
    return "fravega.com" in host


def funnel_vtex(url: str, body: str, product: str) -> dict[str, Any]:
    """Count VTEX catalog drops without changing parsers."""
    counts = defaultdict(int)
    samples: dict[str, list[str]] = defaultdict(list)
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        counts["json_fail"] = 1
        return {"counts": dict(counts), "samples": dict(samples), "survivors": []}
    if not isinstance(data, list):
        counts["not_list"] = 1
        return {"counts": dict(counts), "samples": dict(samples), "survivors": []}

    origin = _origin(url)
    host = host_of(url) or "unknown"
    seen: set[str] = set()
    survivors: list[dict[str, Any]] = []

    for product_row in data[:40]:
        counts["raw_items"] += 1
        if not isinstance(product_row, dict):
            counts["drop_not_dict"] += 1
            continue
        name = (product_row.get("productName") or "").strip()
        if len(name) < 4:
            counts["drop_name"] += 1
            continue
        counts["named"] += 1
        items = product_row.get("items") or []
        item = items[0] if items else {}
        sellers = (item.get("sellers") or [{}])[0] if isinstance(item, dict) else {}
        offer = sellers.get("commertialOffer") or {} if isinstance(sellers, dict) else {}
        price = offer.get("Price") or offer.get("ListPrice") if isinstance(offer, dict) else None
        if not isinstance(price, (int, float)) or price <= 0:
            counts["drop_price"] += 1
            if len(samples["drop_price"]) < 3:
                samples["drop_price"].append(name[:60])
            continue
        counts["priced"] += 1
        qty = offer.get("AvailableQuantity") if isinstance(offer, dict) else None
        if isinstance(qty, int) and qty <= 0:
            counts["drop_stock"] += 1
            if len(samples["drop_stock"]) < 5:
                samples["drop_stock"].append(f"{name[:50]} qty={qty} ${price}")
            continue
        counts["in_stock"] += 1

        link = product_row.get("link")
        slug = product_row.get("linkText")
        product_id = product_row.get("productId")
        item_id = item.get("itemId") if isinstance(item, dict) else None
        if _is_fravega(host):
            product_url = fravega_pdp_url(
                origin,
                link_text=slug if isinstance(slug, str) else None,
                product_id=str(product_id) if product_id is not None else None,
                item_id=str(item_id) if item_id is not None else None,
            )
        elif isinstance(link, str) and link.startswith("http"):
            product_url = normalize_product_url(link)
        elif isinstance(link, str) and link.startswith("/"):
            product_url = normalize_product_url(link, base=origin)
        elif isinstance(slug, str) and slug:
            product_url = normalize_product_url(f"{origin}/{slug}/p")
        else:
            product_url = None
        if product_url is None:
            counts["drop_url"] += 1
            if len(samples["drop_url"]) < 3:
                samples["drop_url"].append(name[:60])
            continue
        if product_url in seen:
            counts["drop_url_dup"] += 1
            continue
        seen.add(product_url)
        counts["parsed"] += 1

        offer_out = {"name": name, "price": float(price), "url": product_url, "host": host}

        if not is_publishable(product_url):
            counts["drop_publishable"] += 1
            continue
        counts["publishable"] += 1

        matched = title_matches_query(name, product)
        score = title_relevance_score(name, product)
        floor = publish_floor_for(product)
        if not matched:
            counts["drop_match_gate"] += 1
            if len(samples["drop_match_gate"]) < 5:
                samples["drop_match_gate"].append(f"{name[:55]} score={score:.2f}")
            continue
        counts["match_gate"] += 1
        if score < floor:
            counts["drop_score_floor"] += 1
            if len(samples["drop_score_floor"]) < 5:
                samples["drop_score_floor"].append(f"{name[:55]} score={score:.2f}<{floor}")
            continue
        counts["score_floor"] += 1
        if not is_relevant_result(name, product):
            counts["drop_relevant_inconsistent"] += 1
            continue
        counts["relevant"] += 1
        survivors.append(offer_out)

    return {"counts": dict(counts), "samples": dict(samples), "survivors": survivors}


def funnel_generic(url: str, body: str, product: str) -> dict[str, Any]:
    """For non-VTEX: use parse_page then gate stages."""
    counts = defaultdict(int)
    samples: dict[str, list[str]] = defaultdict(list)
    host = host_of(url) or "unknown"
    offers = parse_page(url, body)
    counts["parsed"] = len(offers)
    survivors: list[dict[str, Any]] = []
    for o in offers:
        name = o.get("name") if isinstance(o.get("name"), str) else ""
        u = o.get("url") if isinstance(o.get("url"), str) else ""
        if not u or not is_publishable(u):
            counts["drop_publishable"] += 1
            continue
        counts["publishable"] += 1
        if not title_matches_query(name, product):
            counts["drop_match_gate"] += 1
            if len(samples["drop_match_gate"]) < 3:
                samples["drop_match_gate"].append(name[:55])
            continue
        counts["match_gate"] += 1
        score = title_relevance_score(name, product)
        floor = publish_floor_for(product)
        if score < floor:
            counts["drop_score_floor"] += 1
            if len(samples["drop_score_floor"]) < 3:
                samples["drop_score_floor"].append(f"{name[:55]} {score:.2f}")
            continue
        counts["score_floor"] += 1
        counts["relevant"] += 1
        survivors.append({"name": name, "price": o.get("price"), "url": u, "host": host})
    return {"counts": dict(counts), "samples": dict(samples), "survivors": survivors}


def main() -> int:
    product = " ".join(sys.argv[1:]).strip() or "iphone 15"
    seeds = build_seed_urls(product, include_ml=False)
    api_seeds = [u for u in seeds if not is_serp(u)]
    print(f"query={product!r} seeds={len(seeds)} api_non_serp={len(api_seeds)}\n")

    by_host: dict[str, dict[str, Any]] = {}
    t0 = time.time()

    with FetcherSession(impersonate="chrome", stealthy_headers=True, timeout=15, retries=1) as session:
        for url in api_seeds:
            host = host_of(url) or "unknown"
            kind = "api" if "/api/" in url or "wp-json" in url or "suggest.json" in url or "products.json" in url else "html"
            print(f"fetch {kind} {host} ...", flush=True)
            try:
                page = session.get(url)
                body = page.body if isinstance(page.body, str) else (page.body or b"").decode("utf-8", "replace")
                status = getattr(page, "status", None) or getattr(page, "status_code", None)
            except Exception as exc:  # noqa: BLE001
                print(f"  ERR {exc}")
                entry = by_host.setdefault(host, {"fetches": 0, "http_err": 0, "agg": defaultdict(int), "samples": defaultdict(list), "survivors": []})
                entry["http_err"] += 1
                continue

            entry = by_host.setdefault(
                host,
                {"fetches": 0, "http_ok": 0, "http_err": 0, "status": [], "agg": defaultdict(int), "samples": defaultdict(list), "survivors": [], "urls": []},
            )
            entry["fetches"] += 1
            entry["status"].append(status)
            entry["urls"].append(url[:90])
            if status and int(status) >= 400:
                entry["http_err"] += 1
                print(f"  HTTP {status}")
                continue
            entry["http_ok"] += 1

            is_vtex = "/api/catalog_system/pub/products/search" in url
            funnel = funnel_vtex(url, body, product) if is_vtex else funnel_generic(url, body, product)
            for k, v in funnel["counts"].items():
                entry["agg"][k] += v
            for k, xs in funnel["samples"].items():
                entry["samples"][k].extend(xs)
            entry["survivors"].extend(funnel["survivors"])
            c = funnel["counts"]
            print(
                f"  status={status} raw={c.get('raw_items', '—')} stock_drop={c.get('drop_stock', 0)} "
                f"parsed={c.get('parsed', 0)} relevant={c.get('relevant', 0)} "
                f"match_drop={c.get('drop_match_gate', 0)} floor_drop={c.get('drop_score_floor', 0)}"
            )

    print(f"\n=== FUNNEL by host ({time.time() - t0:.1f}s) ===\n")
    print(
        f"{'host':28} {'raw':>4} {'stock↓':>6} {'parsed':>6} {'pub':>4} {'match↓':>6} {'floor↓':>6} {'rel':>4}"
    )
    published_hosts = 0
    for host, entry in sorted(by_host.items(), key=lambda x: -x[1]["agg"].get("relevant", 0)):
        a = entry["agg"]
        rel = a.get("relevant", 0)
        if rel > 0:
            published_hosts += 1
        print(
            f"{host:28} {a.get('raw_items', 0):4} {a.get('drop_stock', 0):6} "
            f"{a.get('parsed', 0):6} {a.get('publishable', 0):4} "
            f"{a.get('drop_match_gate', 0):6} {a.get('drop_score_floor', 0):6} {rel:4}"
        )
        for stage in ("drop_stock", "drop_match_gate", "drop_score_floor", "drop_price", "drop_url"):
            xs = entry["samples"].get(stage) or []
            if xs:
                print(f"  [{stage}]")
                for s in xs[:3]:
                    print(f"    · {s}")

    print(f"\nhosts_with_relevant={published_hosts} / {len(by_host)}")
    all_surv = []
    for entry in by_host.values():
        all_surv.extend(entry["survivors"])
    # naive dedupe by url
    by_url = {s["url"]: s for s in all_surv if s.get("url")}
    print(f"relevant_offers={len(all_surv)} unique_urls={len(by_url)}")
    hosts_u = {host_of(u) for u in by_url}
    print(f"unique_hosts_relevant={len(hosts_u)} → {sorted(h for h in hosts_u if h)}")

    out = {
        "product": product,
        "by_host": {
            h: {
                "fetches": e["fetches"],
                "http_ok": e.get("http_ok", 0),
                "http_err": e.get("http_err", 0),
                "status": e.get("status"),
                "counts": dict(e["agg"]),
                "samples": {k: v[:5] for k, v in e["samples"].items()},
                "survivor_n": len(e["survivors"]),
            }
            for h, e in by_host.items()
        },
    }
    path = "/tmp/ahorrar-iphone-funnel.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
