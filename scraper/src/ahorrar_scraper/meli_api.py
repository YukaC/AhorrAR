"""MercadoLibre official API client (MLA).

Primary ML strategy (post-eval): OAuth Bearer on /sites/MLA/search.
No token → skip (do NOT scrape HTML listado).
Env: MELI_ACCESS_TOKEN (required), MELI_SITE_ID=MLA (optional).
"""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger("ahorrar.meli")

SITE = os.environ.get("MELI_SITE_ID", "MLA").strip() or "MLA"


def meli_token_configured() -> bool:
    return bool(os.environ.get("MELI_ACCESS_TOKEN", "").strip())


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


def search_mla(query: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """GET /sites/{SITE}/search with Bearer. Returns offer dicts or []."""
    token = os.environ.get("MELI_ACCESS_TOKEN", "").strip()
    if not token:
        log.info("MELI_ACCESS_TOKEN ausente — skip API ML")
        return []

    url = f"https://api.mercadolibre.com/sites/{SITE}/search?q={quote(query.strip())}&limit={limit}"
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.get(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    "User-Agent": "AhorrAR/0.1 (price-compare; contact local)",
                },
            )
    except httpx.HTTPError as exc:
        log.warning("ML API network error: %s", exc)
        return []

    if res.status_code == 401 or res.status_code == 403:
        log.warning("ML API %s — token inválido o app bloqueada", res.status_code)
        return []
    if res.status_code == 429:
        log.warning("ML API 429 rate limit")
        return []
    if res.status_code >= 400:
        log.warning("ML API HTTP %s", res.status_code)
        return []

    try:
        data = res.json()
    except ValueError:
        return []

    items = data.get("results") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    out: list[dict[str, Any]] = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        if item.get("status") not in (None, "active"):
            # some payloads omit status on search hits
            pass
        title = item.get("title")
        price = item.get("price")
        permalink = item.get("permalink")
        if not isinstance(title, str) or not isinstance(permalink, str):
            continue
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        currency = item.get("currency_id") or "ARS"
        if currency != "ARS":
            continue
        hint = _shipping_hint(item.get("shipping") if isinstance(item.get("shipping"), dict) else None)
        if hint is None:
            continue  # §V1 — no shipping signal
        thumb = item.get("thumbnail")
        if isinstance(thumb, str):
            thumb = thumb.replace("http:", "https:")
        else:
            thumb = None
        nick = None
        seller = item.get("seller")
        if isinstance(seller, dict):
            nick = seller.get("nickname")
        out.append(
            {
                "name": title.strip(),
                "price": float(price),
                "currency": "ARS",
                "url": permalink,
                "image": thumb,
                "shippingHint": hint,
                "store": {
                    "name": f"ML · {nick}" if nick else "MercadoLibre",
                    "logo": None,
                    "local": True,
                    "siteUrl": "https://www.mercadolibre.com.ar",
                },
                "depth": 0,
                "sourceUrl": url,
            }
        )
    return out
