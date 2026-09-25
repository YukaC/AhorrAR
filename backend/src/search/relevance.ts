/**
 * Query↔title relevance (mirrors scraper/ahorrar_scraper/relevance.py).
 * Cheap CPU filter before publishing results.
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

const TOKEN_RE = /[a-z0-9]+/gi;

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
      if (!hay.includes(a)) return false;
    }
  } else if (alphas.length === 1) {
    // Lone optional category ("perfume") → titles often omit it; don't filter.
    // Brand/model alone ("iphone") → must appear (else Coppel baffle ranks #1).
    const only = alphas[0]!;
    if (!CATEGORY_OPTIONAL.has(only) && !hay.includes(only)) return false;
  }

  for (const short of shorts) {
    if (/^\d$/.test(short)) {
      const re = new RegExp(`(?<!\\d)${short}(?!\\d)`);
      if (!re.test(hay)) return false;
    } else if (short.length >= 2 && (nums.length > 0 || alphas.length >= 2)) {
      if (!hay.includes(short)) return false;
    }
  }
  return true;
}
