/**
 * Query↔title relevance (mirrors scraper/ahorrar_scraper/relevance.py).
 *
 * Realistic-search layers (§V27–§V29 + core-phrase §V31):
 *   1. `titleMatchesQuery` — hard structural gate (tokens, core phrase, class).
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

/** Universal linguistic connectors — core phrase ends at the first of these. */
const CORE_CONNECTORS = new Set([
  'de',
  'del',
  'para',
  'con',
  'sin',
  'compatible',
  'repuesto',
  'accesorio',
  'accesorios',
  'kit',
  'for',
  'tipo',
  'ideal',
]);

/** Leading promo noise — does not count as core content before a connector. */
const LEAD_NOISE = new Set(['nuevo', 'nueva', 'new', 'oferta', 'combo', 'pack', 'set', 'promo']);

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
/** Beauty / ambient / hair / sample — not a wearable fragrance bottle (§V27). */
const FRAGRANCE_ALIEN_RE =
  /\b(?:capilar|cabello|hair(?:\s+mist)?|ambiente|ambientador|difusor|textil|ropa|almohada|auto|coche|vehiculo|home\s+fragrance|linen\s+spray|window\s+perfume|perfume\s+para\s+(?:el\s+)?(?:auto|casa|ambiente))\b/;
const FRAGRANCE_SAMPLE_RE =
  /\b(?:mini|miniatura|vial|sample|muestra|tester|decant|travel\s*size|de\s+cartera|perfume\s+de\s+cartera)\b/;
const FRAGRANCE_TINY_ML_RE = /\b(?:[1-9]|10)\s*ml\b/;
const HYGIENE_OR_CARE_RE =
  /\b(?:protectores?|toallas?(?:\s+humedas?)?|panales?|tampones?|hisopos?|algodon|papel\s+higien|jabon|shampoo|acondicionador|crema|desodorante|enjuague|pasta\s+dental|panitos?|toallitas?|compresa|absorbente|locion|serum|mascarilla|body\s+splash|splash\s+corporal|gel\s+de\s+ducha|aceite\s+corporal)\b/;

const FRAGRANCE_FAMILY = new Set([
  'perfume',
  'perfumes',
  'fragancia',
  'fragancias',
  'colonia',
]);

/** Laptop evidence — rejects paper notebooks; brands/CPU chips alone are NOT enough. */
const NOTEBOOK_FAMILY = new Set(['notebook', 'notebooks', 'laptop', 'laptops']);
const NOTEBOOK_STRONG_RE =
  /\b(?:notebooks?|laptops?|macbook|chromebook|thinkpad|ideapad|yoga|netbook|ultrabook)\b/;
const NOTEBOOK_PAPER_RE =
  /\b(?:composition|pastel|journal|diary|graph\s+paper|cuaderno|rayado|espiral|spiral|lined|wide\s+ruled|college\s+ruled|unicorn|for\s+(?:dog|cat)\s+lovers|sketchbook|libreta)\b/;

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
  'mouse',
  'raton',
  'mice',
  'dock',
  'hub',
  'mousepad',
  'repuesto',
  'mica',
  'templado',
  'vidrio',
  'muestra',
  'tester',
  'decant',
  'atomizador',
  'crema',
  'shampoo',
  'jabon',
  'desodorante',
  'locion',
  'mini',
  'miniatura',
  'vial',
  'capilar',
]);

const SECONDARY_LEAD_RE =
  /^(?:funda|fundas|case|cover|sleeve|soporte|soportes|stand|base|cooler|mochila|bolso|maletin|adaptador|cable|cargador|memoria|ram|modulo|dock|hub|mousepad|protectores?|skin|mica|templado|vidrio|kit|pasta|muestra|tester|decant|atomizador|vaporizador|crema|shampoo|jabon|acondicionador|desodorante|locion|splash|repuesto|compatible|toallas?|toallitas?|panales?|tampones?|mini|miniatura|vial)\b/;

const SECONDARY_PHRASE_RE =
  /\b(?:funda|sleeve|soporte|cooler\s*pad|cooling\s*pad|pad\s+refriger|memoria\s+ram|ram\s+ddr|sodimm|mochila|bolso|maletin|compatible\s+con|repuesto\s+(?:de|para)|muestra\s+de|tester\s+de|decant\s+de|crema\s+(?:corporal|de\s+manos|hidrat)|body\s+splash|splash\s+corporal|locion\s+corporal|perfume\s+de\s+cartera|travel\s*size)\b/;


const PRIMARY_LEAD_RE =
  /^(?:(?:nuevo|nueva|new)\s+)?(?:notebooks?|laptops?|celulares?|telefonos?|smartphones?|monitores?|zapatillas?|auriculares?|headsets?|teclados?|keyboards?|mouses?|ratones?|procesadores?|cpus?|perfumes?|fragancias?|colonias?|parfum)\b/;

