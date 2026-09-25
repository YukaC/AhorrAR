"""Parse VTEX JSON / generic offer blobs into contract-shaped dicts."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlparse, urlunparse

# Query keys that are search/listing leftovers, not part of the PDP identity.
# Mirrors backend/src/normalize/url.ts TRACKING_KEYS (+ keywords from Venex).
_TRACKING_KEYS = frozenset(
    {
        "fbclid",
        "gclid",
        "twclid",
        "igshid",
        "ref",
        "srsltid",
        "icid",
        "spm",
        "scm",
        "sca_source",
        "ranMID",
        "ranEAID",
        "ranSiteID",
        "tag",
        "linkCode",
        "psc",
        "keywords",  # Venex listing appends ?keywords=… with raw spaces → broken links
    }
)


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def normalize_product_url(raw: str, base: str | None = None) -> str | None:
    """Make offer URLs clickable: absolute, encoded, tracking/query noise stripped.

    Scrapling has no dead-link checker (⊥ HEAD). Broken links here are usually
    malformed hrefs (unencoded spaces in ?keywords=…) rather than missing PDPs.
    """
    text = (raw or "").strip()
    if not text:
        return None
    try:
        if base:
            parsed = urlparse(urljoin(base, text))
        else:
            parsed = urlparse(text)
    except Exception:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    # Re-encode query so spaces / raw “ryzen 5 5600” become valid; drop tracking.
    kept: list[tuple[str, str]] = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key in _TRACKING_KEYS or key.startswith("utm_"):
            continue
        kept.append((key, value))
    query = urlencode(kept, doseq=True)
    # Path may still contain spaces from bad HTML; quote each segment.
    path = "/".join(
        segment if segment in ("", ".") else quote(segment, safe=":@-._~!$&'()*+,;=")
        for segment in parsed.path.split("/")
    )
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", query, ""))


def _is_fravega_host(host: str) -> bool:
    h = host.lower().replace("www.", "", 1)
    return h == "fravega.com" or h.endswith(".fravega.com")


def fravega_pdp_url(origin: str, *, link_text: str | None, product_id: str | None, item_id: str | None) -> str | None:
    """Frávega Next PDP: `/p/{slug}-{itemId}/` (GraphQL `sku(code:)` = VTEX itemId).

    Catalog still emits `link`/`linkText` ending in **productId** and classic
    `/{linkText}/p`. Next redirects that to `/p/{linkText}/` but resolves SKU from
    the trailing digits — productId → empty shell; itemId → live PDP. Keep the
    slug's double-hyphens intact; only swap the trailing id.
    """
    if not isinstance(item_id, str) or not item_id.strip():
        return None
    item_id = item_id.strip()
    slug = (link_text or "").strip().strip("/")
    product_id = product_id.strip() if isinstance(product_id, str) else ""
    if product_id and slug.endswith(f"-{product_id}"):
        slug = f"{slug[: -len(product_id) - 1]}-{item_id}"
    elif slug.endswith(f"-{item_id}"):
        pass  # already the storefront form
    elif slug:
        slug = f"{slug}-{item_id}"
    else:
        return None
    base = origin.rstrip("/")
    return normalize_product_url(f"{base}/p/{slug}/")


def _parse_vtex_installments(offer: dict[str, Any]) -> dict[str, Any] | None:
    """Best installments plan from VTEX commertialOffer.Installments.
    Prefers the plan with the most interest-free installments; else the most
    installments overall. Returns None when the source doesn't expose them."""
    raw = offer.get("Installments") or offer.get("installments") or ()
    best: dict[str, Any] | None = None

    def consider(plan: dict[str, Any]) -> None:
        nonlocal best
        try:
            count = int(plan.get("NumberOfInstallments") or plan.get("Number") or plan.get("count") or 0)
        except (TypeError, ValueError):
            count = 0
        if count <= 0:
            return
        rate = plan.get("InterestRate", 0)
        try:
            interest = float(rate if rate is not None else 0) > 0
        except (TypeError, ValueError):
            interest = False
        entry: dict[str, Any] = {"count": count, "interestFree": not interest}
        if best is None:
            best = entry
            return
        cand = (1 if entry["interestFree"] else 0, entry["count"])
        cur = (1 if best["interestFree"] else 0, best["count"])
        if cand > cur:
            best = entry

    for system in raw:
        if not isinstance(system, dict):
            continue
        plans = system.get("Installments") or system.get("installments") or system
        if isinstance(plans, dict) and ("NumberOfInstallments" in plans or "Number" in plans):
            consider(plans)
        elif isinstance(plans, list):
            for plan in plans:
                if isinstance(plan, dict):
                    consider(plan)
    return best


