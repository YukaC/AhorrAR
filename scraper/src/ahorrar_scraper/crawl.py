"""Primary crawl engine powered by Scrapling Fetcher (TLS impersonation)."""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any
from urllib.parse import urlparse

from scrapling.fetchers import Fetcher

from ahorrar_scraper.parsers import looks_like_challenge, parse_page
from ahorrar_scraper.meli_api import meli_token_configured, search_mla
from ahorrar_scraper.seeds import (
    build_seed_urls,
    guess_search_urls,
    host_of,
    is_ar_host,
    is_publishable,
    is_serp,
    unwrap_serp_hrefs,
)

log = logging.getLogger("ahorrar.scraper")

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _fetch(url: str) -> tuple[str, str] | None:
    """Return (final_url, body_text) or None."""
    try:
        page = Fetcher.get(url, stealthy_headers=True, impersonate="chrome")
        if page is None:
            return None
        status = getattr(page, "status", None) or getattr(page, "status_code", 200)
        if isinstance(status, int) and status >= 400:
            return None
        body = page.body
        if isinstance(body, bytes):
            text = body.decode("utf-8", errors="replace")
        elif body is None:
            text = ""
        else:
            text = str(body)
        if len(text) < 40:
            return None
        if looks_like_challenge(text):
            log.info("challenge skip: %s", url)
            return None
        final = getattr(page, "url", None) or url
        return str(final), text
    except Exception as exc:  # noqa: BLE001
        log.warning("fetch failed %s: %s", url, exc)
        return None


def crawl(
    product: str,
    *,
    max_results: int = 10,
    max_nodes: int = 40,
    max_depth: int = 2,
    include_ml: bool = False,
) -> dict[str, Any]:
    started = time.time()
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    ml_via_api = False
    blocked_ml = False

    # ML PRIMARY: official API when token present (never HTML listado).
    want_ml = include_ml or meli_token_configured()
    if want_ml and meli_token_configured():
        for offer in search_mla(product, limit=min(50, max_results * 3)):
            u = offer.get("url")
            if not isinstance(u, str) or u in seen_urls:
                continue
            seen_urls.add(u)
            results.append(offer)
            ml_via_api = True
            if len(results) >= max_results:
                break
    elif want_ml:
        log.info("include_ml pedido pero MELI_ACCESS_TOKEN ausente — skip ML (no HTML scrape)")

    # ⊥ HTML ML seeds — API only. SERP + VTEX discovery for the rest.
    seeds = build_seed_urls(product, include_ml=False)
    queue: deque[tuple[str, int]] = deque((u, 0) for u in seeds)
    visited: set[str] = set()
    known_origins: set[str] = set()
    pages_fetched = 0
    max_depth_reached = 0

    def enqueue(url: str, depth: int) -> None:
        if depth > max_depth:
            return
        if url in visited:
            return
        if "mercadolibre" in host_of(url):
            return  # never crawl ML HTML
        queue.append((url, depth))

    def expand_origin(url: str, depth: int) -> None:
        if not is_publishable(url):
            return
        if "mercadolibre" in host_of(url):
            return
        try:
            origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        except Exception:
            return
        if origin in known_origins:
            return
        known_origins.add(origin)
        for guess in guess_search_urls(origin, product):
            enqueue(guess, depth)

    while queue and len(visited) < max_nodes and len(results) < max_results:
        url, depth = queue.popleft()
        if url in visited:
            continue
        visited.add(url)
        max_depth_reached = max(max_depth_reached, depth)

        fetched = _fetch(url)
        if fetched is None:
            continue
        final_url, body = fetched
        pages_fetched += 1

        if is_serp(final_url) or is_serp(url):
            for link in unwrap_serp_hrefs(final_url, body):
                enqueue(link, depth + 1)
                expand_origin(link, depth + 1)

        offers = parse_page(final_url, body)
        for offer in offers:
            u = offer.get("url")
            if not isinstance(u, str) or u in seen_urls:
                continue
            if not is_publishable(u):
                continue
            if "mercadolibre" in host_of(u):
                continue
            seen_urls.add(u)
            offer["depth"] = depth
            results.append(offer)
            if len(results) >= max_results:
                break

        if not is_serp(url):
            expand_origin(final_url, depth + 1)

    elapsed_ms = int((time.time() - started) * 1000)
    return {
        "product": product,
        "country": "AR",
        "results": results[:max_results],
        "stats": {
            "source": "scrapling",
            "nodesVisited": len(visited),
            "linksQueued": len(visited) + len(queue),
            "pagesFetched": pages_fetched,
            "maxDepthReached": max_depth_reached,
            "skippedNoShipping": 0,
            "skippedDedupe": 0,
            "elapsedMs": elapsed_ms,
        },
        "mlBlocked": blocked_ml,
        "mlViaApi": ml_via_api,
    }
