"""Query↔title relevance (mirrors backend/src/search/relevance.ts).

Realistic-search layers (§V27–§V29):
  1. title_matches_query — hard structural gate
  2. title_relevance_score — 0..1 soft score
  3. is_relevant_result — publish only if gate + score ≥ RELEVANCE_PUBLISH
"""

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

_CATEGORY_SYNONYMS: dict[str, tuple[str, ...]] = {
    "notebook": ("notebook", "notebooks", "laptop", "laptops"),
    "notebooks": ("notebook", "notebooks", "laptop", "laptops"),
    "laptop": ("notebook", "notebooks", "laptop", "laptops"),
    "celular": ("celular", "celulares", "telefono", "telefonos", "smartphone", "smartphones"),
    "celulares": ("celular", "celulares", "telefono", "telefonos", "smartphone", "smartphones"),
    "telefono": ("celular", "celulares", "telefono", "telefonos", "smartphone", "smartphones"),
    "telefonos": ("celular", "celulares", "telefono", "telefonos", "smartphone", "smartphones"),
    "monitor": ("monitor", "monitores"),
    "monitores": ("monitor", "monitores"),
    "zapatilla": ("zapatilla", "zapatillas"),
    "zapatillas": ("zapatilla", "zapatillas"),
    "auricular": ("auricular", "auriculares", "headset", "headsets"),
    "auriculares": ("auricular", "auriculares", "headset", "headsets"),
    "teclado": ("teclado", "teclados", "keyboard", "keyboards"),
    "mouse": ("mouse", "raton", "ratones"),
    "procesador": ("procesador", "procesadores", "cpu", "cpus"),
    "procesadores": ("procesador", "procesadores", "cpu", "cpus"),
    "perfume": ("perfume", "perfumes", "fragancia", "fragancias", "colonia", "parfum"),
    "perfumes": ("perfume", "perfumes", "fragancia", "fragancias", "colonia", "parfum"),
    "fragancia": ("perfume", "perfumes", "fragancia", "fragancias", "colonia", "parfum"),
    "fragancias": ("perfume", "perfumes", "fragancia", "fragancias", "colonia", "parfum"),
    "colonia": ("perfume", "perfumes", "fragancia", "fragancias", "colonia", "parfum"),
}

_TOKEN_FAMILY: dict[str, str] = {
    "perfume": "fragrance",
    "perfumes": "fragrance",
    "fragancia": "fragrance",
    "fragancias": "fragrance",
    "colonia": "fragrance",
    "notebook": "notebook",
    "notebooks": "notebook",
    "laptop": "notebook",
    "celular": "phone",
    "celulares": "phone",
    "telefono": "phone",
    "telefonos": "phone",
    "smartphone": "phone",
    "smartphones": "phone",
    "iphone": "phone",
    "zapatilla": "footwear",
    "zapatillas": "footwear",
    "auricular": "audio",
    "auriculares": "audio",
    "headset": "audio",
    "headsets": "audio",
    "monitor": "monitor",
    "monitores": "monitor",
    "teclado": "keyboard",
    "mouse": "mouse",
    "procesador": "cpu",
    "procesadores": "cpu",
}

_TITLE_FAMILY_LEAD: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("fragrance", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:perfumes?|colonias?|fragancias?|parfum)\b")),
    ("notebook", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:notebooks?|laptops?)\b")),
    ("phone", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:celulares?|telefonos?|smartphones?|iphones?)\b")),
    ("footwear", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:zapatillas?|zapatos?|botines?)\b")),
    ("audio", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:auriculares?|headsets?)\b")),
    ("monitor", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:monitores?)\b")),
    ("keyboard", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:teclados?|keyboards?)\b")),
    ("mouse", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:mouses?|ratones?)\b")),
    ("cpu", re.compile(r"^(?:(?:nuevo|nueva|new)\s+)?(?:procesadores?|cpus?)\b")),
    ("hygiene", re.compile(r"^(?:protectores?|toallas?|toallitas?|panales?|tampones?|compresa|absorbente)\b")),
    ("appliance", re.compile(r"^(?:heladeras?|lavarropas?|lavavajillas?|microondas?|aires?\s+acondicionad)")),
    ("tv", re.compile(r"^(?:(?:smart\s*)?tvs?|televisores?)\b")),
)

_FRAGRANCE_FAMILY = frozenset({"perfume", "perfumes", "fragancia", "fragancias", "colonia"})
_FRAGRANCE_STRONG_RE = re.compile(r"\b(?:edp|edt|edc|parfum|eau\s+de)\b")
_FRAGRANCE_LEAD_RE = re.compile(
    r"^(?:(?:nuevo|nueva|new)\s+)?(?:perfume|perfumes|colonia|fragancia|fragancias|parfum)\b"
)
_FRAGRANCE_ML_RE = re.compile(r"\b\d+\s*ml\b")
_FRAGRANCE_ADJUNCT_RE = re.compile(
    r"\b(?:con\s+perfume|aroma\s+(?:a\s+)?perfume|perfume(?:s)?\s+suave)\b"
)
_HYGIENE_OR_CARE_RE = re.compile(
    r"\b(?:protectores?|toallas?(?:\s+humedas?)?|panales?|tampones?|hisopos?|algodon|"
    r"papel\s+higien|jabon|shampoo|acondicionador|crema|desodorante|enjuague|"
    r"pasta\s+dental|panitos?|toallitas?|compresa|absorbente|locion|serum|"
    r"mascarilla|body\s+splash|splash\s+corporal|gel\s+de\s+ducha|aceite\s+corporal)\b"
)