const TOKEN_RE = /[a-z0-9]+/gi;

/** Ranking tier: strong vs weak (§V28). */
export const RELEVANCE_STRONG = 0.55;

/**
 * Publish floor for specific queries (brand/model) — §V29.
 * Category-only queries use {@link RELEVANCE_PUBLISH_CATEGORY} (stricter).
 */
export const RELEVANCE_PUBLISH = 0.55;

/**
 * Publish floor when the query is only a product class ("perfume", "notebook").
 * Soft boosts for real class evidence land at ≥0.75, so amplitude of primary
 * products is kept; weak title-only hits (~0.55–0.65) are dropped.
 */
export const RELEVANCE_PUBLISH_CATEGORY = 0.72;

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
  if (FRAGRANCE_ALIEN_RE.test(hay)) return false;
  if (FRAGRANCE_SAMPLE_RE.test(hay)) return false;
  // Mini bottles without eau markers are usually samples/testers.
  if (FRAGRANCE_TINY_ML_RE.test(hay) && !FRAGRANCE_STRONG_RE.test(hay)) return false;
  if (FRAGRANCE_STRONG_RE.test(hay)) return true;
  if (FRAGRANCE_LEAD_RE.test(hay) && FRAGRANCE_ML_RE.test(hay)) return true;
  if (
    FRAGRANCE_LEAD_RE.test(hay) &&
    /\b(?:hombre|mujer|unisex|men|women|kids|infantil|ninos?|ninas?)\b/.test(hay)
  ) {
    return true;
  }
  // "212 Men 100ml" / "Sauvage 100ml pour homme" without the word perfume.
  if (
    FRAGRANCE_ML_RE.test(hay) &&
    !FRAGRANCE_ADJUNCT_RE.test(hay) &&
    /\b(?:hombre|mujer|unisex|men|women|pour\s+homme|pour\s+femme|him|her)\b/.test(hay)
  ) {
    return true;
  }
  if (/\b(?:colonia|fragancia|fragancias)\b/.test(hay) && FRAGRANCE_ML_RE.test(hay)) return true;
  return false;
}

