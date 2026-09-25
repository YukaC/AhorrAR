"""MercadoLibre OAuth token helpers — load, refresh-on-401, persist.

Access tokens expire ~6h. Refresh tokens rotate. On 401 we refresh once,
update process env, and write `MELI_TOKEN_FILE` so the next process/machine
boot still has a valid refresh (Fly volume at `/data` in prod).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("ahorrar.meli.auth")

TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
_UA = "AhorrAR/0.1 (price-compare; contact local)"

_lock = threading.RLock()
_loaded_file = False


def token_file_path() -> Path:
    raw = os.environ.get("MELI_TOKEN_FILE", "").strip()
    if raw:
        return Path(raw)
    data_dir = Path("/data")
    if data_dir.is_dir() and os.access(data_dir, os.W_OK):
        return data_dir / "meli_tokens.json"
    # scraper/ package → parents[2] = scraper/
    return Path(__file__).resolve().parents[2] / ".meli_tokens.json"


def _apply_tokens(tokens: dict[str, str]) -> None:
    for key in ("MELI_ACCESS_TOKEN", "MELI_REFRESH_TOKEN"):
        value = tokens.get(key, "").strip()
        if value:
            os.environ[key] = value


def _read_token_file() -> dict[str, str]:
    path = token_file_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("ML token file unreadable %s: %s", path, exc)
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key in ("MELI_ACCESS_TOKEN", "MELI_REFRESH_TOKEN"):
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = value.strip()
    return out


def persist_tokens(tokens: dict[str, str] | None = None) -> None:
    """Write current (or provided) tokens to MELI_TOKEN_FILE."""
    path = token_file_path()
    payload = {
        "MELI_ACCESS_TOKEN": (tokens or {}).get("MELI_ACCESS_TOKEN")
        or os.environ.get("MELI_ACCESS_TOKEN", "").strip(),
        "MELI_REFRESH_TOKEN": (tokens or {}).get("MELI_REFRESH_TOKEN")
        or os.environ.get("MELI_REFRESH_TOKEN", "").strip(),
    }
    if not payload["MELI_ACCESS_TOKEN"] and not payload["MELI_REFRESH_TOKEN"]:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=0) + "\n", encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
        log.info("ML tokens persisted → %s", path)
    except OSError as exc:
        log.warning("ML token persist failed %s: %s", path, exc)


def load_tokens_from_file(*, force: bool = False) -> None:
    """Prefer file tokens over stale Fly/env secrets (refresh rotates)."""
    global _loaded_file
    if _loaded_file and not force:
        return
    with _lock:
        if _loaded_file and not force:
            return
        file_tokens = _read_token_file()
        if file_tokens:
            _apply_tokens(file_tokens)
            log.info("ML tokens loaded from %s", token_file_path())
        _loaded_file = True


def access_token() -> str:
    load_tokens_from_file()
    return os.environ.get("MELI_ACCESS_TOKEN", "").strip()


def meli_token_configured() -> bool:
    return bool(access_token())


def auth_headers() -> dict[str, str]:
    token = access_token()
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": _UA,
    }


def can_refresh() -> bool:
    load_tokens_from_file()
    return bool(
        os.environ.get("MELI_REFRESH_TOKEN", "").strip()
        and os.environ.get("MELI_APP_ID", "").strip()
        and os.environ.get("MELI_CLIENT_SECRET", "").strip()
    )


def refresh_access_token() -> bool:
    """Exchange refresh token → new access (+ rotated refresh). Thread-safe."""
    with _lock:
        if not can_refresh():
            log.warning("ML refresh skipped — faltan MELI_REFRESH_TOKEN / APP_ID / CLIENT_SECRET")
            return False
        payload = {
            "grant_type": "refresh_token",
            "client_id": os.environ["MELI_APP_ID"].strip(),
            "client_secret": os.environ["MELI_CLIENT_SECRET"].strip(),
            "refresh_token": os.environ["MELI_REFRESH_TOKEN"].strip(),
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.post(TOKEN_URL, data=payload, headers={"accept": "application/json", "User-Agent": _UA})
        except httpx.HTTPError as exc:
            log.warning("ML refresh network error: %s", exc)
            return False
        if res.status_code >= 400:
            log.warning("ML refresh HTTP %s: %s", res.status_code, res.text[:200])
            return False
        data: Any = res.json()
        if not isinstance(data, dict):
            return False
        new_access = data.get("access_token")
        if not isinstance(new_access, str) or not new_access.strip():
            log.warning("ML refresh sin access_token")
            return False
        tokens = {"MELI_ACCESS_TOKEN": new_access.strip()}
        new_ref = data.get("refresh_token")
        if isinstance(new_ref, str) and new_ref.strip():
            tokens["MELI_REFRESH_TOKEN"] = new_ref.strip()
        _apply_tokens(tokens)
        persist_tokens(tokens)
        log.info("ML access token refreshed (+ persist)")
        return True


def refresh_after_unauthorized(status_code: int) -> bool:
    """If status is 401, refresh once. Returns True when caller should retry."""
    if status_code != 401:
        return False
    return refresh_access_token()
