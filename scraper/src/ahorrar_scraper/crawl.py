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
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from scrapling.fetchers import FetcherSession

from ahorrar_scraper.host_yield import HostYieldTracker, OutcomeReason
from ahorrar_scraper.parsers import looks_like_challenge, parse_page
from ahorrar_scraper.meli_api import meli_token_configured, search_mla
from ahorrar_scraper.offer_cache import OfferCache
from ahorrar_scraper.relevance import is_relevant_result, title_relevance_score
from ahorrar_scraper.seeds import (
    ar_shop_hosts,
    build_seed_urls,
    category_for,
    curated_search_url,
    discover_shop,
    guess_search_urls,
    host_of,
    is_ar_host,
    is_publishable,
    is_serp,
    sitemap_candidate_hosts,
    sitemap_product_urls,
    unwrap_serp_hrefs,
)

log = logging.getLogger("ahorrar.scraper")

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

IMPERSONATE_ROTATE: list[str] = ["chrome", "chrome_android", "edge"]

# Defaults (full host). Override via env on Render Free — fewer FetcherSessions = less RAM.
FETCH_TIMEOUT_S: dict[str, float] = {"hub": 3.5, "api": 6.0, "html": 8.0}
MAX_STEALTH_RETRIES = 3
STEALTH_TIMEOUT_MS = 12_000
CHALLENGE_BLACKLIST_AFTER = 2
PROBE_TIMEOUT_S = 1.5
SOFT_404_RE = re.compile(
    r"p[aá]gina\s+no\s+encontrada|page\s+not\s+found|producto\s+no\s+(?:encontrado|disponible)|"
    r"no\s+encontramos|error\s*404|contenido\s+no\s+disponible",
    re.I,
)

# Reuse fresh verified offers per host across searches (Firecrawl-style
# index-cache). Global so the warm cache and live searches share it.
CACHE_SKIP_FETCH_THRESHOLD = 3
SITEMAP_FETCH_TIMEOUT_S = 3.0


@dataclass(frozen=True)
class PageFetch:
    """Result of one listing/hub fetch (ok or classified failure)."""

    final_url: str
    body: str
    status: int = 200
    reason: str = "ok"  # ok | http_error | timeout | challenge | empty | blacklist
    elapsed_s: float = 0.0

    @property
    def ok(self) -> bool:
        return self.reason == "ok" and len(self.body) >= 40


def _env_flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, min_v: int = 1, max_v: int = 256) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        n = int(raw)
    except ValueError:
        return default
    return max(min_v, min(max_v, n))


def fetch_limits() -> dict[str, int]:
    return {
        "hub": _env_int("FETCH_LIMIT_HUB", 2, min_v=1, max_v=8),
        "api": _env_int("FETCH_LIMIT_API", 8, min_v=1, max_v=16),
        "html": _env_int("FETCH_LIMIT_HTML", 3, min_v=1, max_v=8),
    }


def fetch_workers() -> int:
    return _env_int("FETCH_WORKERS", 8, min_v=1, max_v=16)


def batch_size() -> int:
    return _env_int("CRAWL_BATCH_SIZE", 6, min_v=1, max_v=16)


def probe_workers() -> int:
    return _env_int("PROBE_WORKERS", 6, min_v=1, max_v=16)


def probe_budget_factor() -> int:
    """Max PDP probes ≈ slots * factor (Micro: 2). Hard cap on probe fan-out."""
    return _env_int("PROBE_BUDGET_FACTOR", 2, min_v=1, max_v=8)


# Mirror Node RELEVANCE_STRONG — strong tier probed before weak/cheap accessories.
_RELEVANCE_STRONG = 0.55


def _offer_price(offer: dict[str, Any]) -> float:
    p = offer.get("price")
    return float(p) if isinstance(p, (int, float)) else float("inf")


def _offer_host(offer: dict[str, Any]) -> str:
    u = offer.get("url")
    return host_of(u) if isinstance(u, str) else ""


