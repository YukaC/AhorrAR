"""Per-search host yield cut + in-memory (host, category) outcomes (§V34 / §T61).

Within one crawl: stop enqueueing a barren/failing host after N consecutive
empty/error fetches, or when its fetch-time budget is exhausted. Hosts that
already produced offers are never cut. If fewer than K productive hosts exist,
do not cut further (preserve variety seeking).

Across searches: append compact outcomes to an in-memory registry. Hosts with
a barren streak are `degraded` until a **confirmed offers** outcome (hysteresis —
TTL alone does not clear). After `DEGRADED_TTL_S`, a rate-limited passive
recheck may probe the host (`DEGRADED_RECHECK_MAX_PER_HOUR`). Mass-fail guard:
if ≥ ratio of **attempted** hosts in one search are barren (≥ min hosts), skip
writing barren outcomes (local outage). ⊥ mutate `alive` in the index.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Literal

log = logging.getLogger("ahorrar.host_yield")

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
    """Max cumulative fetch seconds per host in one search (default 5)."""
    return _env_float("HOST_BUDGET_S", 5.0, min_v=1.0, max_v=60.0)


def host_min_productive() -> int:
    """Do not cut barren hosts while productive count is below this floor.

    Same floor as V30 retain-K (4): cutting peers before K productive shops
    starves variety (funnel finds 3–4 hosts; Micro used to finish with 1–2).
    """
    return _env_int("HOST_MIN_PRODUCTIVE", 4, min_v=1, max_v=16)


def degraded_empty_streak() -> int:
    """Consecutive non-offer outcomes before skipping a host across searches."""
    return _env_int("DEGRADED_EMPTY_STREAK", 2, min_v=1, max_v=8)


def degraded_ttl_s() -> float:
    """Seconds after the last barren outcome before a passive recheck (re-seed)."""
    return _env_float("DEGRADED_TTL_S", 1800.0, min_v=60.0, max_v=86_400.0)


def degraded_mass_fail_ratio() -> float:
    """If ≥ this fraction of touched hosts are barren in one search, skip degrade.

    Guards against local outages (DNS/red) that would otherwise mark the whole
    index degraded. Default 0.7 (majority).
    """
    return _env_float("DEGRADED_MASS_FAIL_RATIO", 0.7, min_v=0.5, max_v=1.0)


def degraded_recheck_max_per_hour() -> int:
    """Max passive rechecks per (host, category) in a rolling 1h window."""
    return _env_int("DEGRADED_RECHECK_MAX_PER_HOUR", 2, min_v=1, max_v=24)


def degraded_mass_fail_min_hosts() -> int:
    """Minimum touched hosts before the mass-fail guard applies."""
    return _env_int("DEGRADED_MASS_FAIL_MIN_HOSTS", 4, min_v=2, max_v=64)


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

# Passive recheck timestamps per (host, category) — rate-limit re-seeds.
_RECHECK_WINDOW_S = 3600.0
_recheck_times: dict[tuple[str, str], deque[float]] = defaultdict(deque)
# Episodes already counted this TTL-expiry (keyed by last barren `at`).
_recheck_episodes: set[tuple[str, str, float]] = set()


def clear_outcome_registry() -> None:
    """Test helper."""
    with _registry_lock:
        _outcome_registry.clear()
        _recheck_times.clear()
        _recheck_episodes.clear()


def outcome_registry_snapshot() -> dict[tuple[str, str], list[HostSearchOutcome]]:
    with _registry_lock:
        return {k: list(v) for k, v in _outcome_registry.items()}


def is_degraded(
    host: str,
    category: str,
    *,
    now: float | None = None,
    streak: int | None = None,
    ttl_s: float | None = None,
) -> bool:
    """True while recent (host, category) outcomes are a barren streak.

    Hysteresis: TTL alone does **not** clear degraded — only a confirmed offers
    outcome does. Passive recheck after TTL is `may_passive_recheck` (probe
    budget), not an exit from degraded.
    """
    _ = (now, ttl_s)  # call-site compat; time does not clear (hysteresis)
    host = host.replace("www.", "", 1).lower().strip()
    if not host or not category:
        return False
    need = streak if streak is not None else degraded_empty_streak()
    with _registry_lock:
        outcomes = list(_outcome_registry.get((host, category), ()))
    if len(outcomes) < need:
        return False
    recent = outcomes[-need:]
    if any(o.reason == "offers" or o.offers > 0 for o in recent):
        return False
    return True


def may_passive_recheck(
    host: str,
    category: str,
    *,
    now: float | None = None,
    streak: int | None = None,
    ttl_s: float | None = None,
    consume: bool = True,
) -> bool:
    """True when a degraded host may be probed once (TTL expired + budget/h).

    Does not clear degraded — success on that probe (offers flush) does.
    """
    host = host.replace("www.", "", 1).lower().strip()
    if not host or not category:
        return False
    if not is_degraded(host, category, streak=streak):
        return False
    need = streak if streak is not None else degraded_empty_streak()
    ttl = ttl_s if ttl_s is not None else degraded_ttl_s()
    stamp = now if now is not None else time.time()
    with _registry_lock:
        outcomes = list(_outcome_registry.get((host, category), ()))
    if len(outcomes) < need:
        return False
    recent = outcomes[-need:]
    last_at = recent[-1].at
    if stamp - last_at <= ttl:
        return False  # still in cooldown before first probe
    max_rechecks = degraded_recheck_max_per_hour()
    key = (host, category)
    episode = (host, category, last_at)
    with _registry_lock:
        if episode in _recheck_episodes:
            return True  # already granted this barren episode (same search ok)
        times = _recheck_times[key]
        while times and stamp - times[0] > _RECHECK_WINDOW_S:
            times.popleft()
        if len(times) >= max_rechecks:
            return False
        if consume:
            _recheck_episodes.add(episode)
            times.append(stamp)
            if len(_recheck_episodes) > 2048:
                _recheck_episodes.clear()
    return True


def degraded_hosts(
    category: str,
    *,
    now: float | None = None,
) -> set[str]:
    """Hosts to skip this search: degraded and not granted a passive recheck."""
    if not category:
        return set()
    stamp = now if now is not None else time.time()
    out: set[str] = set()
    with _registry_lock:
        keys = [k for k in _outcome_registry if k[1] == category]
    for host, cat in keys:
        if not is_degraded(host, cat, now=stamp):
            continue
        if may_passive_recheck(host, cat, now=stamp, consume=True):
            continue  # probe this search; stay degraded until offers
        out.add(host)
    return out


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

    def apply_degraded_cuts(self, *, now: float | None = None) -> list[str]:
        """Force-cut hosts degraded for this category (cross-search). Bypasses K floor."""
        newly: list[str] = []
        for host in degraded_hosts(self.category, now=now):
            if not host or self.is_cut(host):
                continue
            stats = self.stats_for(host)
            if stats.offers > 0:
                continue
            stats.cut_reason = "degraded"
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
        """Append one outcome per touched host for future degraded logic.

        Mass-fail guard: if a high fraction of touched hosts are barren in the
        same search (local DNS/red outage), skip writing barren outcomes so we
        do not degrade the whole index. Offer outcomes still flush (clear prior
        degraded state for hosts that actually worked).
        """
        now = time.time()
        touched = [(h, s) for h, s in self._hosts.items() if s.fetches > 0]
        if not touched:
            return
        barren_n = sum(1 for _h, s in touched if s.offers == 0)
        min_hosts = degraded_mass_fail_min_hosts()
        ratio = degraded_mass_fail_ratio()
        mass_fail = (
            len(touched) >= min_hosts and (barren_n / len(touched)) >= ratio
        )
        if mass_fail:
            log.info(
                "degraded mass-fail guard category=%s touched=%d barren=%d "
                "ratio=%.2f — skip barren registry (local outage?)",
                self.category,
                len(touched),
                barren_n,
                barren_n / len(touched),
            )
        with _registry_lock:
            for host, stats in touched:
                reason = _classify_search_reason(stats)
                if mass_fail and stats.offers == 0:
                    continue  # do not degrade anyone on mass barren
                outcome = HostSearchOutcome(
                    host=host,
                    category=self.category,
                    offers=stats.offers,
                    fetches=stats.fetches,
                    reason=reason,
                    at=now,
                )
                _outcome_registry[(host, self.category)].append(outcome)