function hasNotebookEvidence(hay: string): boolean {
  if (NOTEBOOK_PAPER_RE.test(hay)) return false;
  if (NOTEBOOK_STRONG_RE.test(hay)) return true;
  if (/\blaptops?\b/.test(hay)) return true;
  // Screen size + storage pattern typical of PCs
  if (/\b\d{1,2}(?:[.,]\d)?\s*(?:\"|''|pulg|inch)/.test(hay) && /\b(?:\d+\s*gb|\d+\s*ssd)\b/.test(hay)) {
    return true;
  }
  return false;
}

function hasClassEvidence(hay: string, token: string): boolean {
  if (FRAGRANCE_FAMILY.has(token)) return hasFragranceEvidence(hay);
  if (NOTEBOOK_FAMILY.has(token)) return hasNotebookEvidence(hay);
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
        `\\b(?:para|compatible\\s+con|for|repuesto\\s+(?:de|para)|tipo|similar\\s+a|ideal\\s+para|con)\\s+${escapeRe(syn)}\\b`,
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

/**
 * Core phrase hit, or category class evidence **inside the core** standing in
 * for a missing noun (e.g. "Dior Sauvage EDP" for "perfume").
 * Non-category tokens (brand/model) must still land in the core when present.
 */
function coreRequirementSatisfied(titleNorm: string, tokens: string[]): boolean {
  if (queryInCorePhrase(titleNorm, tokens)) return true;
  const cats = tokens.filter((t) => CATEGORY_OPTIONAL.has(t));
  if (cats.length === 0) return false;
  const coreHay = corePhraseTokens(titleNorm).join(' ');
  if (coreHay.length === 0) return false;
  if (!cats.some((c) => hasClassEvidence(coreHay, c))) return false;
  const required = tokens.filter(
    (t) => !CATEGORY_OPTIONAL.has(t) && !/^\d+$/.test(t) && t.length >= 3,
  );
  if (required.length === 0) return true;
  const core = corePhraseTokens(titleNorm);
  return required.every((t) =>
    synonymsFor(t).some((syn) =>
      core.some((c) => c === syn || c.startsWith(syn) || syn.startsWith(c)),
    ),
  );
}

function isSecondaryNoise(titleNorm: string, tokens: string[]): boolean {
  // Secondary-intent queries (cable, funda, …): require the noun in the core
  // phrase — do NOT disable the accessory filter.
  if (queryHasSecondaryIntent(tokens)) {
    return !queryInCorePhrase(titleNorm, tokens);
  }
  // Primary product queries: query must appear in the core (before connectors).
  if (!coreRequirementSatisfied(titleNorm, tokens)) return true;
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

/** Strip parentheticals and trailing negation clauses from a normalized title. */
function stripParensAndNegations(hay: string): string {
  let s = hay.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/\b(?:no|excepto)\b[\s\S]*$/, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Core phrase tokens: content before the first linguistic connector (§V31).
 * Leading promo noise does not lock the core before a connector (combo de X).
 */
export function corePhraseTokens(titleNorm: string): string[] {
  const cleaned = stripParensAndNegations(titleNorm);
  const raw = cleaned.match(TOKEN_RE) ?? [];
  const core: string[] = [];
  for (const t of raw) {
    if (CORE_CONNECTORS.has(t)) {
      const hasContent = core.some((c) => !LEAD_NOISE.has(c));
      if (hasContent) break;
      continue;
    }
    if (STOP.has(t)) continue;
    if (t.length < 2 && !/^\d+$/.test(t)) continue;
    core.push(t);
  }
  return core;
}

/** True when at least one query token/synonym lands inside the core phrase. */
export function queryInCorePhrase(titleNorm: string, tokens: string[]): boolean {
  const core = corePhraseTokens(titleNorm);
  if (core.length === 0) return false;
  for (const tok of tokens) {
    for (const syn of synonymsFor(tok)) {
      if (core.some((c) => c === syn || c.startsWith(syn) || syn.startsWith(c))) return true;
    }
  }
  return false;
}

/**
 * Noun coverage: if the query has a category noun + something else (brand/model),
 * the title must include that noun (or synonym) — brand-only is not enough.
 */
function nounCoverageOk(hay: string, tokens: string[]): boolean {
  const nouns = tokens.filter((t) => CATEGORY_OPTIONAL.has(t) || SECONDARY_INTENT.has(t));
  const other = tokens.filter((t) => !nouns.includes(t) && !/^\d+$/.test(t) && t.length >= 3);
  if (nouns.length === 0 || other.length === 0) return true;
  // Class evidence (EDP, notebook patterns) may stand in for the category word.
  return nouns.some(
    (n) => synonymsFor(n).some((s) => tokenInTitle(hay, s)) || hasClassEvidence(hay, n),
  );
}

/** Soft penalty: query hit after N non-noise prior core tokens. */
function priorTokenPenalty(titleNorm: string, tokens: string[]): number {
  const core = corePhraseTokens(titleNorm);
  let firstHit = -1;
  for (let i = 0; i < core.length; i++) {
    const c = core[i]!;
    for (const tok of tokens) {
      for (const syn of synonymsFor(tok)) {
        if (c === syn || c.startsWith(syn) || syn.startsWith(c)) {
          firstHit = i;
          break;
        }
      }
      if (firstHit >= 0) break;
    }
    if (firstHit >= 0) break;
  }
  if (firstHit <= 0) return 0;
  const prior = core.slice(0, firstHit).filter((c) => !LEAD_NOISE.has(c));
  if (prior.length === 0) return 0;
  // Accessory/secondary tokens before the hit → strong demotion (vidrio/templado/…).
  // Brand/category before noun/model ("Lenovo Notebook", "Procesador AMD Ryzen") → mild.
  if (prior.some((p) => SECONDARY_INTENT.has(p))) {
    return Math.min(0.6, prior.length * 0.25);
  }
  return Math.min(0.2, prior.length * 0.08);
}

function headMentionsQuery(hay: string, tokens: string[]): boolean {
  // Only the first contentful core tokens count as "head" (not raw title head).
  const head = corePhraseTokens(hay).filter((c) => !LEAD_NOISE.has(c)).slice(0, 2);
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
    !NOTEBOOK_FAMILY.has(alphas[0]!) &&
    titleHasCategory(hay, alphas[0]!)
  ) {
    score = Math.max(score, headMentionsQuery(hay, tokens) ? 0.85 : 0.65);
  }

  // Apply late-hit penalty after floors so prior tokens can still demote.
  score -= priorTokenPenalty(hay, tokens);

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
    } else if (NOTEBOOK_FAMILY.has(only)) {
      if (!hasNotebookEvidence(hay)) return false;
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
  if (!nounCoverageOk(hay, tokens)) return false;
  return true;
}

/**
 * Publish gate for the live pipeline (§V29): structural match + score floor.
 * Category-only queries need a higher floor; branded queries keep amplitude.
 */
export function isCategoryOnlyProduct(product: string): boolean {
  const tokens = queryTokens(product);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => /^\d+$/.test(t))) return false;
  const alphas = tokens.filter((t) => !/^\d+$/.test(t) && t.length >= 4);
  if (alphas.length !== 1) return false;
  return CATEGORY_OPTIONAL.has(alphas[0]!);
}

export function publishFloorFor(product: string): number {
  return isCategoryOnlyProduct(product) ? RELEVANCE_PUBLISH_CATEGORY : RELEVANCE_PUBLISH;
}

export function isRelevantResult(title: string, product: string): boolean {
  if (!titleMatchesQuery(title, product)) return false;
  return titleRelevanceScore(title, product) >= publishFloorFor(product);
}
