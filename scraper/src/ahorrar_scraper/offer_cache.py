"""TTL cache of verified offers per host (query-agnostic).

Why host-only keys: "iphone 16" and "iphone 16 128gb" normalize to different
query keys, so a (host, query) cache would never reuse between similar
searches. Caching per host and filtering by relevance on reuse lets a new
search instantly reuse fresh offers from shops already crawled for a similar
query (Firecrawl-style index-cache, but scoped to our curated shops).

Offers stored here are already probe-verified (alive) when added; the short
TTL keeps the risk of serving a dead link low.
"""

from __future__ import annotations

import threading
import time
from typing import Any

DEFAULT_TTL_S = 600  # 10 min
MAX_OFFERS_PER_HOST = 30
MAX_HOSTS = 64


class OfferCache:
    """Thread-safe TTL cache of verified offers keyed by host."""

    def __init__(
        self,
        ttl_s: int = DEFAULT_TTL_S,
        max_offers_per_host: int = MAX_OFFERS_PER_HOST,
        max_hosts: int = MAX_HOSTS,
    ) -> None:
        self._ttl_s = ttl_s
        self._max_offers_per_host = max_offers_per_host
        self._max_hosts = max_hosts
        self._entries: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._lock = threading.Lock()

    def get(self, host: str) -> list[dict[str, Any]] | None:
        """Fresh verified offers for a host, or None when stale/missing."""
        if not host:
            return None
        with self._lock:
            entry = self._entries.get(host)
            if entry is None:
                return None
            ts, offers = entry
            if time.monotonic() - ts > self._ttl_s:
                self._entries.pop(host, None)
                return None
            return [dict(o) for o in offers]

    def add(self, host: str, offers: list[dict[str, Any]]) -> None:
        """Merge offers into the host entry, dedup by URL, cap per host (FIFO)."""
        if not host or not offers:
            return
        with self._lock:
            if host not in self._entries and len(self._entries) >= self._max_hosts:
                oldest = min(self._entries, key=lambda h: self._entries[h][0])
                self._entries.pop(oldest, None)
            ts, existing = self._entries.get(host, (0.0, []))
            seen = {o.get("url") for o in existing}
            merged = list(existing)
            for offer in offers:
                url = offer.get("url")
                if not isinstance(url, str) or url in seen:
                    continue
                seen.add(url)
                merged.append(dict(offer))
            self._entries[host] = (
                time.monotonic(),
                merged[-self._max_offers_per_host :],
            )

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._entries)
