/**
 * Query↔title relevance (mirrors scraper/ahorrar_scraper/relevance.py).
 *
 * Realistic-search layers (§V27–§V29):
 *   1. `titleMatchesQuery` — hard structural gate (tokens, secondary, class).
 *   2. `titleRelevanceScore` — 0..1 soft score for ranking.
 *   3. `isRelevantResult` — publish only if gate + score ≥ RELEVANCE_PUBLISH
 *      (weak matches never reach the UI, not merely ranked last).
 */

const STOP = new Set([
  'de',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
  'u',
  'del',
  'al',
  'a',
  'en',
  'con',
  'por',
  'para',
  'the',
  'and',
  'or',
  'of',
]);

/** Soft in multi-token queries (brand carries the match). */
const CATEGORY_OPTIONAL = new Set([
  'perfume',
  'perfumes',
  'fragancia',
  'fragancias',
  'colonia',
  'notebook',
  'notebooks',
  'laptop',
  'celular',
  'celulares',
  'telefono',
  'telefonos',
  'zapatilla',
  'zapatillas',
  'auricular',
  'auriculares',
  'monitor',
  'monitores',
  'teclado',
  'mouse',
  'procesadores',
  'procesador',
]);

const CATEGORY_SYNONYMS: Record<string, readonly string[]> = {
  notebook: ['notebook', 'notebooks', 'laptop', 'laptops'],
  notebooks: ['notebook', 'notebooks', 'laptop', 'laptops'],
  laptop: ['notebook', 'notebooks', 'laptop', 'laptops'],
  celular: ['celular', 'celulares', 'telefono', 'telefonos', 'smartphone', 'smartphones'],
  celulares: ['celular', 'celulares', 'telefono', 'telefonos', 'smartphone', 'smartphones'],
  telefono: ['celular', 'celulares', 'telefono', 'telefonos', 'smartphone', 'smartphones'],
  telefonos: ['celular', 'celulares', 'telefono', 'telefonos', 'smartphone', 'smartphones'],
  monitor: ['monitor', 'monitores'],
  monitores: ['monitor', 'monitores'],
  zapatilla: ['zapatilla', 'zapatillas'],
  zapatillas: ['zapatilla', 'zapatillas'],
  auricular: ['auricular', 'auriculares', 'headset', 'headsets'],
  auriculares: ['auricular', 'auriculares', 'headset', 'headsets'],
  teclado: ['teclado', 'teclados', 'keyboard', 'keyboards'],
  mouse: ['mouse', 'raton', 'ratones'],
  procesador: ['procesador', 'procesadores', 'cpu', 'cpus'],
  procesadores: ['procesador', 'procesadores', 'cpu', 'cpus'],
  perfume: ['perfume', 'perfumes', 'fragancia', 'fragancias', 'colonia', 'parfum'],
  perfumes: ['perfume', 'perfumes', 'fragancia', 'fragancias', 'colonia', 'parfum'],
  fragancia: ['perfume', 'perfumes', 'fragancia', 'fragancias', 'colonia', 'parfum'],
  fragancias: ['perfume', 'perfumes', 'fragancia', 'fragancias', 'colonia', 'parfum'],
  colonia: ['perfume', 'perfumes', 'fragancia', 'fragancias', 'colonia', 'parfum'],
};

/** Token → product family for cross-class rejection (§V29). */
const TOKEN_FAMILY: Record<string, string> = {
  perfume: 'fragrance',
  perfumes: 'fragrance',
  fragancia: 'fragrance',
  fragancias: 'fragrance',
  colonia: 'fragrance',
  notebook: 'notebook',
  notebooks: 'notebook',
  laptop: 'notebook',
  celular: 'phone',
  celulares: 'phone',
  telefono: 'phone',
  telefonos: 'phone',
  smartphone: 'phone',
  smartphones: 'phone',
  iphone: 'phone',
  zapatilla: 'footwear',
  zapatillas: 'footwear',
  auricular: 'audio',
  auriculares: 'audio',
  headset: 'audio',
  headsets: 'audio',
  monitor: 'monitor',
  monitores: 'monitor',
  teclado: 'keyboard',
  mouse: 'mouse',
  procesador: 'cpu',
  procesadores: 'cpu',
};

