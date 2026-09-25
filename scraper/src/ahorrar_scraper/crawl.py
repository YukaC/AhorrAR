"""Primary crawl engine powered by Scrapling FetcherSession (TLS impersonation).

Fase 0 / A — velocidad:
- ML (search_mla) corre en un worker thread MÁS el BFS de tiendas.
- Fetches en lotes paralelos con _FetchPool: una FetcherSession por worker
  (impersonate rotativo), límites por kind hub|api|html, early-stop agresivo.
- StealthyFetcher solo si STEALTH_FETCH=1 (gated; off en Fly/Docker).
"""

from __future__ import annotations

import logging
import os
import queue
import re
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.parse import urlparse

from scrapling.fetchers import FetcherSession

from ahorrar_scraper.parsers import looks_like_challenge, parse_page
from ahorrar_scraper.meli_api import meli_token_configured, search_mla
from ahorrar_scraper.relevance import title_matches_query
from ahorrar_scraper.seeds import (
    ar_shop_hosts,
    build_seed_urls,
    curated_search_url,
    discover_shop,
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

IMPERSONATE_ROTATE: list[str] = ["chrome", "chrome_android", "edge"]

# Concurrency and budget by source kind (APIs get more slots; HTML burns less).
FETCH_LIMITS: dict[str, int] = {"hub": 2, "api": 8, "html": 3}
FETCH_TIMEOUT_S: dict[str, float] = {"hub": 3.5, "api": 6.0, "html": 8.0}
BATCH_SIZE = 6
FETCH_WORKERS = 8
MAX_STEALTH_RETRIES = 3
STEALTH_TIMEOUT_MS = 12_000
CHALLENGE_BLACKLIST_AFTER = 2
# PDP existence probe — short GET, fail-open on timeout/network.
PROBE_TIMEOUT_S = 1.5
PROBE_WORKERS = 6
SOFT_404_RE = re.compile(
    r"p[aá]gina\s+no\s+encontrada|page\s+not\s+found|producto\s+no\s+(?:encontrado|disponible)|"
    r"no\s+encontramos|error\s*404|contenido\s+no\s+disponible",
    re.I,
)


def _env_flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _fetch_kind(url: str) -> str:
    if is_serp(url):
        return "hub"
    # VTEX catalog / finder
    if "catalog_system/pub/products/search" in url or "/finder/" in url:
        return "api"
    # WooCommerce Store API / REST
    if "/wp-json/wc/store" in url or "/wp-json/wc/v" in url:
        return "api"
    # Shopify suggest / products.json
    if "suggest.json" in url or "/products.json" in url:
        return "api"
    return "html"


def _page_body_text(page: Any) -> str:
    body = getattr(page, "body", None)
    if isinstance(body, bytes):
        return body.decode("utf-8", errors="replace")
    if body is None:
        return ""
    return str(body)


def _page_status(page: Any) -> int:
    status = getattr(page, "status", None) or getattr(page, "status_code", 200)
    return int(status) if isinstance(status, int) else 200


def _distinct_offer_hosts(results: list[dict[str, Any]]) -> int:
    hosts: set[str] = set()
    for offer in results:
        u = offer.get("url")
        if isinstance(u, str):
            h = host_of(u)
            if h:
                hosts.add(h)
    return len(hosts)


def _queue_only_html_for_expanded(
    crawl_queue: deque[tuple[str, int]],
    known_origins: set[str],
) -> bool:
    """True when every queued URL is html-kind for an already-expanded origin."""
    if not crawl_queue:
        return False
    for url, _depth in crawl_queue:
        if _fetch_kind(url) != "html":
            return False
        try:
            parsed = urlparse(url)
            origin = f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            return False
        if origin not in known_origins:
            return False
    return True


class _FetchPool:
    """Parallel fetches with per-worker FetcherSession and per-kind semaphores."""

    def __init__(self, max_workers: int = FETCH_WORKERS) -> None:
        self._ex = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="crawl")
        self._sems = {kind: threading.Semaphore(n) for kind, n in FETCH_LIMITS.items()}
        self._managers: list[FetcherSession] = []
        self._session_q: queue.Queue[Any] = queue.Queue()
        for _ in range(max_workers):
            manager = FetcherSession(
                impersonate=IMPERSONATE_ROTATE,  # type: ignore[arg-type]
                stealthy_headers=True,
                timeout=max(FETCH_TIMEOUT_S.values()),
                retries=1,
                retry_delay=0,
            )
            session = manager.__enter__()
            self._managers.append(manager)
            self._session_q.put(session)

        self._stealth_enabled = _env_flag("STEALTH_FETCH", "0")
        proxy = os.environ.get("STEALTH_PROXY", "").strip()
        self._stealth_proxy: str | None = proxy or None
        self._stealth_lock = threading.Lock()
        self._stealth_retries_left = MAX_STEALTH_RETRIES
        self._challenge_streak: dict[str, int] = {}
        self._blacklisted_hosts: set[str] = set()

    def submit(self, url: str) -> Any:
        kind = _fetch_kind(url)
        sem = self._sems[kind]

        def _wrapped() -> tuple[str, str] | None:
            with sem:
                session = self._session_q.get()
                try:
                    return self._fetch(url, session)
                finally:
                    self._session_q.put(session)

        return self._ex.submit(_wrapped)

    def probe_many(self, urls: list[str]) -> dict[str, bool]:
        """Check PDP URLs are reachable. True=alive, False=dead.

        Fail-open: timeouts / network errors → True (keep offer; do not inflate latency
        by dropping good stock on a slow shop). Hard 404/410/soft-404 → False.
        """
        if not urls:
            return {}
        unique = list(dict.fromkeys(urls))
        out: dict[str, bool] = {}

        def _one(url: str) -> tuple[str, bool]:
            session = self._session_q.get()
            try:
                return url, self._probe_one(url, session)
            finally:
                self._session_q.put(session)

        # Cap fan-out so probes don't starve listing fetches.
        workers = min(PROBE_WORKERS, len(unique), max(1, self._session_q.qsize() or FETCH_WORKERS))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="probe") as pool:
            futs = [pool.submit(_one, u) for u in unique]
            for fut in as_completed(futs):
                try:
                    url, alive = fut.result()
                except Exception:  # noqa: BLE001
                    continue
                out[url] = alive
        # Anything missing → fail-open
        for u in unique:
            out.setdefault(u, True)
        return out

    def _probe_one(self, url: str, session: Any) -> bool:
        host = host_of(url)
        if host in self._blacklisted_hosts:
            return False
        if "mercadolibre" in host:
            return True  # ML permalinks trusted; skip RTT
        try:
            page = session.get(url, timeout=PROBE_TIMEOUT_S, retries=0)
            if page is None:
                return True  # fail-open
            status = _page_status(page)
            if status in (404, 410, 451):
                return False
            if status >= 500:
                return True  # shop flaky — keep
            if status >= 400:
                return False
            text = _page_body_text(page)[:8000]
            if looks_like_challenge(text):
                return True  # challenge ≠ missing product
            if SOFT_404_RE.search(text):
                return False
            # Frávega SPA: HTTP 200 shell even when GraphQL SKU is missing.
            # Next embeds pageProps.sku from the URL; resolve via storefront API.
            if "fravega.com" in host and not self._fravega_sku_alive(text, session):
                return False
            return True
        except Exception:  # noqa: BLE001
            return True  # fail-open on timeout/DNS blip

    def _fravega_sku_alive(self, html: str, session: Any) -> bool:
        """True when __NEXT_DATA__ sku resolves in Frávega GraphQL (itemId)."""
        import json
        import re
        from urllib.parse import quote

        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if m is None:
            return True  # unknown shell — fail-open
        try:
            data = json.loads(m.group(1))
            sku = data.get("props", {}).get("pageProps", {}).get("sku")
        except Exception:  # noqa: BLE001
            return True
        if not isinstance(sku, str) or not sku.strip():
            return False
        q = '{ sku(code: "%s") { code } }' % sku.strip()
        api = "https://www.fravega.com/api/v2/products?query=" + quote(q)
        try:
            page = session.get(api, timeout=PROBE_TIMEOUT_S, retries=0)
            if page is None:
                return True
            body = _page_body_text(page)
            payload = json.loads(body)
            return isinstance((payload.get("data") or {}).get("sku"), dict)
        except Exception:  # noqa: BLE001
            return True

    def shutdown(self) -> None:
        self._ex.shutdown(wait=True)
        for manager in self._managers:
            try:
                manager.__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                log.warning("FetcherSession close failed", exc_info=True)
        self._managers.clear()

    def _note_challenge(self, host: str) -> None:
        if not host:
            return
        with self._stealth_lock:
            streak = self._challenge_streak.get(host, 0) + 1
            self._challenge_streak[host] = streak
            if streak >= CHALLENGE_BLACKLIST_AFTER:
                self._blacklisted_hosts.add(host)
                log.info("blacklist host after %s challenges: %s", streak, host)

    def _reset_challenge(self, host: str) -> None:
        if not host:
            return
        with self._stealth_lock:
            self._challenge_streak.pop(host, None)

    def _consume_stealth_budget(self) -> bool:
        with self._stealth_lock:
            if self._stealth_retries_left <= 0:
                return False
            self._stealth_retries_left -= 1
            return True

    def _stealth_fetch(self, url: str) -> tuple[str, str] | None:
        """One-shot StealthyFetcher retry (browser). Requires scrapling install locally."""
        try:
            from scrapling.fetchers import StealthyFetcher
        except Exception as exc:  # noqa: BLE001
            log.warning("StealthyFetcher unavailable: %s", exc)
            return None
        try:
            kwargs: dict[str, Any] = {
                "headless": True,
                "network_idle": False,
                "timeout": STEALTH_TIMEOUT_MS,
            }
            if self._stealth_proxy:
                kwargs["proxy"] = self._stealth_proxy
            page = StealthyFetcher.fetch(url, **kwargs)
            if page is None:
                return None
            status = _page_status(page)
            text = _page_body_text(page)
            if status >= 400:
                return None
            if len(text) < 40 or looks_like_challenge(text):
                return None
            final = getattr(page, "url", None) or url
            return str(final), text
        except Exception as exc:  # noqa: BLE001
            log.warning("stealth fetch failed %s: %s", url, exc)
            return None

    def _fetch(self, url: str, session: Any) -> tuple[str, str] | None:
        """Return (final_url, body_text) or None. Timeout budget by source kind."""
        kind = _fetch_kind(url)
        host = host_of(url)
        if host in self._blacklisted_hosts:
            log.info("skip blacklisted host: %s", host)
            return None
        try:
            page = session.get(url, timeout=FETCH_TIMEOUT_S[kind])
            if page is None:
                return None
            status = _page_status(page)
            text = _page_body_text(page)
            is_challenge = looks_like_challenge(text) if text else False
            needs_stealth = status >= 403 or is_challenge

            if needs_stealth:
                self._note_challenge(host)
                if self._stealth_enabled and self._consume_stealth_budget():
                    log.info("stealth retry (%s): %s", status if status >= 403 else "challenge", url)
                    stealth = self._stealth_fetch(url)
                    if stealth is not None:
                        self._reset_challenge(host)
                        return stealth
                elif is_challenge:
                    log.info("challenge skip: %s", url)
                return None

            if status >= 400:
                return None
            if len(text) < 40:
                return None

            self._reset_challenge(host)
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
    on_offer: Any = None,
    on_progress: Any = None,
) -> dict[str, Any]:
    started = time.time()
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    visited: set[str] = set()
    ml_via_api = False
    blocked_ml = False

    def emit_offer(offer: dict[str, Any]) -> None:
        if callable(on_offer):
            try:
                on_offer(offer)
            except Exception:  # noqa: BLE001
                log.warning("on_offer callback failed", exc_info=True)

    def emit_progress(**kw: Any) -> None:
        if callable(on_progress):
            try:
                on_progress(**kw)
            except Exception:  # noqa: BLE001
                pass

    def explore_offer(offer: dict[str, Any]) -> None:
        u = offer.get("url")
        if not isinstance(u, str):
            return
        host = host_of(u)
        if not host or "mercadolibre" in host:
            return
        if host not in ar_shop_hosts():
            discover_shop(host)

    # ML PRIMARY: official API when token present (never HTML listado).
    # §V17: ML share capped at 50% of max_results (the crawler covers the rest).
    # Fase 0: ML corre en un worker mientras el BFS de tiendas ya arranca, en
    # vez de bloquear el crawl entero esperando la API de ML en serie.
    want_ml = include_ml or meli_token_configured()
    ml_cap = max(1, int(max_results * 0.5))
    ml_pool: ThreadPoolExecutor | None = None
    ml_future: Any = None
    if want_ml and meli_token_configured():
        ml_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ml")
        ml_future = ml_pool.submit(search_mla, product, limit=min(50, ml_cap * 3))
    elif want_ml:
        log.info("include_ml pedido pero MELI_ACCESS_TOKEN ausente — skip ML (no HTML scrape)")

    # ⊥ HTML ML seeds — API only. SERP + VTEX discovery for the rest.
    seeds = build_seed_urls(product, include_ml=False)
    crawl_queue: deque[tuple[str, int]] = deque((u, 0) for u in seeds)
    known_origins: set[str] = set()
    pages_fetched = 0
    max_depth_reached = 0
    fetch_pool = _FetchPool()

    def enqueue(url: str, depth: int) -> None:
        if depth > max_depth:
            return
        if url in visited:
            return
        if "mercadolibre" in host_of(url):
            return  # never crawl ML HTML
        crawl_queue.append((url, depth))

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
        canonical = curated_search_url(host_of(origin), product)
        if canonical is not None:
            enqueue(canonical, depth)
            return
        for guess in guess_search_urls(origin, product):
            enqueue(guess, depth)

    def ml_absorb() -> None:
        """Merge ML offers (capped) into results once the worker finishes."""
        nonlocal ml_via_api
        if ml_future is None:
            return
        try:
            offers = ml_future.result(timeout=90)
        except Exception as exc:  # noqa: BLE001
            log.warning("ML search falló: %s", exc)
            return
        if ml_pool is not None:
            ml_pool.shutdown(wait=False)
        ml_count = 0
        for offer in offers:
            u = offer.get("url")
            name = offer.get("name")
            if not isinstance(u, str) or u in seen_urls:
                continue
            if isinstance(name, str) and not title_matches_query(name, product):
                continue
            if ml_count >= ml_cap:  # §V17: cap ML es por oferta ML, no total
                break
            seen_urls.add(u)
            results.append(offer)
            ml_count += 1
            ml_via_api = True
            emit_offer(offer)
            emit_progress(nodes_visited=len(visited), results_found=len(results))

    def take_batch() -> list[tuple[str, int]]:
        batch: list[tuple[str, int]] = []
        while crawl_queue and len(batch) < BATCH_SIZE and len(visited) < max_nodes:
            url, d = crawl_queue.popleft()
            if url in visited:
                continue
            visited.add(url)
            batch.append((url, d))
        return batch

    def process_batch(batch: list[tuple[str, int]]) -> None:
        nonlocal pages_fetched, max_depth_reached
        if not batch:
            return
        futures = {fetch_pool.submit(url): url for url, _d in batch}
        fetched_by_url: dict[str, tuple[str, str] | None] = {}
        for fut in as_completed(futures):
            url = futures[fut]
            try:
                fetched_by_url[url] = fut.result()
            except Exception:  # noqa: BLE001
                fetched_by_url[url] = None

        for url, depth in batch:
            max_depth_reached = max(max_depth_reached, depth)
            fetched = fetched_by_url.get(url)
            if fetched is None:
                continue
            final_url, body = fetched
            pages_fetched += 1
            emit_progress(nodes_visited=len(visited), results_found=len(results))

            if is_serp(final_url) or is_serp(url):
                for link in unwrap_serp_hrefs(final_url, body):
                    enqueue(link, depth + 1)
                    expand_origin(link, depth + 1)

            offers = parse_page(final_url, body)
            candidates: list[dict[str, Any]] = []
            for offer in offers:
                u = offer.get("url")
                name = offer.get("name")
                if not isinstance(u, str) or u in seen_urls:
                    continue
                if not is_publishable(u):
                    continue
                if "mercadolibre" in host_of(u):
                    continue
                if not isinstance(name, str) or not title_matches_query(name, product):
                    continue
                offer["depth"] = depth
                candidates.append(offer)

            if not candidates:
                if not is_serp(url):
                    expand_origin(final_url, depth + 1)
                continue

            # Probe only as many as we still need (early-stop friendly).
            slots = max(0, max_results - len(results))
            to_probe = candidates[: max(slots * 2, slots)]  # small overfetch for dead links
            alive_map = fetch_pool.probe_many([c["url"] for c in to_probe if isinstance(c.get("url"), str)])

            for offer in to_probe:
                if len(results) >= max_results:
                    break
                u = offer.get("url")
                if not isinstance(u, str) or u in seen_urls:
                    continue
                if alive_map.get(u, True) is False:
                    seen_urls.add(u)  # remember dead — don't re-queue
                    continue
                seen_urls.add(u)
                results.append(offer)
                explore_offer(offer)
                emit_offer(offer)
                emit_progress(nodes_visited=len(visited), results_found=len(results))

            if not is_serp(url):
                expand_origin(final_url, depth + 1)

    try:
        while crawl_queue and len(visited) < max_nodes and len(results) < max_results:
            batch = take_batch()
            if not batch:
                break

            process_batch(batch)

            # A3: enough diverse offers + queue is only HTML guesses for expanded hosts
            # → one more api-only batch, then exit (ML absorb unchanged at end).
            if (
                len(results) >= min(max_results, 8)
                and _distinct_offer_hosts(results) >= 4
                and _queue_only_html_for_expanded(crawl_queue, known_origins)
            ):
                api_only: list[tuple[str, int]] = []
                while crawl_queue:
                    url, d = crawl_queue.popleft()
                    if _fetch_kind(url) != "api" or url in visited:
                        continue
                    if len(visited) >= max_nodes or len(api_only) >= BATCH_SIZE:
                        continue
                    visited.add(url)
                    api_only.append((url, d))
                if api_only and len(results) < max_results:
                    process_batch(api_only)
                break
    finally:
        fetch_pool.shutdown()

    # ML se absorbe al final (cap aparte, nunca bloquea el primer resultado).
    if ml_future is not None:
        ml_absorb()

    elapsed_ms = int((time.time() - started) * 1000)
    return {
        "product": product,
        "country": "AR",
        "results": results[:max_results],
        "stats": {
            "source": "scrapling",
            "nodesVisited": len(visited),
            "linksQueued": len(visited) + len(crawl_queue),
            "pagesFetched": pages_fetched,
            "maxDepthReached": max_depth_reached,
            "skippedNoShipping": 0,
            "skippedDedupe": 0,
            "elapsedMs": elapsed_ms,
        },
        "mlBlocked": blocked_ml,
        "mlViaApi": ml_via_api,
    }