_SECONDARY_INTENT = frozenset(
    {
        "funda",
        "fundas",
        "case",
        "cover",
        "sleeve",
        "protector",
        "soporte",
        "soportes",
        "stand",
        "cooler",
        "mochila",
        "bolso",
        "maletin",
        "ram",
        "memoria",
        "adaptador",
        "cable",
        "cargador",
        "charger",
        "dock",
        "hub",
        "mousepad",
        "repuesto",
        "mica",
        "templado",
        "muestra",
        "tester",
        "decant",
        "atomizador",
        "crema",
        "shampoo",
        "jabon",
        "desodorante",
        "locion",
    }
)

_SECONDARY_LEAD_RE = re.compile(
    r"^(?:funda|fundas|case|cover|sleeve|soporte|soportes|stand|base|cooler|mochila|"
    r"bolso|maletin|adaptador|cable|cargador|memoria|ram|modulo|dock|hub|mousepad|"
    r"protectores?|skin|mica|templado|kit|pasta|muestra|tester|decant|atomizador|"
    r"vaporizador|crema|shampoo|jabon|acondicionador|desodorante|locion|splash|"
    r"repuesto|compatible|toallas?|toallitas?|panales?|tampones?)\b"
)

_SECONDARY_PHRASE_RE = re.compile(
    r"\b(?:funda|sleeve|soporte|cooler\s*pad|cooling\s*pad|pad\s+refriger|"
    r"memoria\s+ram|ram\s+ddr|sodimm|mochila|bolso|maletin|compatible\s+con|"
    r"repuesto\s+(?:de|para)|muestra\s+de|tester\s+de|decant\s+de|"
    r"crema\s+(?:corporal|de\s+manos|hidrat)|body\s+splash|splash\s+corporal|"
    r"locion\s+corporal)\b"
)

_PRIMARY_LEAD_RE = re.compile(
    r"^(?:(?:nuevo|nueva|new)\s+)?(?:notebooks?|laptops?|celulares?|telefonos?|"
    r"smartphones?|monitores?|zapatillas?|auriculares?|headsets?|teclados?|"
    r"keyboards?|mouses?|ratones?|procesadores?|cpus?|perfumes?|fragancias?|"
    r"colonias?|parfum)\b"
)

_TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)

RELEVANCE_STRONG = 0.55
RELEVANCE_PUBLISH = 0.55


def normalize_text(text: str) -> str:
    folded = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")


def query_tokens(product: str) -> list[str]:
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


def _token_in_title(hay: str, token: str) -> bool:
    if not token:
        return False
    if token.isdigit():
        return token in hay
    return re.search(rf"\b{re.escape(token)}\b", hay) is not None


def _synonyms_for(token: str) -> tuple[str, ...]:
    return _CATEGORY_SYNONYMS.get(token, (token,))


def _title_has_category(hay: str, token: str) -> bool:
    return any(_token_in_title(hay, syn) for syn in _synonyms_for(token))


def _has_fragrance_evidence(hay: str) -> bool:
    if _HYGIENE_OR_CARE_RE.search(hay):
        return False
    if _FRAGRANCE_STRONG_RE.search(hay):
        return True
    if _FRAGRANCE_LEAD_RE.match(hay):
        return True
    if _FRAGRANCE_ML_RE.search(hay) and not _FRAGRANCE_ADJUNCT_RE.search(hay):
        return True
    if re.search(r"\b(?:colonia|fragancia|fragancias|parfum)\b", hay):
        return True
    if re.search(r"\bperfumes?\b", hay) and not _FRAGRANCE_ADJUNCT_RE.search(hay):
        return True
    return False


def _has_class_evidence(hay: str, token: str) -> bool:
    if token in _FRAGRANCE_FAMILY:
        return _has_fragrance_evidence(hay)
    return _title_has_category(hay, token)


def _query_has_secondary_intent(tokens: list[str]) -> bool:
    return any(t in _SECONDARY_INTENT for t in tokens)


def _query_only_as_target_of(hay: str, tokens: list[str]) -> bool:
    for tok in tokens:
        for syn in _synonyms_for(tok):
            if len(syn) < 4 or not _token_in_title(hay, syn):
                continue
            as_target = re.search(
                rf"\b(?:para|compatible\s+con|repuesto\s+(?:de|para))\s+{re.escape(syn)}\b",
                hay,
            )
            if not as_target:
                continue
            if re.match(rf"^(?:(?:nuevo|nueva|new)\s+)?{re.escape(syn)}\b", hay):
                continue
            return True
    return False


