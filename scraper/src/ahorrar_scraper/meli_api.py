"""MercadoLibre official API client (MLA) — catalog + competitor-item strategy.

Since Apr/2025 the generic /sites/{site}/search is discontinued (403 even with a
valid Bearer, and even anon). The only official text path is the catalog:

  1. GET /products/search?site_id=MLA&status=active&q={q}   → catalog products
  2. GET /products/{product_id}/items?site_id=MLA            → the listings that
     are actually competing on that PDP (200 with `results[]` when competition
     exists; 404 "No winners found" when the product has no active competitors).

Requires the DevCenter functional permission "Publicación y sincronización" =
lectura y escritura (`urn:ml:all:publish-sync:/read-write` on the app, re-consent
the OAuth grant). That permission unblocks products/search + products/{id}/items
(with real `price`, `seller_id`, `seller_address`, `shipping`) and status on the
PDP. Fields still gated behind a validated-seller account (`buy_box_winner`,
`pdp_types`, `/items/{id}`, `sale_price`, `/sites/MLA/search`) are NOT used here —
/products/{id}/items covers price without them.

One rankeable offer per catalog product: the cheapest competing listing
(across the results of /products/{id}/items). Products without competitors (404)
are skipped. §V1: price + country + shipping signal required.
Env: MELI_ACCESS_TOKEN (required), MELI_SITE_ID=MLA (optional).
Auto-refresh on 401 via MELI_REFRESH_TOKEN + APP_ID/SECRET (see meli_auth.py).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import httpx

from .meli_auth import (
    auth_headers,
    meli_token_configured,
    refresh_after_unauthorized,
)

log = logging.getLogger("ahorrar.meli")

API = "https://api.mercadolibre.com"
SITE = os.environ.get("MELI_SITE_ID", "MLA").strip() or "MLA"
CATALOG_URL = f"https://www.mercadolibre.com.ar/p/"

# Fase 0 (§T pending): el N+1 real es 2 llamadas por producto (detail + items),
# ejecutadas en serie. Se paraleliza con ThreadPoolExecutor y un httpx.Client por
# thread (httpx sync client no es thread-safe). Bounded: ML aplica rate limits.
ML_MAX_WORKERS = int(os.environ.get("ML_MAX_WORKERS", "8").strip() or "8")
# Per-request HTTP timeout — must be > ML_JOIN_TIMEOUT_S (default 4) so normal
# slow MLA responses (3–5s, worse on Micro) do not trip V26 circuit breaker.
# On join abandon we close clients (abort_ml_http) so in-flight fails fast;
# cancel-path errors do not record_failure. Default 8s.
ML_REQUEST_TIMEOUT_S = float(
    os.environ.get("ML_REQUEST_TIMEOUT_S", os.environ.get("ML_TIMEOUT_S", "8")).strip()
    or "8"
)
ML_TIMEOUT_S = ML_REQUEST_TIMEOUT_S  # alias (legacy name)

# Circuit breaker: tras N fallos consecutivos de la API, skip ML por cooldown
# (evita golpear una API caída/limitada y acelera búsquedas durante la caída).
ML_CIRCUIT_FAILURES = int(os.environ.get("ML_CIRCUIT_FAILURES", "3").strip() or "3")
ML_CIRCUIT_COOLDOWN_S = float(os.environ.get("ML_CIRCUIT_COOLDOWN_S", "300").strip() or "300")

# Re-export for crawl.py imports
__all__ = [
    "meli_token_configured",
    "search_mla",
    "abort_ml_http",
    "consume_ml_run_stats",
]

# Active httpx clients (search + N+1 workers) so join-timeout can abort in-flight I/O.
_active_clients: list[httpx.Client] = []
_clients_lock = threading.Lock()

# Last search_mla run: cancelled N+1 slots (never started or dropped after stop).
_run_stats_lock = threading.Lock()
_last_run_stats: dict[str, int] = {"cancelled_calls": 0}


def consume_ml_run_stats() -> dict[str, int]:
    """Return and reset per-run ML stats (cancelled_calls)."""
    with _run_stats_lock:
        out = dict(_last_run_stats)
        _last_run_stats["cancelled_calls"] = 0
        return out


def _set_cancelled_calls(n: int) -> None:
    with _run_stats_lock:
        _last_run_stats["cancelled_calls"] = max(0, n)


def _register_client(client: httpx.Client) -> httpx.Client:
    with _clients_lock:
        _active_clients.append(client)
    return client


def _unregister_client(client: httpx.Client) -> None:
    with _clients_lock:
        try:
            _active_clients.remove(client)
        except ValueError:
            pass


def abort_ml_http() -> None:
    """Close in-flight ML httpx clients — stop enqueueing + interrupt sockets.

    Cooperative cancel only: Python threads cannot be killed. An HTTP call that
    already left may still complete within ML_REQUEST_TIMEOUT_S unless the
    socket is closed here; crawl discards that result (ml_joined / late-offer
    policy). Join abandon always closes clients so we do not wait the full
    request timeout after giving up.
    """
    with _clients_lock:
        clients = list(_active_clients)
        _active_clients.clear()
    for client in clients:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass


class _CircuitBreaker:
    """Trip after N consecutive API failures; skip calls while open (cooldown).

    Half-open: when the cooldown expires the next call probes the API again and
    resets on success. Thread-safe (search_mla runs inside crawl workers).
    """

    def __init__(self, threshold: int, cooldown_s: float) -> None:
        self._threshold = max(1, threshold)
        self._cooldown_s = max(1.0, cooldown_s)
        self._failures = 0
        self._open_until = 0.0
        self._lock = threading.Lock()

    def is_open(self) -> bool:
        with self._lock:
            if self._open_until and time.monotonic() >= self._open_until:
                self._open_until = 0.0
                self._failures = 0
                return False
            return self._open_until > 0

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self._threshold:
                self._open_until = time.monotonic() + self._cooldown_s
                log.warning(
                    "ML API circuit OPEN — skip %ss (failures=%d)",
                    self._cooldown_s,
                    self._failures,
                )

    def record_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._open_until = 0.0

    @property
    def failure_count(self) -> int:
        with self._lock:
            return self._failures


_ml_circuit = _CircuitBreaker(ML_CIRCUIT_FAILURES, ML_CIRCUIT_COOLDOWN_S)


def _shipping_hint(shipping: dict[str, Any] | None) -> str | None:
    if not isinstance(shipping, dict):
        return None
    free = bool(shipping.get("free_shipping"))
    mode = str(shipping.get("mode") or "")
    logistic = str(shipping.get("logistic_type") or "")
    if free:
        return "Envío gratis Mercado Envíos"
    if mode in ("me1", "me2") or (logistic and logistic != "not_specified"):
        return "Envío a todo el país Mercado Envíos"
    if logistic == "fulfillment":
        return "Mercado Envíos Full"
    return None


def _picture(pictures: Any) -> str | None:
    if isinstance(pictures, list):
        for pic in pictures:
            if isinstance(pic, dict):
                url = pic.get("url")
                if isinstance(url, str) and url.startswith(("http://", "https://")):
                    return url.replace("http:", "https:")
    return None


def _seller_name(seller_id: int | None) -> str | None:
    return f"ML · vendedor {seller_id}" if seller_id else None


def _offer_from_listings(product_id: str, detail: dict[str, Any], listings: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the cheapest ARS-competitor listing with a shipping signal."""
    best: dict[str, Any] | None = None
    for item in listings:
        if not isinstance(item, dict):
            continue
        price = item.get("price")
        currency = item.get("currency_id")
        if not isinstance(price, (int, float)) or price <= 0 or currency != "ARS":
            continue
        if _shipping_hint(item.get("shipping") if isinstance(item.get("shipping"), dict) else None) is None:
            continue  # §V1 — no shipping signal
        if best is None or price < best["price"]:
            best = item

    name = detail.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    # No ARS competitor with shipping → do not invent price 0 (§V2).
    if best is None:
        return None

    shipping_raw = best.get("shipping") if isinstance(best.get("shipping"), dict) else None
    price = best.get("price")
    if not isinstance(price, (int, float)) or price <= 0:
        return None
    return {
        "name": name.strip(),
        "price": float(price),
        "currency": "ARS",
        "url": f"{CATALOG_URL}{product_id}",
        "image": _picture(detail.get("pictures")),
        "shippingHint": _shipping_hint(shipping_raw),
        "store": {
            "name": _seller_name(best.get("seller_id")) or "MercadoLibre",
            "logo": None,
            "local": True,
            "siteUrl": "https://www.mercadolibre.com.ar",
        },
        "depth": 0,
        "sourceUrl": f"{API}/products/{product_id}/items",
    }