_ENHANCED_CLICK_RE = re.compile(r"enhancedClick\(\s*(\{.*?\})\s*\)", re.S)
_HREF_RE = re.compile(r"<a\s[^>]*href=\"([^\"]+)\"")
_IMG_SRC_RE = re.compile(
    r"<img\b[^>]*(?:src|data-src|data-original)=[\"']([^\"']+)[\"'][^>]*>",
    re.I,
)


def _image_in_anchor(body: str, anchor_start: int, click_end: int, origin: str) -> str | None:
    """Pull product thumb from the <a>…</a> that wraps enhancedClick (Venex)."""
    close = body.find("</a>", click_end)
    if close == -1:
        close = min(len(body), click_end + 1200)
    chunk = body[anchor_start:close]
    for m in _IMG_SRC_RE.finditer(chunk):
        raw = m.group(1).strip()
        if not raw or raw.startswith("data:"):
            continue
        if re.search(r"spacer|pixel|logo|icon|1x1", raw, re.I):
            continue
        return normalize_product_url(raw, base=origin)
    return None


def _parse_enhanced_click_page(url: str, body: str) -> list[dict[str, Any]]:
    """osCommerce-style listing: products wrapped in `enhancedClick({...})`
    JSON blobs (id/name/category/brand/price) plus the anchor href before each.
    Venex (`resultado-busqueda.htm?keywords=`) uses this format."""
    origin = _origin(url)
    host = urlparse(url).hostname.replace("www.", "") if urlparse(url).hostname else "tienda"
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in _ENHANCED_CLICK_RE.finditer(body):
        blob = m.group(1)
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        name = (data.get("name") or "").strip()
        price_raw = data.get("price")
        try:
            price = float(price_raw)
        except (TypeError, ValueError):
            continue
        if len(name) < 4 or not price > 0:
            continue
        anchor = body.rfind("<a", 0, m.start())
        if anchor == -1:
            continue
        href = _HREF_RE.search(body, anchor, m.start())
        if href is None:
            continue
        product_url = normalize_product_url(href.group(1), base=origin)
        if product_url is None or product_url in seen:
            continue
        seen.add(product_url)
        image = _image_in_anchor(body, anchor, m.end(), origin)
        results.append(
            {
                "name": name,
                "price": price,
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
        product_id = product.get("productId")
        item_id = item.get("itemId") if isinstance(item, dict) else None
        if _is_fravega_host(host):
            product_url = fravega_pdp_url(
                origin,
                link_text=slug if isinstance(slug, str) else None,
                product_id=str(product_id) if product_id is not None else None,
                item_id=str(item_id) if item_id is not None else None,
            )
        elif isinstance(link, str) and link.startswith("http"):
            product_url = normalize_product_url(link)
        elif isinstance(link, str) and link.startswith("/"):
            product_url = normalize_product_url(link, base=origin)
        elif isinstance(slug, str) and slug:
            product_url = normalize_product_url(f"{origin}/{slug}/p")
        else:
            product_url = None
        if product_url is None or product_url in seen:
            continue
        seen.add(product_url)

        images = item.get("images") or []
        image = images[0].get("imageUrl") if images else None
        installments = _parse_vtex_installments(offer)
        results.append(
            {
                "name": name,
                "price": float(price),
                "currency": "ARS",
                "url": product_url,
                "image": image,
                "shippingHint": "Envío a domicilio",
                "store": {"name": host, "logo": None, "local": True, "siteUrl": origin},
                "installments": installments,
                "depth": 0,
                "sourceUrl": url,
            }
        )
    return results


def parse_woo_store_api(url: str, body: str) -> list[dict[str, Any]]:
    """WooCommerce Store API products list (`/wp-json/wc/store/v1/products`)."""
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
        name = (product.get("name") or "").strip()
        if len(name) < 4:
            continue
        permalink_raw = product.get("permalink")
        if not isinstance(permalink_raw, str):
            continue
        permalink = normalize_product_url(permalink_raw, base=origin)
        if permalink is None:
            continue
        prices = product.get("prices") if isinstance(product.get("prices"), dict) else {}
        price = _woo_price(prices)
        if price is None or price <= 0:
            continue
        if permalink in seen:
            continue
        seen.add(permalink)
        images = product.get("images") or []
        image = None
        if images and isinstance(images[0], dict):
            src = images[0].get("src")
            if isinstance(src, str):
                image = src
        results.append(
            {
                "name": name,
                "price": price,
                "currency": "ARS",
                "url": permalink,
                "image": image,
                "shippingHint": "Envío a domicilio",
                "store": {"name": host, "logo": None, "local": True, "siteUrl": origin},
                "depth": 0,
                "sourceUrl": url,
            }
        )
    return results


def _woo_price(prices: dict[str, Any]) -> float | None:
    raw = prices.get("price") or prices.get("sale_price") or prices.get("regular_price")
    if raw is None or raw == "":
        return None
    try:
        minor = int(str(raw).strip())
    except (TypeError, ValueError):
        try:
            return float(str(raw).strip())
        except (TypeError, ValueError):
            return None
    units = prices.get("currency_minor_unit")
    try:
        scale = int(units) if units is not None else 2
    except (TypeError, ValueError):
        scale = 2
    return minor / (10**scale) if scale > 0 else float(minor)


def parse_shopify_suggest_or_products(url: str, body: str) -> list[dict[str, Any]]:
    """Shopify `suggest.json` or `products.json` — filter by query tokens in title when present."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []

    origin = _origin(url)
    host = urlparse(url).hostname.replace("www.", "") if urlparse(url).hostname else "tienda"
    query_tokens = _shopify_query_tokens(url)

    raw_products: list[dict[str, Any]] = []
    if isinstance(data, dict):
        # suggest.json: resources.results.products | resources.products
        resources = data.get("resources")
        if isinstance(resources, dict):
            results_block = resources.get("results")
            if isinstance(results_block, dict) and isinstance(results_block.get("products"), list):
                raw_products = [p for p in results_block["products"] if isinstance(p, dict)]
            elif isinstance(resources.get("products"), list):
                raw_products = [p for p in resources["products"] if isinstance(p, dict)]
        if not raw_products and isinstance(data.get("products"), list):
            raw_products = [p for p in data["products"] if isinstance(p, dict)]
    elif isinstance(data, list):
        raw_products = [p for p in data if isinstance(p, dict)]

    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for product in raw_products[:40]:
        name = (product.get("title") or product.get("name") or "").strip()
        if len(name) < 4:
            continue
        if query_tokens and not _title_matches_tokens(name, query_tokens):
            continue
        price = _shopify_price(product)
        if price is None or price <= 0:
            continue
        product_url = _shopify_product_url(origin, product)
        if product_url is None or product_url in seen:
            continue
        seen.add(product_url)
        image = _shopify_image(product)
        results.append(
            {
                "name": name,
                "price": price,
                "currency": "ARS",
                "url": product_url,
                "image": image,
                "shippingHint": "Envío a domicilio",
                "store": {"name": host, "logo": None, "local": True, "siteUrl": origin},
                "depth": 0,
                "sourceUrl": url,
            }
        )
        if len(results) >= 25:
            break
    return results


def _shopify_query_tokens(url: str) -> list[str]:
    from urllib.parse import parse_qs, unquote

    qs = parse_qs(urlparse(url).query)
    raw = qs.get("q", [""])[0]
    if not raw:
        return []
    text = unquote(raw).lower()
    return [t for t in re.split(r"\s+", text) if len(t) >= 2]


def _title_matches_tokens(title: str, tokens: list[str]) -> bool:
    lower = title.lower()
    return all(t in lower for t in tokens)


def _shopify_price(product: dict[str, Any]) -> float | None:
    raw = product.get("price")
    if isinstance(raw, (int, float)) and raw > 0:
        return float(raw)
    if isinstance(raw, str):
        try:
            val = float(raw.replace(",", ".").strip())
            return val if val > 0 else None
        except ValueError:
            pass
    variants = product.get("variants")
    if isinstance(variants, list) and variants:
        first = variants[0]
        if isinstance(first, dict):
            return _shopify_price({"price": first.get("price")})
    return None


def _shopify_product_url(origin: str, product: dict[str, Any]) -> str | None:
    url = product.get("url") or product.get("handle")
    if isinstance(url, str) and url.startswith("http"):
        return normalize_product_url(url)
    if isinstance(url, str) and url.startswith("/"):
        return normalize_product_url(url, base=origin)
    handle = product.get("handle")
    if isinstance(handle, str) and handle:
        return normalize_product_url(f"{origin}/products/{handle}")
    return None


def _shopify_image(product: dict[str, Any]) -> str | None:
    image = product.get("image")
    if isinstance(image, str) and image.startswith("http"):
        return image
    if isinstance(image, dict):
        src = image.get("src") or image.get("url")
        if isinstance(src, str) and src.startswith("http"):
            return src
    images = product.get("images")
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, str) and first.startswith("http"):
            return first
        if isinstance(first, dict):
            src = first.get("src") or first.get("url")
            if isinstance(src, str) and src.startswith("http"):
                return src
    featured = product.get("featured_image")
    if isinstance(featured, str) and featured.startswith("http"):
        return featured
    return None


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
    if "/wp-json/wc/store/v1/products" in url:
        return parse_woo_store_api(url, body)
    if "/search/suggest.json" in url or url.rstrip("/").endswith("/products.json") or "/products.json?" in url:
        return parse_shopify_suggest_or_products(url, body)
    if "api.mercadolibre.com" in url:
        return parse_ml_api(url, body)
    # Embedded VTEX JSON in HTML
    if '"productName"' in body and '"lowPrice"' in body:
        names = re.findall(r'"productName":"([^"\\]{4,120})"', body)
        prices = re.findall(r'"lowPrice":(\d+(?:\.\d+)?)', body)
        slugs = re.findall(r'"linkText":"([^"\\]+)"', body)
        item_ids = re.findall(r'"itemId":"([^"\\]+)"', body)
        product_ids = re.findall(r'"productId":"([^"\\]+)"', body)
        images = re.findall(r'"imageUrl":"(https?:[^"]+)"', body)
        origin = _origin(url)
        host = urlparse(url).hostname.replace("www.", "") if urlparse(url).hostname else "tienda"
        n = min(len(names), len(prices), len(slugs))
        out = []
        seen: set[str] = set()
        for i in range(n):
            if _is_fravega_host(host):
                # Catalog API is the source of truth (needs itemId). Skip HTML
                # blobs that only expose linkText/productId — those become shells.
                iid = item_ids[i] if i < len(item_ids) else None
                pid = product_ids[i] if i < len(product_ids) else None
                if not iid:
                    continue
                product_url = fravega_pdp_url(
                    origin, link_text=slugs[i], product_id=pid, item_id=iid
                )
            else:
                product_url = normalize_product_url(f"{origin}/{slugs[i]}/p")
            if product_url is None or product_url in seen:
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
    if "enhancedClick(" in body and '"price"' in body:
        return _parse_enhanced_click_page(url, body)
    return []