/** Title lead → claimed product family (alien vs query ⇒ drop). */
const TITLE_FAMILY_LEAD: readonly { family: string; re: RegExp }[] = [
  { family: 'fragrance', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:perfumes?|colonias?|fragancias?|parfum)\b/ },
  { family: 'notebook', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:notebooks?|laptops?)\b/ },
  { family: 'phone', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:celulares?|telefonos?|smartphones?|iphones?)\b/ },
  { family: 'footwear', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:zapatillas?|zapatos?|botines?)\b/ },
  { family: 'audio', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:auriculares?|headsets?)\b/ },
  { family: 'monitor', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:monitores?)\b/ },
  { family: 'keyboard', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:teclados?|keyboards?)\b/ },
  { family: 'mouse', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:mouses?|ratones?)\b/ },
  { family: 'cpu', re: /^(?:(?:nuevo|nueva|new)\s+)?(?:procesadores?|cpus?)\b/ },
  { family: 'hygiene', re: /^(?:protectores?|toallas?|toallitas?|panales?|tampones?|compresa|absorbente)\b/ },
  { family: 'appliance', re: /^(?:heladeras?|lavarropas?|lavavajillas?|microondas?|aires?\s+acondicionad)/ },
  { family: 'tv', re: /^(?:(?:smart\s*)?tvs?|televisores?)\b/ },
];

const FRAGRANCE_STRONG_RE = /\b(?:edp|edt|edc|parfum|eau\s+de)\b/;
const FRAGRANCE_LEAD_RE =
  /^(?:(?:nuevo|nueva|new)\s+)?(?:perfume|perfumes|colonia|fragancia|fragancias|parfum)\b/;
const FRAGRANCE_ML_RE = /\b\d+\s*ml\b/;
const FRAGRANCE_ADJUNCT_RE = /\b(?:con\s+perfume|aroma\s+(?:a\s+)?perfume|perfume(?:s)?\s+suave)\b/;
const HYGIENE_OR_CARE_RE =
  /\b(?:protectores?|toallas?(?:\s+humedas?)?|panales?|tampones?|hisopos?|algodon|papel\s+higien|jabon|shampoo|acondicionador|crema|desodorante|enjuague|pasta\s+dental|panitos?|toallitas?|compresa|absorbente|locion|serum|mascarilla|body\s+splash|splash\s+corporal|gel\s+de\s+ducha|aceite\s+corporal)\b/;

const FRAGRANCE_FAMILY = new Set([
  'perfume',
  'perfumes',
  'fragancia',
  'fragancias',
  'colonia',
]);

const SECONDARY_INTENT = new Set([
  'funda',
  'fundas',
  'case',
  'cover',
  'sleeve',
  'protector',
  'soporte',
  'soportes',
  'stand',
  'cooler',
  'mochila',
  'bolso',
  'maletin',
  'ram',
  'memoria',
  'adaptador',
  'cable',
  'cargador',
  'charger',
  'dock',
  'hub',
  'mousepad',
  'repuesto',
  'mica',
  'templado',
  'muestra',
  'tester',
  'decant',
  'atomizador',
  'crema',
  'shampoo',
  'jabon',
  'desodorante',
  'locion',
]);

const SECONDARY_LEAD_RE =
  /^(?:funda|fundas|case|cover|sleeve|soporte|soportes|stand|base|cooler|mochila|bolso|maletin|adaptador|cable|cargador|memoria|ram|modulo|dock|hub|mousepad|protectores?|skin|mica|templado|kit|pasta|muestra|tester|decant|atomizador|vaporizador|crema|shampoo|jabon|acondicionador|desodorante|locion|splash|repuesto|compatible|toallas?|toallitas?|panales?|tampones?)\b/;

const SECONDARY_PHRASE_RE =
  /\b(?:funda|sleeve|soporte|cooler\s*pad|cooling\s*pad|pad\s+refriger|memoria\s+ram|ram\s+ddr|sodimm|mochila|bolso|maletin|compatible\s+con|repuesto\s+(?:de|para)|muestra\s+de|tester\s+de|decant\s+de|crema\s+(?:corporal|de\s+manos|hidrat)|body\s+splash|splash\s+corporal|locion\s+corporal)\b/;

const PRIMARY_LEAD_RE =
  /^(?:(?:nuevo|nueva|new)\s+)?(?:notebooks?|laptops?|celulares?|telefonos?|smartphones?|monitores?|zapatillas?|auriculares?|headsets?|teclados?|keyboards?|mouses?|ratones?|procesadores?|cpus?|perfumes?|fragancias?|colonias?|parfum)\b/;

const TOKEN_RE = /[a-z0-9]+/gi;