class _ThreadData(threading.local):
    client: httpx.Client | None = None


_thread_data = _ThreadData()


def _thread_client() -> httpx.Client:
    """One httpx.Client per worker thread (sync client is not thread-safe)."""
    local = _thread_data.client
    if local is None or local.is_closed:
        local = _register_client(httpx.Client(timeout=ML_TIMEOUT_S))
        _thread_data.client = local
    return local


def _resolve_product(
    product_id: str,
    pid: str,
    limit_listings: bool,
    headers: dict[str, str],
    stop_event: threading.Event | None = None,
) -> dict[str, Any] | None:
    """Inside one worker thread: detail + items → offer dict, or None."""
    if stop_event is not None and stop_event.is_set():
        return None
    client = _thread_client()
    detail_res = client.get(f"{API}/products/{product_id}", headers=headers)
    if stop_event is not None and stop_event.is_set():
        return None
    listing_res = client.get(
        f"{API}/products/{product_id}/items", params={"site_id": SITE}, headers=headers
    )
    if detail_res.status_code != 200:
        return None
    detail = detail_res.json()
    if listing_res.status_code == 404:
        return None  # no competition — skip por diseño
    if listing_res.status_code != 200:
        return None
    listings = listing_res.json()
    results_list = listings.get("results") if isinstance(listings, dict) else None
    if not isinstance(results_list, list) or not results_list:
        return None
    return _offer_from_listings(str(detail.get("catalog_product_id") or product_id), detail, results_list)


