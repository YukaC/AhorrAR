"""Host allowlist for discovery + fetch (§V32) — anti-SSRF.

Shape allowlist, private-IP DNS check, URL tricks, short-TTL DNS cache.
Fetch callers must call ``assert_fetch_allowed`` before connecting and on
every redirect hop. DNS results are cached so resolve+connect reuse the
same addresses within the TTL (rebinding window bounded).
"""

from __future__ import annotations

import ipaddress
import socket
import threading
import time
from urllib.parse import urlparse

_BLOCKED_SUFFIXES = (
    "localhost",
    "local",
    "internal",
    "intranet",
    "lan",
    "home",
    "localdomain",
)

_AR_BOOTSTRAP = frozenset(
    {
        "fravega.com",
        "farmacity.com",
        "compragamer.com",
        "musimundo.com",
        "garbarino.com",
        "easy.com.ar",
        "mercadolibre.com.ar",
    }
)

DNS_CACHE_TTL_S = 30.0

_dns_lock = threading.Lock()
_dns_cache: dict[str, tuple[list[str], float]] = {}


def reset_host_allow_dns_cache_for_tests() -> None:
    with _dns_lock:
        _dns_cache.clear()


def is_private_ip(ip_raw: str) -> bool:
    ip = ip_raw.strip().lower()
    if ip.startswith("[") and ip.endswith("]"):
        ip = ip[1:-1]
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    # Mapped IPv4 inside IPv6 is handled by ipaddress (.ipv4_mapped).
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return is_private_ip(str(addr.ipv4_mapped))
    return bool(
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def looks_like_ip_literal(host_raw: str) -> bool:
    host = host_raw.strip().lower()
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if host.isdigit() and 8 <= len(host) <= 10:
        return True
    if host.startswith("0x") and all(c in "0123456789abcdef" for c in host[2:]):
        return True
    if host.startswith("0x") and "." in host:
        return True
    if host.startswith("0") and all(c in "01234567." for c in host) and "." in host:
        return True
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        return True
    return False


def is_discoverable_host_shape(host_raw: str) -> bool:
    host = host_raw.replace("www.", "", 1).lower().strip()
    if len(host) < 4 or len(host) > 253:
        return False
    if "/" in host or ":" in host or " " in host or "@" in host:
        return False
    if looks_like_ip_literal(host):
        return False
    for suf in _BLOCKED_SUFFIXES:
        if host == suf or host.endswith(f".{suf}"):
            return False
    if host in _AR_BOOTSTRAP or host.endswith(".ar"):
        return True
    parts = host.split(".")
    if len(parts) >= 2 and all(p.replace("-", "").isalnum() for p in parts):
        if parts[-1] in ("com", "net", "org", "shop", "store"):
            return True
    return False


def is_safe_crawl_url_shape(url_raw: str) -> bool:
    try:
        u = urlparse(url_raw)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    if u.username is not None or u.password is not None:
        return False
    # urlparse puts userinfo in netloc as user@host — also reject @ in netloc.
    if "@" in (u.netloc or ""):
        return False
    host = (u.hostname or "").replace("www.", "", 1).lower()
    if not host:
        return False
    if looks_like_ip_literal(host):
        return False
    return is_discoverable_host_shape(host)


from typing import Callable

# Injectable for hermetic tests.
DnsResolver = Callable[[str], list[str]]


def _default_dns_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None)
    addresses: list[str] = []
    seen: set[str] = set()
    for info in infos:
        ip = info[4][0]
        if ip not in seen:
            seen.add(ip)
            addresses.append(ip)
    return addresses


_dns_resolver: DnsResolver = _default_dns_resolver


def set_dns_resolver_for_tests(resolver: DnsResolver | None) -> None:
    global _dns_resolver
    _dns_resolver = resolver if resolver is not None else _default_dns_resolver


def _resolve_addresses(host: str) -> list[str]:
    key = host.replace("www.", "", 1).lower()
    now = time.monotonic()
    with _dns_lock:
        cached = _dns_cache.get(key)
        if cached is not None and cached[1] > now:
            return list(cached[0])
    addresses = _dns_resolver(key)
    # Only pin/cache when every address is public (§V32).
    if addresses and not any(is_private_ip(a) for a in addresses):
        with _dns_lock:
            _dns_cache[key] = (addresses, now + DNS_CACHE_TTL_S)
    return addresses


def is_persistable_discovered_host(host_raw: str) -> bool:
    host = host_raw.replace("www.", "", 1).lower().strip()
    if not is_discoverable_host_shape(host):
        return False
    try:
        addresses = _resolve_addresses(host)
    except OSError:
        return False
    if not addresses:
        return False
    for ip in addresses:
        if is_private_ip(ip):
            return False
    return True


def assert_fetch_allowed(url_raw: str) -> bool:
    """Fetch-time gate: URL shape + DNS public. Fills pin cache."""
    if not is_safe_crawl_url_shape(url_raw):
        return False
    try:
        host = (urlparse(url_raw).hostname or "").replace("www.", "", 1).lower()
    except Exception:
        return False
    if not host:
        return False
    try:
        addresses = _resolve_addresses(host)
    except OSError:
        return False
    if not addresses:
        return False
    for ip in addresses:
        if is_private_ip(ip):
            return False
    return True


def pinned_addresses(hostname: str) -> list[str]:
    key = hostname.replace("www.", "", 1).lower()
    now = time.monotonic()
    with _dns_lock:
        cached = _dns_cache.get(key)
        if cached is None or cached[1] <= now:
            return []
        return list(cached[0])
