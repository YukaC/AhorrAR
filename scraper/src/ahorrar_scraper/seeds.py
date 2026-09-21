"""AR discovery seeds + reputation (mirrors Node V13, Scrapling-primary)."""

from __future__ import annotations

from urllib.parse import quote, urlparse

AR_COM_BOOTSTRAP = (
    "fravega.com",
    "farmacity.com",
    "compragamer.com",
    "musimundo.com",
    "garbarino.com",
    "cetrogar.com",
)

BLOCKED_SUFFIXES = (
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "wikipedia.org",
    "linkedin.com",
    "apple.com",
    "play.google.com",
)

SERP_HOSTS = (
    "html.duckduckgo.com",
    "duckduckgo.com",
    "www.bing.com",
    "bing.com",
)


def host_of(url: str) -> str:
    try:
        return urlparse(url).hostname.replace("www.", "", 1).lower() if urlparse(url).hostname else ""
    except Exception:
        return ""


def is_serp(url: str) -> bool:
    h = host_of(url)
    return any(h == s.replace("www.", "") or h.endswith(f".{s.replace('www.', '')}") or h == s for s in SERP_HOSTS)


def is_ar_host(host: str) -> bool:
    host = host.replace("www.", "").lower()
    if not host:
        return False
    if any(host == b or host.endswith(f".{b}") for b in BLOCKED_SUFFIXES):
        return False
    if host == "ar" or host.endswith(".ar"):
        return True
    return host in AR_COM_BOOTSTRAP


def is_publishable(url: str) -> bool:
    if is_serp(url):
        return False
    # ML / API handled separately — still AR marketplace
    h = host_of(url)
    if "mercadolibre" in h:
        return True
    return is_ar_host(h)


def product_slug(product: str) -> str:
    import re
    import unicodedata

    text = unicodedata.normalize("NFD", product)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def guess_search_urls(origin: str, product: str) -> list[str]:
    q = quote(product.strip())
    slug = product_slug(product)
    base = origin.rstrip("/")
    return [
        f"{base}/api/catalog_system/pub/products/search?ft={q}&_from=0&_to=11",
        f"{base}/{slug}?_q={q}&map=ft",
        f"{base}/search?q={q}",
        f"{base}/buscar?q={q}",
    ]


def build_seed_urls(product: str, *, include_ml: bool = False) -> list[str]:
    """Primary seeds. ML listado/API optional until ML path is decided."""
    q = product.strip()
    enc = quote(q)
    slug = quote(q.replace(" ", "-"))
    hubs = [
        f"https://html.duckduckgo.com/html/?q={quote(f'{q} site:.com.ar')}",
        f"https://html.duckduckgo.com/html/?q={quote(f'{q} comprar precio Argentina')}",
        f"https://www.bing.com/search?q={quote(f'{q} site:com.ar')}&setlang=es-AR&cc=AR",
        f"https://www.bing.com/search?q={quote(f'{q} comprar Argentina precio')}&setlang=es-AR&cc=AR",
    ]
    apis = [
        f"https://www.{host}/api/catalog_system/pub/products/search?ft={enc}&_from=0&_to=11"
        for host in AR_COM_BOOTSTRAP
    ]
    seeds = [*hubs, *apis]
    if include_ml:
        seeds.append(f"https://api.mercadolibre.com/sites/MLA/search?q={enc}&limit=20")
        seeds.append(f"https://listado.mercadolibre.com.ar/{slug}")
    return seeds


def unwrap_serp_hrefs(page_url: str, html: str) -> list[str]:
    """Extract AR shop targets from SERP HTML (Bing u= / DDG uddg)."""
    import base64
    import html as html_lib
    import re
    from urllib.parse import parse_qs, unquote, urljoin, urlparse

    out: list[str] = []

    def push(candidate: str) -> None:
        candidate = candidate.split("#")[0]
        if not candidate.startswith("http"):
            return
        if is_publishable(candidate) and is_ar_host(host_of(candidate)):
            out.append(candidate)

    for m in re.finditer(r'href=["\']([^"\']+)["\']', html, re.I):
        raw = html_lib.unescape(m.group(1))
        try:
            abs_url = urljoin(page_url, raw)
        except Exception:
            continue
        push(abs_url)
        parsed = urlparse(abs_url)
        qs = parse_qs(parsed.query)
        if "uddg" in qs:
            push(unquote(qs["uddg"][0]))
        if "u" in qs:
            payload = qs["u"][0]
            if payload.lower().startswith("a1"):
                payload = payload[2:]
            try:
                decoded = base64.b64decode(payload + "==").decode("utf-8", errors="ignore")
                push(decoded)
            except Exception:
                pass

    for m in re.finditer(r"[?&]u=a1([A-Za-z0-9+/=_-]{20,})", html):
        try:
            decoded = base64.b64decode(m.group(1) + "==").decode("utf-8", errors="ignore")
            push(decoded)
        except Exception:
            pass

    return list(dict.fromkeys(out))
