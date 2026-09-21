"""Parse VTEX JSON / generic offer blobs into contract-shaped dicts."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def parse_vtex_catalog(url: str, body: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []

    origin = _origin(url)
    host = urlparse(url).hostname.replace("www.", "") if urlparse(url).hostname else "tienda"
    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    for product in data[:25]:
        if not isinstance(product, dict):
            continue
        name = (product.get("productName") or "").strip()
        if len(name) < 4:
            continue
        items = product.get("items") or []
        item = items[0] if items else {}
        sellers = (item.get("sellers") or [{}])[0]
        offer = sellers.get("commertialOffer") or {}
        price = offer.get("Price") or offer.get("ListPrice")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        qty = offer.get("AvailableQuantity")
        if isinstance(qty, int) and qty <= 0:
            continue

        link = product.get("link")
        slug = product.get("linkText")
        if isinstance(link, str) and link.startswith("http"):
            product_url = link
        elif isinstance(slug, str) and slug:
            product_url = f"{origin}/{slug}/p"
        else:
            continue
        if product_url in seen:
            continue
        seen.add(product_url)

        images = item.get("images") or []
        image = images[0].get("imageUrl") if images else None
        results.append(
            {
                "name": name,
                "price": float(price),
                "currency": "ARS",
                "url": product_url,
                "image": image,
                "shippingHint": "Envío a domicilio",
                "store": {"name": host, "logo": None, "local": True, "siteUrl": origin},
                "depth": 0,
                "sourceUrl": url,
            }
        )
    return results


def parse_ml_api(url: str, body: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []
    items = data.get("results") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    results: list[dict[str, Any]] = []
    for item in items[:25]:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        price = item.get("price")
        permalink = item.get("permalink")
        if not isinstance(title, str) or not isinstance(price, (int, float)) or price <= 0:
            continue
        if not isinstance(permalink, str):
            continue
        shipping = item.get("shipping") or {}
        free = bool(shipping.get("free_shipping"))
        hint = "Envío gratis Mercado Envíos" if free else "Envío a todo el país Mercado Envíos"
        thumb = item.get("thumbnail")
        if isinstance(thumb, str):
            thumb = thumb.replace("http:", "https:")
        nick = (item.get("seller") or {}).get("nickname")
        results.append(
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
    return results


def looks_like_challenge(body: str) -> bool:
    return bool(re.search(r"negative_traffic|suspicious-traffic|account-verification", body, re.I))


def parse_page(url: str, body: str) -> list[dict[str, Any]]:
    if looks_like_challenge(body):
        return []
    if "/api/catalog_system/pub/products/search" in url:
        return parse_vtex_catalog(url, body)
    if "api.mercadolibre.com" in url:
        return parse_ml_api(url, body)
    # Embedded VTEX JSON in HTML
    if '"productName"' in body and '"lowPrice"' in body:
        names = re.findall(r'"productName":"([^"\\]{4,120})"', body)
        prices = re.findall(r'"lowPrice":(\d+(?:\.\d+)?)', body)
        slugs = re.findall(r'"linkText":"([^"\\]+)"', body)
        images = re.findall(r'"imageUrl":"(https?:[^"]+)"', body)
        origin = _origin(url)
        host = urlparse(url).hostname.replace("www.", "") if urlparse(url).hostname else "tienda"
        n = min(len(names), len(prices), len(slugs))
        out = []
        seen: set[str] = set()
        for i in range(n):
            product_url = f"{origin}/{slugs[i]}/p"
            if product_url in seen:
                continue
            seen.add(product_url)
            out.append(
                {
                    "name": names[i].encode().decode("unicode_escape", errors="ignore"),
                    "price": float(prices[i]),
                    "currency": "ARS",
                    "url": product_url,
                    "image": images[i].replace("\\u002F", "/") if i < len(images) else None,
                    "shippingHint": "Envío a domicilio",
                    "store": {"name": host, "logo": None, "local": True, "siteUrl": origin},
                    "depth": 0,
                    "sourceUrl": url,
                }
            )
        return out
    return []