def _title_looks_like_secondary(hay: str, tokens: list[str]) -> bool:
    if _query_only_as_target_of(hay, tokens):
        return True
    if _SECONDARY_LEAD_RE.match(hay):
        return True
    if _SECONDARY_PHRASE_RE.search(hay) and not _PRIMARY_LEAD_RE.match(hay):
        return True
    return False


def _is_secondary_noise(title_norm: str, tokens: list[str]) -> bool:
    if _query_has_secondary_intent(tokens):
        return False
    if not _title_looks_like_secondary(title_norm, tokens):
        return False
    if _PRIMARY_LEAD_RE.match(title_norm):
        return False
    return True


def _query_implied_family(tokens: list[str]) -> str | None:
    for t in tokens:
        family = _TOKEN_FAMILY.get(t)
        if family is not None:
            return family
    return None


def _title_claimed_family(hay: str) -> str | None:
    for family, pattern in _TITLE_FAMILY_LEAD:
        if pattern.match(hay):
            return family
    if _has_fragrance_evidence(hay) and not _HYGIENE_OR_CARE_RE.search(hay):
        return "fragrance"
    return None


def _is_cross_class_conflict(hay: str, tokens: list[str]) -> bool:
    want = _query_implied_family(tokens)
    if want is None:
        return False
    claimed = _title_claimed_family(hay)
    if claimed is None:
        return False
    return claimed != want


def _significant_title_tokens(hay: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(hay) if t not in _STOP and len(t) >= 2]


def _head_mentions_query(hay: str, tokens: list[str]) -> bool:
    head = _significant_title_tokens(hay)[:3]
    if not head:
        return False
    for tok in tokens:
        for syn in _synonyms_for(tok):
            if any(h == syn or h.startswith(syn) or syn.startswith(h) for h in head):
                return True
    return False


def title_relevance_score(title: str, product: str) -> float:
    tokens = query_tokens(product)
    if not tokens:
        return 1.0
    hay = normalize_text(title)
    if not hay:
        return 0.0

    if _is_secondary_noise(hay, tokens):
        return 0.0
    if _is_cross_class_conflict(hay, tokens):
        return 0.0

    alphas = [t for t in tokens if not t.isdigit() and len(t) >= 4]
    nums = [t for t in tokens if t.isdigit() and len(t) >= 2]
    discriminative = [a for a in alphas if a not in _CATEGORY_OPTIONAL] + nums
    coverage_pool = discriminative if discriminative else tokens

    hit = sum(1 for t in coverage_pool if any(_token_in_title(hay, s) for s in _synonyms_for(t)))
    score = hit / len(coverage_pool)

    if _head_mentions_query(hay, tokens):
        score += 0.25
    if _PRIMARY_LEAD_RE.match(hay):
        score += 0.15

    if len(alphas) == 1 and _has_class_evidence(hay, alphas[0]):
        score = max(score, 0.75)
    if (
        len(alphas) == 1
        and alphas[0] in _CATEGORY_OPTIONAL
        and alphas[0] not in _FRAGRANCE_FAMILY
        and _title_has_category(hay, alphas[0])
    ):
        score = max(score, 0.85 if _head_mentions_query(hay, tokens) else 0.65)

    return max(0.0, min(1.0, score))


def title_matches_query(title: str, product: str) -> bool:
    tokens = query_tokens(product)
    if not tokens:
        return True
    hay = normalize_text(title)
    if not hay:
        return False

    alphas = [t for t in tokens if not t.isdigit() and len(t) >= 4]
    nums = [t for t in tokens if t.isdigit() and len(t) >= 2]
    shorts = [t for t in tokens if t not in alphas and t not in set(nums)]

    for num in nums:
        if num not in hay:
            return False

    required_alphas = [a for a in alphas if a not in _CATEGORY_OPTIONAL]
    if len(alphas) >= 2:
        must = required_alphas if required_alphas else alphas
        for a in must:
            if not _token_in_title(hay, a):
                return False
    elif len(alphas) == 1:
        only = alphas[0]
        if only in _FRAGRANCE_FAMILY:
            if not _has_fragrance_evidence(hay):
                return False
        elif only in _CATEGORY_OPTIONAL:
            if not _has_class_evidence(hay, only) and not _title_has_category(hay, only):
                return False
        elif not _token_in_title(hay, only):
            return False

    for short in shorts:
        if short.isdigit() and len(short) == 1:
            if not re.search(rf"(?<!\d){re.escape(short)}(?!\d)", hay):
                return False
        elif len(short) >= 2 and (nums or len(alphas) >= 2):
            if not _token_in_title(hay, short):
                return False

    if _is_secondary_noise(hay, tokens):
        return False
    if _is_cross_class_conflict(hay, tokens):
        return False
    return True


def is_relevant_result(title: str, product: str) -> bool:
    """Publish gate: structural match + score ≥ RELEVANCE_PUBLISH (§V29)."""
    if not title_matches_query(title, product):
        return False
    return title_relevance_score(title, product) >= RELEVANCE_PUBLISH
