"""AR discovery seeds + reputation (mirrors Node V13/V19, Scrapling-primary)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.parse import quote, urlparse

AR_SHOPS_JSON = Path(__file__).resolve().parents[3] / "shared" / "ar-shops.json"

INDEX_VERSION = 3

ShopPlatform = str  # vtex|shopify|woo|tiendanube|oscommerce|unknown


def _shops_path() -> Path:
    env = os.environ.get("AR_SHOPS_JSON")
    if env:
        return Path(env)
    return AR_SHOPS_JSON


def _load_ar_shops() -> list[dict]:
    try:
        data = json.loads(_shops_path().read_text("utf-8"))
        shops = data.get("shops", [])
        return shops if isinstance(shops, list) else []
    except Exception:
        return []


def ar_shop_hosts() -> set[str]:
    return {str(s.get("host", "")).lower() for s in _load_ar_shops() if s.get("host")}


def platform_for_host(host: str) -> str:
    """Lookup curated/discovered platform; default unknown (§V19)."""
    host = host.replace("www.", "", 1).lower()
    for s in _load_ar_shops():
        if s.get("host") == host:
            raw = s.get("platform")
            if isinstance(raw, str) and raw:
                return raw
            break
    return "unknown"


def curated_search_url(host: str, product: str) -> str | None:
    """Canonical search URL for a curated host with a template entry, else None.
    Lets `expand_origin` skip the generic guesses for hosts whose search
    endpoint is known (VTEX catalog API, Venex's resultado-busqueda…)."""
    host = host.replace("www.", "", 1).lower()
    raw = None
    for s in _load_ar_shops():
        if s.get("host") == host and s.get("curated"):
            raw = s.get("entry")
            break
    if not isinstance(raw, str) or "{q}" not in raw:
        return None
    return raw.replace("{q}", quote(product.strip()))


def discover_shop(host: str, category: str = "general") -> None:
    """Self-update the shared index: new shop with results gets persisted (§V19)."""
    host = host.replace("www.", "", 1).lower()
    if not host:
        return
    shops = _load_ar_shops()
    if any(s.get("host") == host for s in shops):
        return
    shops.append(
        {
            "host": host,
            "category": category,
            "curated": False,
            "entry": None,
            "platform": "unknown",
            "alive": True,
        }
    )
    path = _shops_path()
    tmp = path.with_suffix(".json.tmp")
    try:
        tmp.write_text(
            json.dumps({"version": INDEX_VERSION, "shops": shops}, ensure_ascii=False, indent=2),
            "utf-8",
        )
        os.replace(tmp, path)
    except Exception:
        pass


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

_TRUSTED = frozenset(("fravega.com", "farmacity.com", "compragamer.com", "musimundo.com", "garbarino.com", "cetrogar.com"))


def host_of(url: str) -> str:
    try:
        return urlparse(url).hostname.replace("www.", "", 1).lower() if urlparse(url).hostname else ""
    except Exception:
        return ""


def is_serp(url: str) -> bool:
    h = host_of(url)
    return any(h == s.replace("www.", "") or h.endswith(f".{s.replace('www.', '')}") or h == s for s in SERP_HOSTS)


def is_ar_host(host: str) -> bool:
    host = host.replace("www.", "", 1).lower()
    if not host:
        return False
    if any(host == b or host.endswith(f".{b}") for b in BLOCKED_SUFFIXES):
        return False
    if host == "ar" or host.endswith(".ar"):
        return True
    if host in _TRUSTED:
        return True
    return host in ar_shop_hosts()


def is_publishable(url: str) -> bool:
    if is_serp(url):
        return False
    # ML / API handled separately — still AR marketplace
    h = host_of(url)
    if "mercadolibre" in h:
        return True
    return is_ar_host(h)


def product_slug(product: str) -> str:
    import unicodedata

    text = unicodedata.normalize("NFD", product)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def guess_search_urls(origin: str, product: str, platform: str | None = None) -> list[str]:
    """Platform-aware search URL guesses (§V19). Max 1–2 for known platforms, 4 for unknown."""
    q = quote(product.strip())
    base = origin.rstrip("/")
    host = host_of(base) or host_of(origin)
    resolved = platform if platform else platform_for_host(host)

    if resolved == "vtex":
        return [
            f"{base}/api/catalog_system/pub/products/search?ft={q}&_from=0&_to=11",
            f"{base}/busca?ft={q}",
        ]
    if resolved == "shopify":
        return [
            f"{base}/search/suggest.json?q={q}&resources[type]=product",
            f"{base}/products.json?limit=12",
        ]
    if resolved == "woo":
        return [
            f"{base}/wp-json/wc/store/v1/products?search={q}&per_page=12",
            f"{base}/?s={q}",
        ]
    if resolved == "tiendanube":
        return [
            f"{base}/products_search/?q={q}",
            f"{base}/search?q={q}",
        ]
    if resolved == "oscommerce":
        return [
            f"{base}/resultado-busqueda.htm?keywords={q}",
            f"{base}/?s={q}",
        ]
    # unknown — short prioritized list (max 4)
    return [
        f"{base}/api/catalog_system/pub/products/search?ft={q}&_from=0&_to=11",
        f"{base}/wp-json/wc/store/v1/products?search={q}&per_page=12",
        f"{base}/?s={q}",
        f"{base}/search?q={q}",
    ]


def category_for(product: str) -> str:
    """Mirror of Node categoryFor (§V19): same rules, same category ids."""
    text = f" {product} "
    if re.search(r"perfume|fragancia|colonia|makeup|cosmetic|bensimon|julie|bellamar", text, re.I):
        return "perfumeria"
    if re.search(r"zapatilla|zapatos|remera|campera|jean|ropa|nike|adidas", text, re.I):
        return "moda"
    if re.search(r"motherboard|procesador|cpu|ryzen|gpu|rtx|rx\s*\d|notebook|gaming|teclado|mouse|monitor", text, re.I):
        return "gaming"
    if re.search(r"bazar|vajilla|cacerola|cubiertos", text, re.I):
        return "bazar"
    if re.search(r"tv\b|televisor|heladera|lavarropas|smart tv", text, re.I):
        return "electro"
    return "general"


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
    # Category priority (§V19, mirrors Node buildSeedUrls): same-category
    # shops first; within each block, entry shops before entry-null guesses
    # (a known-good entry beats speculative guesses under the 20 cap).
    cat = category_for(q)
    same_entry: list[str] = []
    same_null: list[str] = []
    other_entry: list[str] = []
    other_null: list[str] = []
    for s in _load_ar_shops():
        if not s.get("curated"):
            continue
        if s.get("alive") is False:
            continue
        platform = s.get("platform") if isinstance(s.get("platform"), str) else None
        if s.get("entry"):
            item = str(s["entry"]).replace("{q}", enc)
            target = same_entry if s.get("category") == cat else other_entry
            target.append(item)
        else:
            items = guess_search_urls(f"https://www.{s['host']}", q, platform)
            target = same_null if s.get("category") == cat else other_null
            target.extend(items)
    curated = same_entry + same_null + other_entry + other_null
    seeds = [*hubs, *curated[:20]]
    if include_ml:
        seeds.append(f"https://api.mercadolibre.com/sites/MLA/search?q={enc}&limit=20")
        seeds.append(f"https://listado.mercadolibre.com.ar/{slug}")
    return seeds


def unwrap_serp_hrefs(page_url: str, html: str) -> list[str]:
    """Extract AR shop targets from SERP HTML (Bing u= / DDG uddg)."""
    import base64
    import html as html_lib
    from urllib.parse import parse_qs, unquote, urljoin

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