def search_mla(
    query: str,
    *,
    limit: int = 20,
    stop_event: threading.Event | None = None,
) -> list[dict[str, Any]]:
    """Catalog search → cheapest competitor offer per product, or [].

    Fase 0: detail+items por producto se resuelven en paralelo
    (ThreadPoolExecutor, client por thread) en vez de en serie.
    On 401: refresh OAuth once and retry the search.

    Cancel is cooperative (`stop_event` + short per-request timeout +
    `abort_ml_http`). An in-flight HTTP call may still finish within
    ML_REQUEST_TIMEOUT_S; that result is discarded by crawl (explicit policy).
    Cancelled/aborted paths do not trip the circuit breaker. Plain network
    timeouts (no stop_event) still count under §V26 — keep ML_REQUEST_TIMEOUT_S
    above ML_JOIN_TIMEOUT_S so ordinary 3–5s MLA latency does not open the breaker.
    """
    def cancelled() -> bool:
        return stop_event is not None and stop_event.is_set()

    _set_cancelled_calls(0)

    if not meli_token_configured():
        log.info("MELI_ACCESS_TOKEN ausente — skip API ML")
        return []
    if _ml_circuit.is_open():
        log.info("ML API circuit open — skip (cooldown)")
        return []
    if cancelled():
        return []
    search_client = _register_client(httpx.Client(timeout=ML_REQUEST_TIMEOUT_S))
    try:
        headers = auth_headers()
        res = search_client.get(
            f"{API}/products/search",
            params={"site_id": SITE, "status": "active", "q": query.strip(), "limit": min(limit * 2, 50)},
            headers=headers,
        )
        if cancelled():
            log.info("ML search cancelled after products/search — discard")
            return []
        if res.status_code == 401 and refresh_after_unauthorized(401):
            headers = auth_headers()
            res = search_client.get(
                f"{API}/products/search",
                params={"site_id": SITE, "status": "active", "q": query.strip(), "limit": min(limit * 2, 50)},
                headers=headers,
            )
        if cancelled():
            log.info("ML search cancelled — discard")
            return []
        if res.status_code in (401, 403):
            _ml_circuit.record_failure()
            log.warning(
                "ML API %s products/search — token inválido o permiso funcional incompleto",
                res.status_code,
            )
            return []
        if res.status_code == 429:
            _ml_circuit.record_failure()
            log.warning("ML API 429 rate limit products/search")
            return []
        if res.status_code >= 400:
            _ml_circuit.record_failure()
            log.warning("ML API HTTP %s products/search", res.status_code)
            return []
        data = res.json()
        search_results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(search_results, list):
            _ml_circuit.record_failure()
            log.warning("ML API products/search shape inesperado")
            return []
        _ml_circuit.record_success()

        # candidates: (índice del result, product_id canónico, pid original)
        candidates: list[tuple[int, str, str]] = []
        for result in search_results:
            if not isinstance(result, dict):
                continue
            pid = result.get("id")
            if not isinstance(pid, str):
                continue
            canonical = str(result.get("catalog_product_id") or pid)
            candidates.append((len(candidates), canonical, pid))
        candidates = candidates[:limit]

        if cancelled():
            _set_cancelled_calls(len(candidates))
            log.info("ML search cancelled before N+1 — discard")
            return []

        ordered: dict[int, dict[str, Any]] = {}
        no_competition = 0
        submitted = 0
        pool = ThreadPoolExecutor(max_workers=ML_MAX_WORKERS)
        try:
            futures: dict[Any, tuple[int, str]] = {}
            for idx, canonical, _pid in candidates:
                if cancelled():
                    break
                f = pool.submit(
                    _resolve_product, canonical, _pid, False, headers, stop_event
                )
                futures[f] = (idx, canonical)
                submitted += 1
            never_started = len(candidates) - submitted
            for fut in as_completed(futures):
                if cancelled():
                    pending_n = sum(1 for p in futures if not p.done())
                    for pending in futures:
                        pending.cancel()
                    _set_cancelled_calls(never_started + pending_n)
                    log.info(
                        "ML N+1 cancelled — discard partial cancelled_calls=%d "
                        "(policy: late ML dropped; in-flight may finish ≤%.1fs)",
                        never_started + pending_n,
                        ML_REQUEST_TIMEOUT_S,
                    )
                    return []
                idx, canonical = futures[fut]
                try:
                    offer = fut.result()
                except Exception as exc:  # noqa: BLE001
                    if cancelled():
                        _set_cancelled_calls(never_started + 1)
                        return []
                    log.warning("ML product %s error: %s", canonical, exc)
                    continue
                if offer is None:
                    no_competition += 1
                    continue
                ordered[idx] = offer
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        if cancelled():
            _set_cancelled_calls(max(0, len(candidates) - len(ordered)))
            log.info("ML search cancelled — discard")
            return []

        if no_competition:
            log.info(
                "ML API: %d producto(s) sin competencia (404/0 items) — skip por diseño",
                no_competition,
            )

        out = [ordered[idx] for idx in sorted(ordered.keys())]
        if not out:
            log.info("ML API: sin ofertas propagables para %r", query)
        return out
    except httpx.HTTPError as exc:
        if cancelled():
            log.info("ML HTTP aborted by join timeout — discard (no circuit trip)")
            return []
        _ml_circuit.record_failure()
        log.warning("ML API network error: %s", exc)
        return []
    finally:
        _unregister_client(search_client)
        try:
            search_client.close()
        except Exception:  # noqa: BLE001
            pass