def _offer_tier(offer: dict[str, Any], product: str) -> int:
    """0 = strong relevance, 1 = weak (higher is worse for retention order)."""
    name = offer.get("name") if isinstance(offer.get("name"), str) else ""
    score = title_relevance_score(name, product) if name else 0.0
    return 0 if score >= _RELEVANCE_STRONG else 1


def _probe_sort_key(offer: dict[str, Any], product: str) -> tuple[int, float]:
    """(tier, price): strong relevance first, then cheapest within tier."""
    return (_offer_tier(offer, product), _offer_price(offer))


def _has_parsed_price(offer: dict[str, Any]) -> bool:
    p = offer.get("price")
    return isinstance(p, (int, float)) and float(p) > 0


def _needs_pdp_probe(offer: dict[str, Any]) -> bool:
    """PDP probe = dead-link / soft-404 check — not shipping (§V1 uses VTEX ShippingSLA).

    Skip for VTEX catalog API rows (stock+price already validated) except Frávega,
    whose SPA returns HTTP 200 shells that need GraphQL SKU check.
    """
    u = offer.get("url")
    if not isinstance(u, str):
        return False
    if "fravega.com" in host_of(u):
        return True
    src = offer.get("sourceUrl")
    if isinstance(src, str) and "catalog_system/pub/products/search" in src:
        return False
    return True


def filter_probe_candidates(
    candidates: list[dict[str, Any]],
    results: list[dict[str, Any]],
    product: str,
    *,
    max_results: int,
    k_hosts: int = 4,
) -> list[dict[str, Any]]:
    """Drop same-host candidates that cannot improve a full, diverse retained set.

    Retention order is (tier ↑, price ↑). A stronger-tier candidate may be more
    expensive than the worst retained price and still improve the set.
    Unpriced candidates and new hosts are never cut by this bound.
    """
    if len(results) < max_results:
        return candidates
    if _distinct_offer_hosts(results) < k_hosts:
        return candidates
    # Worst retained key under the same total order as ranking.
    worst_key = max((_probe_sort_key(r, product) for r in results), default=(1, 0.0))
    existing = {_offer_host(r) for r in results}
    out: list[dict[str, Any]] = []
    for c in candidates:
        h = _offer_host(c)
        if h not in existing:
            out.append(c)  # new host → variety
            continue
        if not _has_parsed_price(c):
            out.append(c)  # cannot evaluate price bound pre-probe
            continue
        if _probe_sort_key(c, product) < worst_key:
            out.append(c)
            # else: same/worse (tier, price) on an already-represented host → skip
    return out


def is_retained_set_satisfied(
    results: list[dict[str, Any]],
    pending: list[dict[str, Any]],
    product: str,
    *,
    max_results: int,
    k_hosts: int = 4,
) -> bool:
    """True iff cupo lleno ∧ ≥K hosts ∧ no pending candidate improves (tier, price).

    Same cota as `filter_probe_candidates` (§V30). Empty `pending` ⇒ third clause
    holds whenever the set is already full+diverse (used to stop barren fishing).
    """
    if len(results) < max_results:
        return False
    if _distinct_offer_hosts(results) < k_hosts:
        return False
    improvers = filter_probe_candidates(
        pending, results, product, max_results=max_results, k_hosts=k_hosts
    )
    return len(improvers) == 0


def probe_budget(slots: int, *, set_full: bool) -> int:
    factor = probe_budget_factor()
    # Hard per-listing cap (Micro). Mid-crawl PDP fan-out traded for top-3 verify
    # (§V30): positions 4–N may include a dead HTML/Woo PDP.
    per_page = _env_int("PROBE_PER_PAGE", 3, min_v=1, max_v=16)
    if set_full:
        return min(per_page, max(factor * 2, factor))
    return min(per_page, max(slots * factor, 4 if slots > 0 else factor))


