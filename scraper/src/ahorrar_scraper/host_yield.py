"""Per-search host yield cut + in-memory (host, category) outcomes (§V34).

Within one crawl: stop enqueueing a barren/failing host after N consecutive
empty/error fetches, or when its fetch-time budget is exhausted. Hosts that
already produced offers are never cut. If fewer than K productive hosts exist,
do not cut further (preserve variety seeking).

Across searches: append compact outcomes to an in-memory registry so a later
`degraded` pass can count repeated empties without a second mechanism.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Literal

OutcomeReason = Literal[
    "offers",
    "empty",
    "http_error",
    "timeout",
    "challenge",
    "budget",
]


def _env_int(name: str, default: int, *, min_v: int = 1, max_v: int = 256) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        n = int(raw)
    except ValueError:
        return default
    return max(min_v, min(max_v, n))


def _env_float(name: str, default: float, *, min_v: float = 0.5, max_v: float = 120.0) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        n = float(raw)
    except ValueError:
        return default
    return max(min_v, min(max_v, n))


def host_empty_streak() -> int:
    """Consecutive empty/error fetches before cutting a host (default 2)."""
    return _env_int("HOST_EMPTY_STREAK", 2, min_v=1, max_v=8)


def host_budget_s() -> float:
    """Max cumulative fetch seconds per host in one search (default 8)."""
    return _env_float("HOST_BUDGET_S", 8.0, min_v=1.0, max_v=60.0)


def host_min_productive() -> int:
    """Do not cut barren hosts while productive count is below this floor.

    Distinct from V30 retain-K (4): cut-floor defaults to 2 so queries with
    only 3 live shops (e.g. iphone) can still drop proven-empty peers.
    """
    return _env_int("HOST_MIN_PRODUCTIVE", 2, min_v=1, max_v=16)


@dataclass
class HostFetchStats:
    fetches: int = 0
    offers: int = 0
    consecutive_bad: int = 0
    spent_s: float = 0.0
    cut_reason: str | None = None
    last_reason: str | None = None


@dataclass(frozen=True)
class HostSearchOutcome:
    host: str
    category: str
    offers: int
    fetches: int
    reason: OutcomeReason
    at: float = field(default_factory=time.time)


# Recent outcomes per (host, category) — degraded/recheck will read this later.
_REGISTRY_MAX = 32
_outcome_registry: dict[tuple[str, str], deque[HostSearchOutcome]] = defaultdict(
    lambda: deque(maxlen=_REGISTRY_MAX)
)
_registry_lock = threading.Lock()


def clear_outcome_registry() -> None:
    """Test helper."""
    with _registry_lock:
        _outcome_registry.clear()


def outcome_registry_snapshot() -> dict[tuple[str, str], list[HostSearchOutcome]]:
    with _registry_lock:
        return {k: list(v) for k, v in _outcome_registry.items()}


def _classify_search_reason(stats: HostFetchStats) -> OutcomeReason:
    if stats.offers > 0:
        return "offers"
    if stats.cut_reason == "budget":
        return "budget"
    if stats.last_reason in ("http_error", "timeout", "challenge", "empty", "budget"):
        return stats.last_reason  # type: ignore[return-value]
    return "empty"


class HostYieldTracker:
    """Mutable per-search state: record fetches, decide cuts, flush to registry."""

    def __init__(
        self,
        category: str,
        *,
        empty_streak: int | None = None,
        budget_s: float | None = None,
        min_productive: int | None = None,
    ) -> None:
        self.category = category
        self.empty_streak = empty_streak if empty_streak is not None else host_empty_streak()
        self.budget_s = budget_s if budget_s is not None else host_budget_s()
        self.min_productive = (
            min_productive if min_productive is not None else host_min_productive()
        )
        self._hosts: dict[str, HostFetchStats] = {}

    def stats_for(self, host: str) -> HostFetchStats:
        if host not in self._hosts:
            self._hosts[host] = HostFetchStats()
        return self._hosts[host]

    def productive_hosts(self) -> set[str]:
        return {h for h, s in self._hosts.items() if s.offers > 0}

    def is_cut(self, host: str) -> bool:
        if not host:
            return False
        return self._hosts.get(host, HostFetchStats()).cut_reason is not None

    def should_enqueue(self, host: str) -> bool:
        """False when this host is cut for the remainder of the search."""
        if not host:
            return True
        return not self.is_cut(host)

    def _can_cut_more(self) -> bool:
        return len(self.productive_hosts()) >= self.min_productive

    def _try_cut(self, host: str, reason: str) -> bool:
        stats = self.stats_for(host)
        if stats.offers > 0:
            return False  # productive host never cut
        if stats.cut_reason is not None:
            return False
        if not self._can_cut_more():
            return False
        stats.cut_reason = reason
        return True

    def record_fetch(
        self,
        host: str,
        *,
        offers: int,
        reason: OutcomeReason,
        elapsed_s: float = 0.0,
        streak_override: int | None = None,
    ) -> str | None:
        """Update counters. Returns cut_reason if this call newly cut the host.

        `streak_override` lowers the empty streak (e.g. 1 once the search is
        already satisfied) without mutating the tracker defaults.
        """
        if not host:
            return None
        stats = self.stats_for(host)
        if stats.cut_reason is not None:
            return None

        stats.fetches += 1
        stats.spent_s += max(0.0, elapsed_s)
        stats.last_reason = reason
        if offers > 0:
            stats.offers += offers
            stats.consecutive_bad = 0
            return None

        stats.consecutive_bad += 1
        streak = streak_override if streak_override is not None else self.empty_streak

        if stats.spent_s >= self.budget_s and self._try_cut(host, "budget"):
            return "budget"
        if stats.consecutive_bad >= streak and self._try_cut(
            host, reason if reason != "offers" else "empty"
        ):
            return stats.cut_reason
        return None

    def preempt_barren(self, hosts: set[str], reason: str = "empty") -> list[str]:
        """Cut listed barren hosts if the productive floor allows. Returns newly cut."""
        newly: list[str] = []
        for host in hosts:
            if not host or self.is_cut(host):
                continue
            stats = self.stats_for(host)
            if stats.offers > 0:
                continue
            if self._try_cut(host, reason):
                newly.append(host)
        return newly

    def summary(self) -> dict[str, Any]:
        by_host: dict[str, dict[str, Any]] = {}
        for host, s in sorted(self._hosts.items()):
            by_host[host] = {
                "fetches": s.fetches,
                "offers": s.offers,
                "spentS": round(s.spent_s, 2),
                "cutReason": s.cut_reason,
                "lastReason": s.last_reason,
            }
        return {
            "category": self.category,
            "productive": sorted(self.productive_hosts()),
            "cut": sorted(h for h, s in self._hosts.items() if s.cut_reason),
            "byHost": by_host,
        }

    def flush_to_registry(self) -> None:
        """Append one outcome per touched host for future degraded logic."""
        now = time.time()
        with _registry_lock:
            for host, stats in self._hosts.items():
                if stats.fetches == 0:
                    continue
                outcome = HostSearchOutcome(
                    host=host,
                    category=self.category,
                    offers=stats.offers,
                    fetches=stats.fetches,
                    reason=_classify_search_reason(stats),
                    at=now,
                )
                _outcome_registry[(host, self.category)].append(outcome)