/** Ranking tier: strong vs weak (§V28). */
export const RELEVANCE_STRONG = 0.55;

/** Publish floor — below this the offer never reaches the UI (§V29). */
export const RELEVANCE_PUBLISH = 0.55;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function queryTokens(product: string): string[] {
  const norm = normalizeText(product);
  const raw = norm.match(TOKEN_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of raw) {
    if (STOP.has(tok) || seen.has(tok)) continue;
    if (/^\d+$/.test(tok) || tok.length >= 2) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-token match (⊥ substring noise like "note" inside unrelated words). */
function tokenInTitle(hay: string, token: string): boolean {
  if (token.length === 0) return false;
  if (/^\d+$/.test(token)) return hay.includes(token);
  return new RegExp(`\\b${escapeRe(token)}\\b`).test(hay);
}

function synonymsFor(token: string): readonly string[] {
  return CATEGORY_SYNONYMS[token] ?? [token];
}

function titleHasCategory(hay: string, token: string): boolean {
  return synonymsFor(token).some((syn) => tokenInTitle(hay, syn));
}

function hasFragranceEvidence(hay: string): boolean {
  if (HYGIENE_OR_CARE_RE.test(hay)) return false;
  if (FRAGRANCE_STRONG_RE.test(hay)) return true;
  if (FRAGRANCE_LEAD_RE.test(hay)) return true;
  if (FRAGRANCE_ML_RE.test(hay) && !FRAGRANCE_ADJUNCT_RE.test(hay)) return true;
  if (/\b(?:colonia|fragancia|fragancias|parfum)\b/.test(hay)) return true;
  if (/\bperfumes?\b/.test(hay) && !FRAGRANCE_ADJUNCT_RE.test(hay)) return true;
  return false;
}

function hasClassEvidence(hay: string, token: string): boolean {
  if (FRAGRANCE_FAMILY.has(token)) return hasFragranceEvidence(hay);
  return titleHasCategory(hay, token);
}

function queryHasSecondaryIntent(tokens: string[]): boolean {
  return tokens.some((t) => SECONDARY_INTENT.has(t));
}

function queryOnlyAsTargetOf(hay: string, tokens: string[]): boolean {
  for (const tok of tokens) {
    for (const syn of synonymsFor(tok)) {
      if (syn.length < 4 || !tokenInTitle(hay, syn)) continue;
      const asTarget = new RegExp(
        `\\b(?:para|compatible\\s+con|repuesto\\s+(?:de|para))\\s+${escapeRe(syn)}\\b`,
      );
      if (!asTarget.test(hay)) continue;
      const head = new RegExp(`^(?:(?:nuevo|nueva|new)\\s+)?${escapeRe(syn)}\\b`);
      if (head.test(hay)) continue;
      return true;
    }
  }
  return false;
}

function titleLooksLikeSecondary(hay: string, tokens: string[]): boolean {
  if (queryOnlyAsTargetOf(hay, tokens)) return true;
  if (SECONDARY_LEAD_RE.test(hay)) return true;
  if (SECONDARY_PHRASE_RE.test(hay) && !PRIMARY_LEAD_RE.test(hay)) return true;
  return false;
}

function isSecondaryNoise(titleNorm: string, tokens: string[]): boolean {
  if (queryHasSecondaryIntent(tokens)) return false;
  if (!titleLooksLikeSecondary(titleNorm, tokens)) return false;
  if (PRIMARY_LEAD_RE.test(titleNorm)) return false;
  return true;
}

function queryImpliedFamily(tokens: string[]): string | null {
  for (const t of tokens) {
    const family = TOKEN_FAMILY[t];
    if (family !== undefined) return family;
  }
  return null;
}

function titleClaimedFamily(hay: string): string | null {
  for (const { family, re } of TITLE_FAMILY_LEAD) {
    if (re.test(hay)) return family;
  }
  // Fragrance without lead noun but with EDP/ml evidence.
  if (hasFragranceEvidence(hay) && !HYGIENE_OR_CARE_RE.test(hay)) return 'fragrance';
  return null;
}

/** Query asks for family A, title clearly claims family B → drop (§V29). */
function isCrossClassConflict(hay: string, tokens: string[]): boolean {
  const want = queryImpliedFamily(tokens);
  if (want === null) return false;
  const claimed = titleClaimedFamily(hay);
  if (claimed === null) return false;
  return claimed !== want;
}

function significantTitleTokens(hay: string): string[] {
  const raw = hay.match(TOKEN_RE) ?? [];
  return raw.filter((t) => !STOP.has(t) && t.length >= 2);
}

function headMentionsQuery(hay: string, tokens: string[]): boolean {
  const head = significantTitleTokens(hay).slice(0, 3);
  if (head.length === 0) return false;
  for (const tok of tokens) {
    for (const syn of synonymsFor(tok)) {
      if (head.some((h) => h === syn || h.startsWith(syn) || syn.startsWith(h))) return true;
    }
  }
  return false;
}

/**
 * Soft relevance 0..1 for ranking (§V28). Higher = better primary match.
 */
export function titleRelevanceScore(title: string, product: string): number {
  const tokens = queryTokens(product);
  if (tokens.length === 0) return 1;
  const hay = normalizeText(title);
  if (hay.length === 0) return 0;

  if (isSecondaryNoise(hay, tokens)) return 0;
  if (isCrossClassConflict(hay, tokens)) return 0;

  const alphas = tokens.filter((t) => !/^\d+$/.test(t) && t.length >= 4);
  const nums = tokens.filter((t) => /^\d+$/.test(t) && t.length >= 2);
  const discriminative = [...alphas.filter((a) => !CATEGORY_OPTIONAL.has(a)), ...nums];
  const coveragePool = discriminative.length > 0 ? discriminative : tokens;

  let hit = 0;
  for (const t of coveragePool) {
    if (synonymsFor(t).some((s) => tokenInTitle(hay, s))) hit += 1;
  }
  let score = hit / coveragePool.length;

  if (headMentionsQuery(hay, tokens)) score += 0.25;
  if (PRIMARY_LEAD_RE.test(hay)) score += 0.15;

  if (alphas.length === 1 && hasClassEvidence(hay, alphas[0]!)) {
    score = Math.max(score, 0.75);
  }
  if (
    alphas.length === 1 &&
    CATEGORY_OPTIONAL.has(alphas[0]!) &&
    !FRAGRANCE_FAMILY.has(alphas[0]!) &&
    titleHasCategory(hay, alphas[0]!)
  ) {
    score = Math.max(score, headMentionsQuery(hay, tokens) ? 0.85 : 0.65);
  }

  return Math.max(0, Math.min(1, score));
}

export function titleMatchesQuery(title: string, product: string): boolean {
  const tokens = queryTokens(product);
  if (tokens.length === 0) return true;
  const hay = normalizeText(title);
  if (hay.length === 0) return false;

  const alphas = tokens.filter((t) => !/^\d+$/.test(t) && t.length >= 4);
  const nums = tokens.filter((t) => /^\d+$/.test(t) && t.length >= 2);
  const numSet = new Set(nums);
  const alphaSet = new Set(alphas);
  const shorts = tokens.filter((t) => !alphaSet.has(t) && !numSet.has(t));

  for (const num of nums) {
    if (!hay.includes(num)) return false;
  }

  const requiredAlphas = alphas.filter((a) => !CATEGORY_OPTIONAL.has(a));
  if (alphas.length >= 2) {
    const must = requiredAlphas.length > 0 ? requiredAlphas : alphas;
    for (const a of must) {
      if (!tokenInTitle(hay, a)) return false;
    }
  } else if (alphas.length === 1) {
    const only = alphas[0]!;
    if (FRAGRANCE_FAMILY.has(only)) {
      if (!hasFragranceEvidence(hay)) return false;
    } else if (CATEGORY_OPTIONAL.has(only)) {
      if (!hasClassEvidence(hay, only) && !titleHasCategory(hay, only)) return false;
    } else if (!tokenInTitle(hay, only)) {
      return false;
    }
  }

  for (const short of shorts) {
    if (/^\d$/.test(short)) {
      const re = new RegExp(`(?<!\\d)${escapeRe(short)}(?!\\d)`);
      if (!re.test(hay)) return false;
    } else if (short.length >= 2 && (nums.length > 0 || alphas.length >= 2)) {
      if (!tokenInTitle(hay, short)) return false;
    }
  }

  if (isSecondaryNoise(hay, tokens)) return false;
  if (isCrossClassConflict(hay, tokens)) return false;
  return true;
}

/**
 * Publish gate for the live pipeline (§V29): structural match + strong score.
 * Weak / alien-class hits are dropped, not demoted.
 */
export function isRelevantResult(title: string, product: string): boolean {
  if (!titleMatchesQuery(title, product)) return false;
  return titleRelevanceScore(title, product) >= RELEVANCE_PUBLISH;
}