def verify_top_pdps(
    results: list[dict[str, Any]],
    fetch_pool: _FetchPool,
    product: str,
    *,
    k: int = 3,
) -> int:
    """Probe the best-k retained PDPs; drop hard-dead URLs. Returns removals.

    Compensates for skipping mid-crawl VTEX API probes — only the visible top
    pays RTT (typically 3 GETs).
    """
    if not results:
        return 0
    ranked = sorted(results, key=lambda o: _probe_sort_key(o, product))
    top = ranked[:k]
    urls = [o["url"] for o in top if isinstance(o.get("url"), str)]
    if not urls:
        return 0
    alive = fetch_pool.probe_many(urls)
    dead = {u for u, ok in alive.items() if ok is False}
    if not dead:
        return 0
    before = len(results)
    results[:] = [o for o in results if o.get("url") not in dead]
    removed = before - len(results)
    if removed:
        log.info("top-%s PDP verify dropped %s dead urls for %r", k, removed, product)
    return removed


_offer_cache = OfferCache(
    max_offers_per_host=_env_int("OFFER_CACHE_MAX_OFFERS", 30, min_v=4, max_v=60),
    max_hosts=_env_int("OFFER_CACHE_MAX_HOSTS", 64, min_v=4, max_v=128),
)


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


def fetch_max_bytes() -> int:
    """Hard body size cap (§V33) — Micro OOM defense."""
    return _env_int("FETCH_MAX_BYTES", 2_000_000, min_v=64_000, max_v=8_000_000)


def _page_body_text(page: Any) -> str:
    body = getattr(page, "body", None)
    max_b = fetch_max_bytes()
    if isinstance(body, bytes):
        if len(body) > max_b:
            body = body[:max_b]
        return body.decode("utf-8", errors="replace")
    if body is None:
        return ""
    text = str(body)
    if len(text) > max_b:
        return text[:max_b]
    return text


def _page_status(page: Any) -> int:
    status = getattr(page, "status", None) or getattr(page, "status_code", 200)
    return int(status) if isinstance(status, int) else 200


def victim_index(
    results: list[dict[str, Any]],
    incoming: dict[str, Any],
    *,
    k_hosts: int = 4,
) -> int | None:
    """Index to replace under cap, or None to drop incoming (§V30).

    Total order for victim: (1) same-host surplus worst price, (2) worst price overall.
    Incoming wins if cheaper than victim (or adds a new host while over host-dup).
    """
    if not results:
        return None
    in_price = _offer_price(incoming)
    in_host = _offer_host(incoming)
    # Prefer evicting a duplicate host on the incoming's host if count>1, else any host with count>1
    host_counts: dict[str, int] = {}
    for o in results:
        h = _offer_host(o)
        host_counts[h] = host_counts.get(h, 0) + 1

    def worse(a: int, b: int) -> bool:
        return _offer_price(results[a]) > _offer_price(results[b])

    victim: int | None = None
    # 1) Same host as incoming if that host already present
    if in_host and host_counts.get(in_host, 0) >= 1:
        for i, o in enumerate(results):
            if _offer_host(o) != in_host:
                continue
            if victim is None or worse(i, victim):
                victim = i
    # 2) Else any host with surplus duplicates
    if victim is None:
        for i, o in enumerate(results):
            h = _offer_host(o)
            if host_counts.get(h, 0) <= 1:
                continue
            if victim is None or worse(i, victim):
                victim = i
    # 3) Else most expensive overall
    if victim is None:
        victim = 0
        for i in range(1, len(results)):
            if worse(i, victim):
                victim = i

    # Keep K hosts: if replacing would drop below K and incoming doesn't add a new host, refuse
    hosts_now = { _offer_host(o) for o in results if _offer_host(o) }
    victim_host = _offer_host(results[victim])
    hosts_after = set(hosts_now)
    hosts_after.discard(victim_host)
    if in_host:
        hosts_after.add(in_host)
    if len(hosts_now) >= k_hosts and len(hosts_after) < k_hosts:
        # Only allow if incoming is strictly cheaper than victim (still may drop host — prefer price)
        if in_price >= _offer_price(results[victim]):
            return None

    if in_price < _offer_price(results[victim]):
        return victim
    return None


