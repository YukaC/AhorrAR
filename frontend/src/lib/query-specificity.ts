/**
 * Detect category-only product queries (soft UX hint).
 * Mirrors backend CATEGORY_OPTIONAL tokens — not a full relevance port.
 */

const STOP = new Set([
  'de',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'y',
  'o',
  'del',
  'al',
  'a',
  'en',
  'con',
  'por',
  'para',
]);

/** Single-token (or synonym-only) category searches that benefit from brand/model. */
const CATEGORY_ONLY = new Set([
  'perfume',
  'perfumes',
  'fragancia',
  'fragancias',
  'colonia',
  'notebook',
  'notebooks',
  'laptop',
  'laptops',
  'celular',
  'celulares',
  'telefono',
  'telefonos',
  'smartphone',
  'smartphones',
  'zapatilla',
  'zapatillas',
  'auricular',
  'auriculares',
  'monitor',
  'monitores',
  'teclado',
  'teclados',
  'mouse',
  'procesador',
  'procesadores',
  'iphone',
  'ipad',
  'tablet',
  'tablets',
]);

const HINT_EXAMPLES: Record<string, string> = {
  perfume: 'Dior Sauvage, Carolina Herrera 212',
  perfumes: 'Dior Sauvage, Carolina Herrera 212',
  fragancia: 'Dior Sauvage, Chanel N°5',
  fragancias: 'Dior Sauvage, Chanel N°5',
  colonia: '212 Men, Acqua di Gio',
  notebook: 'Lenovo IdeaPad, HP Pavilion',
  notebooks: 'Lenovo IdeaPad, HP Pavilion',
  laptop: 'Lenovo IdeaPad, Dell Inspiron',
  laptops: 'Lenovo IdeaPad, Dell Inspiron',
  celular: 'iPhone 16, Samsung S24',
  celulares: 'iPhone 16, Samsung S24',
  telefono: 'iPhone 16, Motorola G',
  telefonos: 'iPhone 16, Motorola G',
  smartphone: 'iPhone 16, Samsung S24',
  smartphones: 'iPhone 16, Samsung S24',
  zapatilla: 'Nike Revolution, Adidas Samba',
  zapatillas: 'Nike Revolution, Adidas Samba',
  auricular: 'Sony WH-1000XM5, AirPods',
  auriculares: 'Sony WH-1000XM5, AirPods',
  monitor: 'Samsung 27 4K, LG UltraGear',
  monitores: 'Samsung 27 4K, LG UltraGear',
  teclado: 'Logitech MX Keys, Keychron',
  teclados: 'Logitech MX Keys, Keychron',
  mouse: 'Logitech MX Master, Razer',
  procesador: 'Ryzen 5 5600, Intel i5',
  procesadores: 'Ryzen 5 5600, Intel i5',
  iphone: 'iPhone 16 128GB, iPhone 15 Pro',
  ipad: 'iPad Air M2, iPad 10',
  tablet: 'iPad Air, Samsung Tab S9',
  tablets: 'iPad Air, Samsung Tab S9',
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function queryTokens(product: string): string[] {
  const raw = normalize(product).match(/[a-z0-9]+/gi) ?? [];
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

/** True when the query is only a broad product class (no brand/model). */
export function isCategoryOnlyQuery(product: string): boolean {
  const tokens = queryTokens(product);
  if (tokens.length === 0) return false;
  // Model numbers (iphone 16) count as specificity.
  if (tokens.some((t) => /^\d+$/.test(t))) return false;
  const alphas = tokens.filter((t) => !/^\d+$/.test(t) && t.length >= 3);
  if (alphas.length !== 1) return false;
  return CATEGORY_ONLY.has(alphas[0]!);
}

/** Short hint copy when the query is category-only; null otherwise. */
export function specificityHintFor(product: string): string | null {
  if (!isCategoryOnlyQuery(product)) return null;
  const token = queryTokens(product).find((t) => CATEGORY_ONLY.has(t));
  if (token === undefined) return null;
  const examples = HINT_EXAMPLES[token] ?? 'marca o modelo';
  return `Tip: sumá marca o modelo para resultados más precisos (ej. ${examples}).`;
}
