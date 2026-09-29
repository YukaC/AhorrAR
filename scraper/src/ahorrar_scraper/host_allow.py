"""Host allowlist for discovery persistence (§V32)."""

from __future__ import annotations

import ipaddress
import socket

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


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return bool(addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved)


def is_discoverable_host_shape(host_raw: str) -> bool:
    host = host_raw.replace("www.", "", 1).lower().strip()
    if len(host) < 4 or len(host) > 253:
        return False
    if "/" in host or ":" in host or " " in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
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


def is_persistable_discovered_host(host_raw: str) -> bool:
    host = host_raw.replace("www.", "", 1).lower().strip()
    if not is_discoverable_host_shape(host):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    if not infos:
        return False
    for info in infos:
        sockaddr = info[4]
        ip = sockaddr[0]
        if _is_private_ip(ip):
            return False
    return True