def crawl_deadline_s() -> float:
    return float(_env_int("CRAWL_DEADLINE_S", 30, min_v=5, max_v=120))


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

    def __init__(self, max_workers: int | None = None) -> None:
        workers = max_workers if max_workers is not None else fetch_workers()
        limits = fetch_limits()
        self._ex = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="crawl"
        )
        self._sems = {kind: threading.Semaphore(n) for kind, n in limits.items()}
        self._managers: list[FetcherSession] = []
        self._session_q: queue.Queue[Any] = queue.Queue()
        for _ in range(workers):
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
        self._worker_count = workers

    def submit(self, url: str) -> Any:
        kind = _fetch_kind(url)
        sem = self._sems[kind]

        def _wrapped() -> PageFetch:
            with sem:
                session = self._session_q.get()
                try:
                    return self._fetch(url, session)
                finally:
                    self._session_q.put(session)

        return self._ex.submit(_wrapped)

    def fetch_one(self, url: str, timeout_s: float) -> tuple[str, str] | None:
        """Synchronous single fetch with a custom timeout (sitemap probes)."""
        session = self._session_q.get()
        try:
            try:
                page = session.get(url, timeout=timeout_s, retries=0)
            except Exception:  # noqa: BLE001
                return None
            if page is None:
                return None
            status = _page_status(page)
            text = _page_body_text(page)
            if status >= 400 or len(text) < 40:
                return None
            final = getattr(page, "url", None) or url
            return str(final), text
        finally:
            self._session_q.put(session)

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
        workers = min(
            probe_workers(),
            len(unique),
            max(1, self._session_q.qsize() or self._worker_count),
        )
        with ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="probe"
        ) as pool:
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

    def _stealth_fetch(self, url: str) -> PageFetch | None:
        """One-shot StealthyFetcher retry (browser). Requires scrapling install locally."""
        t0 = time.perf_counter()
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
            elapsed = time.perf_counter() - t0
            if page is None:
                return None
            status = _page_status(page)
            text = _page_body_text(page)
            if status >= 400:
                return PageFetch(url, "", status=status, reason="http_error", elapsed_s=elapsed)
            if len(text) < 40 or looks_like_challenge(text):
                return PageFetch(
                    url,
                    text,
                    status=status,
                    reason="challenge" if looks_like_challenge(text) else "empty",
                    elapsed_s=elapsed,
                )
            final = getattr(page, "url", None) or url
            return PageFetch(str(final), text, status=status, reason="ok", elapsed_s=elapsed)
        except Exception as exc:  # noqa: BLE001
            log.warning("stealth fetch failed %s: %s", url, exc)
            return PageFetch(
                url, "", status=0, reason="timeout", elapsed_s=time.perf_counter() - t0
            )

    def _fetch(self, url: str, session: Any) -> PageFetch:
        """Fetch one URL; always returns PageFetch with classified reason (§V34)."""
        kind = _fetch_kind(url)
        host = host_of(url)
        t0 = time.perf_counter()
        if host in self._blacklisted_hosts:
            log.info("skip blacklisted host: %s", host)
            return PageFetch(url, "", reason="blacklist", elapsed_s=0.0)
        try:
            page = session.get(url, timeout=FETCH_TIMEOUT_S[kind])
            elapsed = time.perf_counter() - t0
            if page is None:
                return PageFetch(url, "", reason="timeout", elapsed_s=elapsed)
            status = _page_status(page)
            text = _page_body_text(page)
            is_challenge = looks_like_challenge(text) if text else False
            needs_stealth = status >= 403 or is_challenge

            if needs_stealth:
                self._note_challenge(host)
                if self._stealth_enabled and self._consume_stealth_budget():
                    log.info(
                        "stealth retry (%s): %s",
                        status if status >= 403 else "challenge",
                        url,
                    )
                    stealth = self._stealth_fetch(url)
                    if stealth is not None and stealth.ok:
                        self._reset_challenge(host)
                        return stealth
                elif is_challenge:
                    log.info("challenge skip: %s", url)
                reason = "challenge" if is_challenge else "http_error"
                return PageFetch(url, text, status=status, reason=reason, elapsed_s=elapsed)

            if status >= 400:
                return PageFetch(url, text, status=status, reason="http_error", elapsed_s=elapsed)
            if len(text) < 40:
                return PageFetch(url, text, status=status, reason="empty", elapsed_s=elapsed)

            self._reset_challenge(host)
            final = getattr(page, "url", None) or url
            return PageFetch(str(final), text, status=status, reason="ok", elapsed_s=elapsed)
        except Exception as exc:  # noqa: BLE001
            log.warning("fetch failed %s: %s", url, exc)
            return PageFetch(
                url, "", reason="timeout", elapsed_s=time.perf_counter() - t0
            )


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
    probe_attempted: dict[str, int] = defaultdict(int)
    probe_published: dict[str, int] = defaultdict(int)
    ml_via_api = False
    blocked_ml = False
    yield_tracker = HostYieldTracker(category_for(product))

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

    def absorb_cached(host: str) -> bool:
        """Reuse fresh cached offers for a host; True when enough were added to skip fetch.

        Relevance-filtered on reuse, so a cache populated by "iphone 16" also
        serves "iphone 16 128gb" (host-keyed cache, query-agnostic).
        """
        cached = _offer_cache.get(host)
        if cached is None:
            return False
        added = 0
        for offer in cached:
            u = offer.get("url")
            name = offer.get("name")
            if not isinstance(u, str) or u in seen_urls:
                continue
            if not is_publishable(u):
                continue
            if "mercadolibre" in host_of(u):
                continue
            if not isinstance(name, str) or not is_relevant_result(name, product):
                continue
            seen_urls.add(u)
            results.append(offer)
            added += 1
            emit_offer(offer)
            emit_progress(nodes_visited=len(visited), results_found=len(results))
        if added > 0:
            # Cache hit counts as productive so barren peers can be cut (§V34).
            yield_tracker.record_fetch(host, offers=added, reason="offers", elapsed_s=0.0)
        return added >= CACHE_SKIP_FETCH_THRESHOLD

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
    # ML solo si el caller lo pide AND hay token (§C INCLUDE_ML). Token solo
    # no alcanza: si no, INCLUDE_ML=0 en Micro/bench nunca apagaría la API.
    want_ml = include_ml and meli_token_configured()
    ml_cap = max(1, int(max_results * 0.5))
    ml_pool: ThreadPoolExecutor | None = None
    ml_future: Any = None
    if want_ml:
        ml_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ml")
        ml_future = ml_pool.submit(search_mla, product, limit=min(50, ml_cap * 3))
    elif include_ml:
        log.info(
            "include_ml pedido pero MELI_ACCESS_TOKEN ausente — skip ML (no HTML scrape)"
        )

    # ⊥ HTML ML seeds — API only. SERP + VTEX discovery for the rest.
    seeds = build_seed_urls(product, include_ml=False)
    crawl_queue: deque[tuple[str, int]] = deque()
    for u in seeds:
        host = host_of(u)
        if host and absorb_cached(host):
            continue  # host con ofertas frescas relevantes — no re-crawlear
        crawl_queue.append((u, 0))
    known_origins: set[str] = set()
    pages_fetched = 0
    max_depth_reached = 0
    fetch_pool = _FetchPool()

    # Sitemap discovery (background): product URLs from non-VTEX curated shops
    # in the product's category. Enqueued as they arrive; never blocks the crawl.
    sitemap_pending: list[str] = []
    sitemap_lock = threading.Lock()

    def sitemap_worker() -> None:
        for host in sitemap_candidate_hosts(product):
            urls = sitemap_product_urls(
                host,
                lambda u: fetch_pool.fetch_one(u, SITEMAP_FETCH_TIMEOUT_S),
            )
            with sitemap_lock:
                sitemap_pending.extend(urls)

    if sitemap_candidate_hosts(product):
        threading.Thread(target=sitemap_worker, daemon=True, name="sitemap").start()

    def enqueue(url: str, depth: int) -> None:
        if depth > max_depth:
            return
        if url in visited:
            return
        host = host_of(url)
        if "mercadolibre" in host:
            return  # never crawl ML HTML
        # SERP hubs are never yield-cut; shop hosts may be (§V34).
        if host and not is_serp(url) and not yield_tracker.should_enqueue(host):
            return
        # Once retained set is satisfied (cupo+≥K+no improver), do not fish brand-new barren hosts.
        if (
            host
            and not is_serp(url)
            and is_retained_set_satisfied(
                results, [], product, max_results=max_results, k_hosts=4
            )
            and host not in yield_tracker.productive_hosts()
            and yield_tracker.stats_for(host).fetches == 0
        ):
            return
        crawl_queue.append((url, depth))

    def expand_origin(url: str, depth: int) -> None:
        if not is_publishable(url):
            return
        host = host_of(url)
        if "mercadolibre" in host:
            return
        if host and not yield_tracker.should_enqueue(host):
            return
        if (
            host
            and is_retained_set_satisfied(
                results, [], product, max_results=max_results, k_hosts=4
            )
            and host not in yield_tracker.productive_hosts()
        ):
            return
        try:
            origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        except Exception:
            return
        if origin in known_origins:
            return
        known_origins.add(origin)
        if host and absorb_cached(host):
            return  # host con ofertas frescas relevantes — no re-crawlear
        canonical = curated_search_url(host, product)
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
            if isinstance(name, str) and not is_relevant_result(name, product):
                continue
            if ml_count >= ml_cap:  # §V17: cap ML es por oferta ML, no total
                break
            seen_urls.add(u)
            results.append(offer)
            ml_count += 1
            ml_via_api = True
            emit_offer(offer)
            emit_progress(nodes_visited=len(visited), results_found=len(results))

    def _search_satisfied(pending: list[dict[str, Any]] | None = None) -> bool:
        """Cupo lleno ∧ ≥K hosts ∧ no pending improver (tier, precio) — §V30."""
        return is_retained_set_satisfied(
            results,
            pending if pending is not None else [],
            product,
            max_results=max_results,
            k_hosts=4,
        )

    def _prune_queue_host(host: str) -> None:
        if not host:
            return
        kept = deque((u, d) for u, d in crawl_queue if host_of(u) != host)
        crawl_queue.clear()
        crawl_queue.extend(kept)

    def _prune_queue_untried_barren() -> None:
        """Drop queued URLs for hosts never fetched and not productive (satisfied mode)."""
        productive = yield_tracker.productive_hosts()
        kept: deque[tuple[str, int]] = deque()
        for u, d in crawl_queue:
            if is_serp(u):
                kept.append((u, d))
                continue
            h = host_of(u)
            if not h or h in productive:
                kept.append((u, d))
                continue
            if yield_tracker.stats_for(h).fetches > 0 and not yield_tracker.is_cut(h):
                kept.append((u, d))  # mid-streak — let streak finish
                continue
            # untried barren or already cut → drop
        crawl_queue.clear()
        crawl_queue.extend(kept)

    def take_batch() -> list[tuple[str, int]]:
        batch: list[tuple[str, int]] = []
        size = batch_size()
        satisfied = _search_satisfied([])
        if satisfied:
            _prune_queue_untried_barren()
        while crawl_queue and len(batch) < size and len(visited) < max_nodes:
            url, d = crawl_queue.popleft()
            if url in visited:
                continue
            host = host_of(url)
            if host and not is_serp(url) and not yield_tracker.should_enqueue(host):
                continue  # drop queued URLs for cut hosts
            if (
                satisfied
                and host
                and not is_serp(url)
                and host not in yield_tracker.productive_hosts()
                and yield_tracker.stats_for(host).fetches == 0
            ):
                continue
            visited.add(url)
            batch.append((url, d))
        return batch

    def launch_batch(batch: list[tuple[str, int]]) -> dict[Any, str]:
        """Fire the batch's fetches without waiting (pipeline: next batch fetches
        while the current one parses + probes)."""
        return {fetch_pool.submit(url): url for url, _d in batch}

    def _record_host_fetch(
        self_url: str,
        *,
        offers: int,
        reason: OutcomeReason,
        elapsed_s: float,
    ) -> None:
        if is_serp(self_url):
            return
        host = host_of(self_url)
        if not host:
            return
        # After retained set is locked, cut barren peers on the first empty/error.
        streak_override = 1 if _search_satisfied([]) else None
        cut = yield_tracker.record_fetch(
            host,
            offers=offers,
            reason=reason,
            elapsed_s=elapsed_s,
            streak_override=streak_override,
        )
        if cut:
            log.info(
                "host yield cut host=%s reason=%s product=%r",
                host,
                cut,
                product,
            )
            _prune_queue_host(host)

    def process_batch(batch: list[tuple[str, int]], futures: dict[Any, str]) -> None:
        nonlocal pages_fetched, max_depth_reached
        if not batch:
            return
        fetched_by_url: dict[str, PageFetch | None] = {}
        for fut in as_completed(futures):
            url = futures[fut]
            try:
                fetched_by_url[url] = fut.result()
            except Exception:  # noqa: BLE001
                fetched_by_url[url] = PageFetch(url, "", reason="timeout")

        for url, depth in batch:
            max_depth_reached = max(max_depth_reached, depth)
            fetched = fetched_by_url.get(url)
            if fetched is None:
                _record_host_fetch(url, offers=0, reason="timeout", elapsed_s=0.0)
                continue
            if not fetched.ok:
                fail_reason: OutcomeReason
                if fetched.reason in ("http_error", "timeout", "challenge", "empty"):
                    fail_reason = fetched.reason  # type: ignore[assignment]
                else:
                    fail_reason = "http_error"
                _record_host_fetch(
                    url,
                    offers=0,
                    reason=fail_reason,
                    elapsed_s=fetched.elapsed_s,
                )
                continue
            final_url, body = fetched.final_url, fetched.body
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
                if not isinstance(name, str) or not is_relevant_result(name, product):
                    continue
                offer["depth"] = depth
                candidates.append(offer)

            _record_host_fetch(
                url,
                offers=len(candidates),
                reason="offers" if candidates else "empty",
                elapsed_s=fetched.elapsed_s,
            )

            if not candidates:
                if not is_serp(url) and not _search_satisfied([]):
                    expand_origin(final_url, depth + 1)
                continue

            # Gate already applied above. Sort strong-tier then cheapest; skip
            # same-host probes that cannot beat the retained worst price.
            slots = max(0, max_results - len(results))
            set_full = len(results) >= max_results
            # Snapshot pre-filter for satisfied check (improver cota §V30).
            pending_before_filter = list(candidates)
            candidates.sort(key=lambda o: _probe_sort_key(o, product))
            candidates = filter_probe_candidates(
                candidates, results, product, max_results=max_results, k_hosts=4
            )
            budget = probe_budget(slots, set_full=set_full)
            shortlist = candidates[:budget]

            need_probe = [c for c in shortlist if _needs_pdp_probe(c)]
            skip_probe = [c for c in shortlist if not _needs_pdp_probe(c)]
            # Mid-crawl PDP skip only when retained set is locked (§V30).
            if _search_satisfied(pending_before_filter):
                skip_probe = list(shortlist)
                need_probe = []
            probe_attempted[host_of(final_url) or "unknown"] += len(need_probe)
            alive_map = fetch_pool.probe_many(
                [c["url"] for c in need_probe if isinstance(c.get("url"), str)]
            )
            # VTEX API rows: treat as alive without PDP RTT.
            for c in skip_probe:
                u = c.get("url")
                if isinstance(u, str):
                    alive_map[u] = True

            to_probe = shortlist
            added: list[dict[str, Any]] = []
            for offer in to_probe:
                u = offer.get("url")
                if not isinstance(u, str) or u in seen_urls:
                    continue
                if alive_map.get(u, True) is False:
                    seen_urls.add(u)  # remember dead — don't re-queue
                    continue
                if len(results) < max_results:
                    seen_urls.add(u)
                    results.append(offer)
                    added.append(offer)
                    explore_offer(offer)
                    emit_offer(offer)
                    emit_progress(nodes_visited=len(visited), results_found=len(results))
                    continue
                # Cap full: keep/replace by price (§V30)
                vi = victim_index(results, offer, k_hosts=4)
                if vi is None:
                    continue
                old = results[vi]
                old_u = old.get("url")
                if isinstance(old_u, str):
                    seen_urls.discard(old_u)
                seen_urls.add(u)
                results[vi] = offer
                added.append(offer)
                explore_offer(offer)
                emit_offer(offer)
                emit_progress(nodes_visited=len(visited), results_found=len(results))

            if added:
                h = host_of(final_url) or "unknown"
                probed_urls = {
                    c["url"] for c in need_probe if isinstance(c.get("url"), str)
                }
                probe_published[h] += sum(
                    1 for o in added if o.get("url") in probed_urls
                )
                # Verified offers go to the shared cache for future similar searches.
                if h and h != "unknown":
                    _offer_cache.add(h, added)

            if not is_serp(url) and not _search_satisfied([]):
                expand_origin(final_url, depth + 1)

    deadline = started + crawl_deadline_s()

    try:
        batch = take_batch()
        futures = launch_batch(batch) if batch else {}

        while (
            (batch or crawl_queue)
            and len(visited) < max_nodes
            and time.time() < deadline
        ):
            # Sitemap discovery URLs (background worker) get enqueued as they arrive.
            with sitemap_lock:
                for u in sitemap_pending:
                    enqueue(u, 1)
                sitemap_pending.clear()

            # Pipeline: fire the next batch's fetches while the current one
            # parses + probes (probe latency overlaps the next fetch round-trip).
            next_batch = take_batch()
            next_futures = launch_batch(next_batch) if next_batch else {}

            process_batch(batch, futures)

            batch = next_batch
            futures = next_futures

            # Retained-set locked: no productive/SERP work left → stop fishing barren.
            if _search_satisfied([]):
                _prune_queue_untried_barren()
                has_useful = any(
                    is_serp(u) or host_of(u) in yield_tracker.productive_hosts()
                    for u, _d in crawl_queue
                )
                batch_useful = any(
                    is_serp(u) or host_of(u) in yield_tracker.productive_hosts()
                    for u, _d in batch
                )
                if not has_useful and not batch_useful:
                    break

            # Early-stop: cupo lleno + ≥4 hosts + queue only HTML → drain API batch then exit.
            # Keep crawling while API seeds remain (price discovery).
            if (
                len(results) >= max_results
                and _distinct_offer_hosts(results) >= 4
                and _queue_only_html_for_expanded(crawl_queue, known_origins)
            ):
                api_only: list[tuple[str, int]] = []
                size = batch_size()
                while crawl_queue:
                    url, d = crawl_queue.popleft()
                    if _fetch_kind(url) != "api" or url in visited:
                        continue
                    if len(visited) >= max_nodes or len(api_only) >= size:
                        continue
                    visited.add(url)
                    api_only.append((url, d))
                if api_only:
                    process_batch(api_only, launch_batch(api_only))
                break
            # Soft stop when full and no queue left
            if len(results) >= max_results and not crawl_queue and not batch:
                break

        # Top-3 PDP verify before pool shutdown (covers VTEX API skip).
        verify_top_pdps(results, fetch_pool, product, k=3)
    finally:
        fetch_pool.shutdown()

    # ML se absorbe al final (cap aparte, nunca bloquea el primer resultado).
    if ml_future is not None:
        ml_absorb()

    yield_tracker.flush_to_registry()
    yield_summary = yield_tracker.summary()
    if yield_summary["cut"]:
        log.info(
            "host yield summary product=%r cut=%s productive=%s",
            product,
            yield_summary["cut"],
            yield_summary["productive"],
        )

    elapsed_ms = int((time.time() - started) * 1000)
    probed_n = sum(probe_attempted.values())
    published_n = sum(probe_published.values())
    yield_pct = round(100.0 * published_n / probed_n, 1) if probed_n else None
    if probed_n:
        log.info(
            "probe yield queried=%s attempted=%s published=%s yieldPct=%s byHost=%s",
            product,
            probed_n,
            published_n,
            yield_pct,
            dict(probe_attempted),
        )
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
            "probeAttempted": probed_n,
            "probePublished": published_n,
            "probeYieldPct": yield_pct,
            "probeByHost": dict(probe_attempted),
            "hostYield": yield_summary,
        },
        "mlBlocked": blocked_ml,
        "mlViaApi": ml_via_api,
    }
