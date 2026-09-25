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
ML_TIMEOUT_S = float(os.environ.get("ML_TIMEOUT_S", "15").strip() or "15")

# Re-export for crawl.py imports
__all__ = ["meli_token_configured", "search_mla"]


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

    winner = best or {}
    shipping_raw = winner.get("shipping") if isinstance(winner.get("shipping"), dict) else None
    price = winner.get("price")
    return {
        "name": name.strip(),
        "price": float(price) if isinstance(price, (int, float)) else 0.0,
        "currency": "ARS",
        "url": f"{CATALOG_URL}{product_id}",
        "image": _picture(detail.get("pictures")),
        "shippingHint": _shipping_hint(shipping_raw),
        "store": {
            "name": _seller_name(winner.get("seller_id")) or "MercadoLibre",
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
    if local is None:
        local = httpx.Client(timeout=ML_TIMEOUT_S)
        _thread_data.client = local
    return local


def _resolve_product(
    product_id: str, pid: str, limit_listings: bool, headers: dict[str, str]
) -> dict[str, Any] | None:
    """Inside one worker thread: detail + items → offer dict, or None."""
    client = _thread_client()
    detail_res = client.get(f"{API}/products/{product_id}", headers=headers)
    listing_res = client.get(f"{API}/products/{product_id}/items", params={"site_id": SITE}, headers=headers)
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


def search_mla(query: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """Catalog search → cheapest competitor offer per product, or [].

    Fase 0: detail+items por producto se resuelven en paralelo
    (ThreadPoolExecutor, client por thread) en vez de en serie.
    On 401: refresh OAuth once and retry the search.
    """
    if not meli_token_configured():
        log.info("MELI_ACCESS_TOKEN ausente — skip API ML")
        return []
    try:
        with httpx.Client(timeout=ML_TIMEOUT_S) as search_client:
            headers = auth_headers()
            res = search_client.get(
                f"{API}/products/search",
                params={"site_id": SITE, "status": "active", "q": query.strip(), "limit": min(limit * 2, 50)},
                headers=headers,
            )
            if res.status_code == 401 and refresh_after_unauthorized(401):
                headers = auth_headers()
                res = search_client.get(
                    f"{API}/products/search",
                    params={"site_id": SITE, "status": "active", "q": query.strip(), "limit": min(limit * 2, 50)},
                    headers=headers,
                )
            if res.status_code in (401, 403):
                log.warning(
                    "ML API %s products/search — token inválido o permiso funcional incompleto",
                    res.status_code,
                )
                return []
            if res.status_code == 429:
                log.warning("ML API 429 rate limit products/search")
                return []
            if res.status_code >= 400:
                log.warning("ML API HTTP %s products/search", res.status_code)
                return []
            data = res.json()
            search_results = data.get("results") if isinstance(data, dict) else None
            if not isinstance(search_results, list):
                return []

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

            ordered: dict[int, dict[str, Any]] = {}
            no_competition = 0
            with ThreadPoolExecutor(max_workers=ML_MAX_WORKERS) as pool:
                futures: dict[Any, tuple[int, str]] = {}
                for idx, canonical, _pid in candidates:
                    f = pool.submit(_resolve_product, canonical, _pid, False, headers)
                    futures[f] = (idx, canonical)
                for fut in as_completed(futures):
                    idx, canonical = futures[fut]
                    try:
                        offer = fut.result()
                    except Exception as exc:  # noqa: BLE001
                        log.warning("ML product %s error: %s", canonical, exc)
                        continue
                    if offer is None:
                        no_competition += 1
                        continue
                    ordered[idx] = offer

            if no_competition:
                log.info("ML API: %d producto(s) sin competencia (404/0 items) — skip por diseño", no_competition)

            out = [ordered[idx] for idx in sorted(ordered.keys())]
            if not out:
                log.info("ML API: sin ofertas propagables para %r", query)
            return out
    except httpx.HTTPError as exc:
        log.warning("ML API network error: %s", exc)
        return []
    return []
