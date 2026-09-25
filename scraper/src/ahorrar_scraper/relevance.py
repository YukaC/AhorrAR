"""Query↔title relevance for published offers (latency-cheap, no network)."""

from __future__ import annotations

import re
import unicodedata

_STOP = frozenset(
    {
        "de",
        "la",
        "el",
        "los",
        "las",
        "un",
        "una",
        "unos",
        "unas",
        "y",
        "o",
        "u",
        "del",
        "al",
        "a",
        "en",
        "con",
        "por",
        "para",
        "the",
        "and",
        "or",
        "of",
    }
)

# Often omitted from PDP titles (user says "perfume bensimon", title is "Bensimon Sunset EDP").
_CATEGORY_OPTIONAL = frozenset(
    {
        "perfume",
        "perfumes",
        "fragancia",
        "fragancias",
        "colonia",
        "notebook",
        "notebooks",
        "laptop",
        "celular",
        "celulares",
        "telefono",
        "telefonos",
        "zapatilla",
        "zapatillas",
        "auricular",
        "auriculares",
        "monitor",
        "monitores",
        "teclado",
        "mouse",
        "procesadores",
        "procesador",
    }
)

_TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)


def normalize_text(text: str) -> str:
    folded = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")


def query_tokens(product: str) -> list[str]:
    """Significant tokens from the user query (order preserved, deduped)."""
    norm = normalize_text(product)
    raw = _TOKEN_RE.findall(norm)
    out: list[str] = []
    seen: set[str] = set()
    for tok in raw:
        if tok in _STOP or tok in seen:
            continue
        if tok.isdigit() or len(tok) >= 2:
            seen.add(tok)
            out.append(tok)
    return out


def title_matches_query(title: str, product: str) -> bool:
    """True when the offer title covers the discriminative query tokens.

    Optimized for AR ecommerce titles:
    - Multi-digit numbers (55, 5600) always required.
    - Single digits use a digit-boundary check (\"5\" ∉ \"5600\").
    - Alpha tokens len>=4: all required except optional category nouns
      (perfume, notebook…) when another specific token is present.
    - Lone category query (\"perfume\") does not filter — titles often omit it.
    - Lone brand/model (\"iphone\") must appear in the title (⊥ baffle as best price).
    - Short alpha (tv, pc) required when the query also has a number or 2+ hard alphas.
    """
    tokens = query_tokens(product)
    if not tokens:
        return True
    hay = normalize_text(title)
    if not hay:
        return False

    alphas = [t for t in tokens if not t.isdigit() and len(t) >= 4]
    nums = [t for t in tokens if t.isdigit() and len(t) >= 2]
    shorts = [t for t in tokens if t not in alphas and t not in {n for n in nums}]

    for num in nums:
        if num not in hay:
            return False

    required_alphas = [a for a in alphas if a not in _CATEGORY_OPTIONAL]
    if len(alphas) >= 2:
        must = required_alphas if required_alphas else alphas
        for a in must:
            if a not in hay:
                return False
    elif len(alphas) == 1:
        # Lone optional category ("perfume") → titles often omit it; don't filter.
        # Brand/model alone ("iphone") → must appear.
        only = alphas[0]
        if only not in _CATEGORY_OPTIONAL and only not in hay:
            return False

    for short in shorts:
        if short.isdigit() and len(short) == 1:
            if not re.search(rf"(?<!\d){re.escape(short)}(?!\d)", hay):
                return False
        elif len(short) >= 2 and (nums or len(alphas) >= 2):
            if short not in hay:
                return False
    return True
