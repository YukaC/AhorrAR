#!/usr/bin/env python3
"""Audit PDP link health for all alive shops in shared/ar-shops.json.

Compares parser-built URLs (VTEX legacy /slug/p vs Frávega /p/slug-itemId)
and flags the Frávega-style failure mode: legacy dead + next-itemId alive.

Usage:
  uv --directory scraper run python scripts/audit_pdp_links.py
  uv --directory scraper run python scripts/audit_pdp_links.py --json /tmp/audit.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scraper" / "src"))

from scrapling.fetchers import FetcherSession  # noqa: E402

QUERIES = {
    "gaming": "mouse",
    "electro": "heladera",
    "perfumeria": "perfume",
    "moda": "remera",
    "bazar": "vaso",
    "general": "cable",
}


def body_of(page) -> str:
    if page is None:
        return ""
    b = page.body
    return b.decode("utf-8", "replace") if isinstance(b, bytes) else str(b or "")


def origin_of(host: str) -> str:
    if host.startswith("tienda."):
        return f"https://{host}"
    return f"https://www.{host}" if not host.startswith("www.") else f"https://{host}"


def is_pdp_path(url: str) -> bool:
    p = urlparse(url).path.lower().rstrip("/")
    return (
        p.endswith("/p")
        or bool(re.search(r"/p/[^/]+$", p))
        or bool(re.search(r"/(producto|productos|products)/[^/]+", p))
    )


def fravega_gql(session, sku: str) -> bool | None:
    try:
        q = '{ sku(code: "%s") { code } }' % sku.strip()
        page = session.get(
            "https://www.fravega.com/api/v2/products?query=" + quote(q),
            timeout=6,
            retries=0,
        )
        data = json.loads(body_of(page))
        return isinstance((data.get("data") or {}).get("sku"), dict)
    except Exception:
        return None


def probe(session, url: str, host: str) -> dict:
    try:
        page = session.get(url, timeout=10, retries=0)
    except Exception as e:
        return {"alive": None, "reason": type(e).__name__, "final": None, "status": None}
    st = getattr(page, "status", None)
    final = str(getattr(page, "url", url) or url)
    if st in (404, 410, 451):
        return {"alive": False, "reason": f"http_{st}", "final": final, "status": st}
    fl = final.lower()
    if "buscavazia" in fl or "/sistema/" in fl:
        return {"alive": False, "reason": "buscavazia", "final": final, "status": st}
    if is_pdp_path(url) and not is_pdp_path(final):
        return {"alive": False, "reason": "redirect_off_pdp", "final": final, "status": st}
    if "fravega.com" in host:
        sku = final.rstrip("/").rsplit("-", 1)[-1]
        ok = fravega_gql(session, sku)
        return {"alive": ok, "reason": "fravega_gql", "final": final, "status": st, "sku": sku}
    if is_pdp_path(final) and st and st < 400:
        return {"alive": True, "reason": "pdp_path_200", "final": final, "status": st}
    return {"alive": False, "reason": "no_pdp", "final": final, "status": st}


def build_urls(origin: str, product: dict) -> dict[str, str]:
    link = product.get("link")
    slug = product.get("linkText") or ""
    pid = str(product.get("productId") or "")
    iid = str(((product.get("items") or [{}])[0]).get("itemId") or "")
    urls: dict[str, str] = {}
    if isinstance(link, str) and link.startswith("http"):
        urls["legacy"] = link
    elif isinstance(link, str) and link.startswith("/"):
        urls["legacy"] = origin.rstrip("/") + link
    elif slug:
        urls["legacy"] = f"{origin.rstrip('/')}/{slug}/p"
    if slug and iid:
        s = slug.strip("/")
        if pid and s.endswith("-" + pid):
            s2 = f"{s[: -(len(pid) + 1)]}-{iid}"
        elif s.endswith("-" + iid):
            s2 = s
        else:
            s2 = f"{s}-{iid}"
        urls["next_item"] = f"{origin.rstrip('/')}/p/{s2}/"
    return urls


def audit_vtex(shop: dict) -> dict:
    host = shop["host"]
    origin = origin_of(host)
    q = QUERIES.get(shop.get("category") or "general", "cable")
    out: dict = {"host": host, "platform": "vtex", "query": q, "samples": []}
    try:
        with FetcherSession(impersonate="chrome", stealthy_headers=True, timeout=12, retries=1) as s:
            api = f"{origin}/api/catalog_system/pub/products/search?ft={quote(q)}&_from=0&_to=4"
            page = s.get(api)
            st = getattr(page, "status", None)
            out["api_status"] = st
            if not st or st >= 400:
                out["verdict"] = "api_fail"
                return out
            try:
                data = json.loads(body_of(page))
            except Exception:
                out["verdict"] = "api_not_json"
                return out
            if not isinstance(data, list) or not data:
                out["verdict"] = "api_empty"
                return out
            legacy_ok = legacy_dead = next_ok = next_dead = 0
            for p in data[:3]:
                urls = build_urls(origin, p)
                sample = {
                    "name": (p.get("productName") or "")[:50],
                    "productId": p.get("productId"),
                    "itemId": ((p.get("items") or [{}])[0]).get("itemId"),
                    "probes": {},
                }
                for lab, url in urls.items():
                    pr = probe(s, url, host)
                    sample["probes"][lab] = {**pr, "url": url}
                    if lab == "legacy":
                        if pr.get("alive") is True:
                            legacy_ok += 1
                        elif pr.get("alive") is False:
                            legacy_dead += 1
                    if lab == "next_item":
                        if pr.get("alive") is True:
                            next_ok += 1
                        elif pr.get("alive") is False:
                            next_dead += 1
                out["samples"].append(sample)
            out["legacy_ok"] = legacy_ok
            out["legacy_dead"] = legacy_dead
            out["next_ok"] = next_ok
            out["next_dead"] = next_dead
            if legacy_dead > 0 and next_ok > 0 and legacy_ok == 0:
                out["verdict"] = "FRAVEGA_PATTERN"
            elif legacy_ok > 0 and (next_dead >= next_ok or next_ok == 0):
                out["verdict"] = "CLASSIC_VTEX"
            elif legacy_ok > 0:
                out["verdict"] = "ok"
            elif next_ok > 0 and "fravega" in host:
                out["verdict"] = "ok_fravega_fixed"
            else:
                out["verdict"] = "unclear"
    except Exception as e:
        out["verdict"] = "error"
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def audit_woo(shop: dict) -> dict:
    host = shop["host"]
    origin = origin_of(host)
    out: dict = {"host": host, "platform": "woo", "samples": []}
    try:
        with FetcherSession(impersonate="chrome", stealthy_headers=True, timeout=12, retries=1) as s:
            page = s.get(f"{origin}/wp-json/wc/store/v1/products?per_page=5")
            body = body_of(page)
            if body.startswith("\ufeff"):
                body = body.lstrip("\ufeff")
            st = getattr(page, "status", None)
            if not st or st >= 400:
                out["verdict"] = "api_fail"
                return out
            data = json.loads(body)
            if not isinstance(data, list) or not data:
                out["verdict"] = "api_empty"
                return out
            flags = []
            for p in data[:3]:
                u = p.get("permalink")
                if not isinstance(u, str):
                    continue
                pr = probe(s, u, host)
                out["samples"].append({"url": u, "probe": pr})
                flags.append(pr.get("alive"))
            goods = [x for x in flags if x is True]
            bads = [x for x in flags if x is False]
            if goods and not bads:
                out["verdict"] = "ok"
            elif bads and not goods:
                out["verdict"] = "DEAD_LINKS"
            elif goods and bads:
                out["verdict"] = "mixed"
            else:
                out["verdict"] = "unknown"
    except Exception as e:
        out["verdict"] = "error"
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def run_one(shop: dict) -> dict:
    plat = shop.get("platform") or "unknown"
    if plat == "vtex":
        return audit_vtex(shop)
    if plat == "woo":
        return audit_woo(shop)
    return {"host": shop["host"], "platform": plat, "verdict": "skipped_non_catalog"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", type=Path, help="Write full JSON report")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    raw = json.loads((ROOT / "shared/ar-shops.json").read_text())
    shops = raw if isinstance(raw, list) else raw.get("shops", [])
    alive = [s for s in shops if s.get("alive") is not False]
    # Focus on platforms that emit product URLs from JSON APIs
    targets = [s for s in alive if (s.get("platform") or "") in ("vtex", "woo")]

    print(f"Auditing {len(targets)} vtex/woo shops (of {len(alive)} alive)...")
    t0 = time.time()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(run_one, s): s["host"] for s in targets}
        for i, fut in enumerate(as_completed(futs), 1):
            r = fut.result()
            results.append(r)
            print(f"[{i}/{len(targets)}] {r.get('host')} → {r.get('verdict')}", flush=True)

    counts = Counter(r.get("verdict") for r in results)
    print("\nSUMMARY", dict(counts))
    patterns = [r for r in results if r.get("verdict") == "FRAVEGA_PATTERN"]
    dead = [r for r in results if r.get("verdict") == "DEAD_LINKS"]
    if patterns:
        print("\nFRAVEGA_PATTERN (needs itemId URL rewrite):")
        for r in patterns:
            print(f"  - {r['host']}")
    if dead:
        print("\nDEAD_LINKS:")
        for r in dead:
            print(f"  - {r['host']}")
    if not patterns and not dead:
        print("\nNo Frávega-style or systematic dead-link shops found.")

    if args.json:
        args.json.write_text(json.dumps(results, indent=2, ensure_ascii=False))
        print(f"Wrote {args.json}")
    print(f"Done in {time.time() - t0:.1f}s")
    return 1 if patterns or dead else 0


if __name__ == "__main__":
    raise SystemExit(main())
