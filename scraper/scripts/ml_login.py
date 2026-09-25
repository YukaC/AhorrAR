"""AhorrAR — MercadoLibre OAuth CLI (Authorization Code + PKCE).

One-shot manual flow to mint the first MELI_ACCESS_TOKEN / MELI_REFRESH_TOKEN
and persist them into scraper/.env (gitignored).

Commands:
  ml_login.py url                 print the authorization URL (persists verifier+state)
  ml_login.py code <CODE>         exchange a code for tokens, write them to .env
  ml_login.py code --url "<URL>"  same, but pass the full redirect URL (code parsed)
  ml_login.py refresh             refresh token (rotates refresh token)

Env loaded from scraper/.env: MELI_APP_ID, MELI_CLIENT_SECRET, MELI_REDIRECT_URI.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
STATE = ROOT / ".ml_oauth_state.json"

AUTH_URL = "https://auth.mercadolibre.com.ar/authorization"
TOKEN_URL = "https://api.mercadolibre.com/oauth/token"


class AppError(Exception):
    pass


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV.exists():
        for raw in ENV.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    missing = [k for k in ("MELI_APP_ID", "MELI_CLIENT_SECRET", "MELI_REDIRECT_URI") if not env.get(k)]
    if missing:
        raise AppError(f"faltan en {ENV}: {', '.join(missing)}")
    return env


def write_env(env: dict[str, str]) -> None:
    lines: list[str] = []
    written = set()
    if ENV.exists():
        for raw in ENV.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                lines.append(raw)
                continue
            k = line.partition("=")[0].strip()
            if k in env:
                lines.append(f"{k}={env[k]}")
                written.add(k)
            else:
                lines.append(raw)
    for k, v in env.items():
        if k not in written:
            lines.append(f"{k}={v}")
    ENV.write_text("\n".join(lines) + "\n")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def pkce() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def authorize(env: dict[str, str]) -> str:
    verifier, challenge = pkce()
    state = secrets.token_urlsafe(24)
    STATE.write_text(json.dumps({"verifier": verifier, "state": state}))  # gitignored
    params = {
        "response_type": "code",
        "client_id": env["MELI_APP_ID"],
        "redirect_uri": env["MELI_REDIRECT_URI"],
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "scope": "read offline_access",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def extract_code(raw: str) -> str:
    if raw.startswith("http"):
        qs = parse_qs(urlsplit(raw).query)
        if "code" not in qs:
            raise AppError("la URL no contiene parámetro ?code=")
        return qs["code"][0]
    return raw.strip()


def exchange(env: dict[str, str], code: str) -> dict[str, str]:
    if not STATE.exists():
        raise AppError("falta estado PKCE — corré primero `ml_login.py url`")
    verifier = json.loads(STATE.read_text())["verifier"]
    payload = {
        "grant_type": "authorization_code",
        "client_id": env["MELI_APP_ID"],
        "client_secret": env["MELI_CLIENT_SECRET"],
        "code": code,
        "redirect_uri": env["MELI_REDIRECT_URI"],
        "code_verifier": verifier,
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.post(TOKEN_URL, data=payload, headers={"accept": "application/json"})
    if res.status_code >= 400:
        raise AppError(f"token ML {res.status_code}: {res.text[:300]}")
    data = res.json()
    return {
        "MELI_ACCESS_TOKEN": data.get("access_token", ""),
        "MELI_REFRESH_TOKEN": data.get("refresh_token", ""),
    }


def refresh(env: dict[str, str]) -> dict[str, str]:
    ref = env.get("MELI_REFRESH_TOKEN", "").strip()
    if not ref:
        raise AppError("falta MELI_REFRESH_TOKEN en .env — corré `url` + `code` primero")
    payload = {
        "grant_type": "refresh_token",
        "client_id": env["MELI_APP_ID"],
        "client_secret": env["MELI_CLIENT_SECRET"],
        "refresh_token": ref,
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.post(TOKEN_URL, data=payload, headers={"accept": "application/json"})
    if res.status_code >= 400:
        raise AppError(f"refresh ML {res.status_code}: {res.text[:300]}")
    data = res.json()
    out = {"MELI_ACCESS_TOKEN": data.get("access_token", "")}
    new_ref = data.get("refresh_token")
    if new_ref:
        out["MELI_REFRESH_TOKEN"] = new_ref
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=["url", "code", "refresh"])
    ap.add_argument("value", nargs="?", help="código o URL de redirección (para `code`)")
    ap.add_argument("--url", dest="full_url", action="store_true", help="`value` es la URL completa con ?code=")
    args = ap.parse_args()

    try:
        env = load_env()
        if args.command == "url":
            print(authorize(env))
            print("\nAbrí esa URL, autorizá, y pasame el `/auth/ml/callback?...` pegado tal cual.")
        elif args.command == "code":
            if not args.value:
                ap.error("`code` requiere el código o la URL (usa --url)")
            code = extract_code(args.value)
            tokens = exchange(env, code)
            write_env(tokens)
            print("Tokens OK → scraper/.env (MELI_ACCESS_TOKEN + MELI_REFRESH_TOKEN)")
        elif args.command == "refresh":
            tokens = refresh(env)
            write_env(tokens)
            print("Refresh OK → MELI_ACCESS_TOKEN rotado")
        return 0
    except AppError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())