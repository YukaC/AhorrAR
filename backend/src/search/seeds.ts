/**
 * AR discovery (§C, §V13, §V19): reputation by heuristic + curated index.
 * Seeds are discovery HUBS + curated AR shop index + procedural guesses.
 * BFS expands to any AR host found in links; curated/discovered shops get
 * their search URL crawled via guess URLs (never index results directly).
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { SearchParams } from '../../../shared/contract.ts';

export type ShopPlatform = 'vtex' | 'shopify' | 'woo' | 'tiendanube' | 'oscommerce' | 'unknown';

export interface ArShopEntry {
  host: string;
  category: string;
  curated: boolean;
  /** Optional canonical search template with {q} placeholder (VTEX API etc). */
  entry: string | null;
  /** Ecommerce platform fingerprint (optional; absent ⇒ unknown). */
  platform?: ShopPlatform;
  /** false ⇒ skip in buildSeedUrls; absent ⇒ treat as alive (compat). */
  alive?: boolean;
}

export type CategoryId = 'gaming' | 'perfumeria' | 'moda' | 'bazar' | 'electro' | 'general';

const INDEX_VERSION = 3;

/** Shared curated/discovered AR shop index (Node↔Python, §V19). Overridable for tests. */
function arShopsPath(): string {
  const env = process.env['AR_SHOPS_JSON'];
  if (env) return env;
  return new URL('../../../shared/ar-shops.json', import.meta.url).pathname;
}

let _arShopsCache: ArShopEntry[] | null = null;

/** Test-only: clear the in-memory index cache after rewriting AR_SHOPS_JSON. */
export function resetArShopsCacheForTests(): void {
  _arShopsCache = null;
}

function loadArShops(): ArShopEntry[] {
  if (_arShopsCache !== null) return _arShopsCache;
  try {
    const raw = readFileSync(arShopsPath(), 'utf8');
    const parsed = JSON.parse(raw) as { shops?: ArShopEntry[] };
    _arShopsCache = Array.isArray(parsed.shops) ? parsed.shops : [];
  } catch {
    _arShopsCache = [];
  }
  return _arShopsCache;
}

/** Read-modify-write atomically (tmp+rename); safe for concurrent Node/Python adds. */
export function registerDiscoveredShop(host: string, category: string = 'general'): void {
  const clean = host.replace(/^www\./, '').toLowerCase();
  if (clean === '') return;
  const shops = loadArShops();
  if (shops.some((s) => s.host === clean)) return;
  _arShopsCache = [
    ...shops,
    { host: clean, category, curated: false, entry: null, platform: 'unknown', alive: true },
  ];
  const tmp = `${arShopsPath()}.tmp`;
  const data = JSON.stringify({ version: INDEX_VERSION, shops: _arShopsCache }, null, 2);
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, arShopsPath());
  } catch (err) {
    // Non-fatal: index is advisory.
  }
}

export function isCuratedHost(hostRaw: string): boolean {
  const host = hostRaw.replace(/^www\./, '').toLowerCase();
  return loadArShops().some((s) => s.host === host && s.curated);
}

/** Canonical search URL for a curated host with an entry template; else null.
 * Mirrors the Python `curated_search_url` so both engines skip generic guesses
 * on hosts whose search endpoint is known (VTEX API, resultado-busqueda…). */
export function curatedSearchUrl(hostRaw: string, product: string): string | null {
  const host = hostRaw.replace(/^www\./, '').toLowerCase();
  for (const s of loadArShops()) {
    if (s.host !== host || !s.curated) continue;
    if (typeof s.entry !== 'string' || !s.entry.includes('{q}')) return null;
    return s.entry.replaceAll('{q}', encodeURIComponent(product.trim()));
  }
  return null;
}

export function isKnownShopHost(hostRaw: string): boolean {
  const host = hostRaw.replace(/^www\./, '').toLowerCase();
  return loadArShops().some((s) => s.host === host);
}

/** Non-.ar hosts that still sell primarily in Argentina (reputation bootstrap). */
function arShopTrustedHosts(): Set<string> {
  return new Set(loadArShops().map((s) => s.host));
}

/** SERP hubs — robots bypass under STEALTH; never published as offers. */
const SERP_HUBS = new Set([
  'html.duckduckgo.com',
  'duckduckgo.com',
  'www.bing.com',
  'bing.com',
  'www.google.com.ar',
  'google.com.ar',
]);

/** Marketplace listado + JSON API used as procedural entry. */
const MARKETPLACE_SEEDS = new Set([
  'listado.mercadolibre.com.ar',
  'www.mercadolibre.com.ar',
  'mercadolibre.com.ar',
  'api.mercadolibre.com',
]);

const DISCOVERY_HUBS = new Set([...SERP_HUBS, ...MARKETPLACE_SEEDS]);

const BLOCKED_HOST_SUFFIXES = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'wikipedia.org',
  'linkedin.com',
  'apple.com',
  'play.google.com',
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host: string, set: Set<string>): boolean {
  if (set.has(host)) return true;
  for (const h of set) {
    const bare = h.replace(/^www\./, '');
    if (host === bare || host.endsWith(`.${bare}`)) return true;
  }
  return false;
}

export function isDiscoveryHub(url: string): boolean {
  const host = hostOf(url);
  if (host === '') return false;
  return hostMatches(host, DISCOVERY_HUBS);
}

export function isSerpHub(url: string): boolean {
  const host = hostOf(url);
  if (host === '') return false;
  return hostMatches(host, SERP_HUBS);
}

/** AR reputation: ccTLD .ar, trusted curated/discovered index, or known AR .com retailer. */
export function isArHost(hostRaw: string): boolean {
  const host = hostRaw.replace(/^www\./, '').toLowerCase();
  if (host === '') return false;
  if (BLOCKED_HOST_SUFFIXES.some((b) => host === b || host.endsWith(`.${b}`))) return false;
  if (host === 'ar' || host.endsWith('.ar')) return true;
  return arShopTrustedHosts().has(host);
}

export function isAllowed(url: string): boolean {
  const host = hostOf(url);
  if (host === '') return false;
  if (isDiscoveryHub(url)) return true;
  return isArHost(host);
}

/** Publishable product URLs — AR shops; ⊥ SERP hubs (DDG/Bing/Google). */
export function isPublishableResult(url: string): boolean {
  if (isSerpHub(url)) return false;
  return isArHost(hostOf(url));
}

export function isCrawlWorthy(url: string): boolean {
  // Never deepen into SERP chrome — seeds are enqueued once; outbound AR only.
  if (isSerpHub(url)) return false;
  if (!isAllowed(url)) return false;
  try {
    const u = new URL(url);
    if (/\/(login|registration|privacidad|seguridad|ayuda|customer|gz\/|loyalty)/i.test(u.pathname)) return false;
    if (/[?&](registrationType|loginType)=negative_traffic/i.test(u.search)) return false;
    if (/\.(png|jpe?g|gif|webp|css|js|svg|woff2?|ttf|ico|pdf)(\?|$)/i.test(u.pathname)) return false;
  } catch {
    return false;
  }
  return true;
}

/** True when origin is a marketplace we already seed (skip redundant guessSearchUrls). */
export function isMarketplaceSeedHost(url: string): boolean {
  return hostMatches(hostOf(url), MARKETPLACE_SEEDS);
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** Bing wraps targets as /ck/a?...&u=a1<base64>. */
export function unwrapSerpRedirect(rawHref: string, pageUrl: string): string[] {
  const cleaned = decodeHtmlEntities(rawHref.trim());
  const found: string[] = [];
  const pushIfHttp = (value: string): void => {
    if (/^https?:\/\//i.test(value)) found.push(value.split('#')[0]!);
  };

  try {
    const abs = new URL(cleaned, pageUrl);
    pushIfHttp(abs.toString());

    const uddg = abs.searchParams.get('uddg');
    if (uddg) pushIfHttp(decodeURIComponent(uddg));

    const uParam = abs.searchParams.get('u');
    if (uParam) {
      const payload = uParam.replace(/^a1/i, '');
      try {
        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        pushIfHttp(decoded);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  // Bare uddg in relative query
  const uddgLoose = /[?&]uddg=([^&]+)/i.exec(cleaned);
  if (uddgLoose) {
    try {
      pushIfHttp(decodeURIComponent(uddgLoose[1]!));
    } catch {
      /* ignore */
    }
  }

  return found;
}


export function productSlug(product: string): string {
  return product
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Lookup platform from the shared index; default unknown (§V19). */
export function platformForHost(hostRaw: string): ShopPlatform {
  const host = hostRaw.replace(/^www\./, '').toLowerCase();
  for (const s of loadArShops()) {
    if (s.host !== host) continue;
    if (s.platform) return s.platform;
    break;
  }
  return 'unknown';
}

/**
 * Platform-aware search-URL guesses (§V19).
 * Known platform → 1–2 URLs; unknown → max 4 (VTEX API, Woo store, /?s=, /search).
 */
export function guessSearchUrls(
  originOrUrl: string,
  product: string,
  platform?: ShopPlatform | null,
): string[] {
  let origin: string;
  try {
    origin = new URL(originOrUrl).origin;
  } catch {
    return [];
  }
  const q = encodeURIComponent(product.trim());
  const base = origin.replace(/\/$/, '');
  const resolved = platform ?? platformForHost(hostOf(origin));

  if (resolved === 'vtex') {
    return [
      `${base}/api/catalog_system/pub/products/search?ft=${q}&_from=0&_to=11`,
      `${base}/busca?ft=${q}`,
    ];
  }
  if (resolved === 'shopify') {
    return [
      `${base}/search/suggest.json?q=${q}&resources[type]=product`,
      `${base}/products.json?limit=12`,
    ];
  }
  if (resolved === 'woo') {
    return [
      `${base}/wp-json/wc/store/v1/products?search=${q}&per_page=12`,
      `${base}/?s=${q}`,
    ];
  }
  if (resolved === 'tiendanube') {
    return [`${base}/products_search/?q=${q}`, `${base}/search?q=${q}`];
  }
  if (resolved === 'oscommerce') {
    return [`${base}/resultado-busqueda.htm?keywords=${q}`, `${base}/?s=${q}`];
  }
  return [
    `${base}/api/catalog_system/pub/products/search?ft=${q}&_from=0&_to=11`,
    `${base}/wp-json/wc/store/v1/products?search=${q}&per_page=12`,
    `${base}/?s=${q}`,
    `${base}/search?q=${q}`,
  ];
}

/** Category hint — used for curated-index seeding priority, not seed lists. */
export function categoryFor(product: string): CategoryId {
  const text = ` ${product} `;
  if (/perfume|fragancia|colonia|makeup|cosmetic|bensimon|julie|bellamar/i.test(text)) return 'perfumeria';
  if (/zapatilla|zapatos|remera|campera|jean|ropa|nike|adidas/i.test(text)) return 'moda';
  if (/motherboard|procesador|cpu|ryzen|gpu|rtx|rx\s*\d|notebook|gaming|teclado|mouse|monitor/i.test(text)) return 'gaming';
  if (/bazar|vajilla|cacerola|cubiertos/i.test(text)) return 'bazar';
  if (/tv\b|televisor|heladera|lavarropas|smart tv/i.test(text)) return 'electro';
  return 'general';
}

/**
 * Procedural seeds:
 * 1) SERP hubs (discover unknown .com.ar)
 * 2) Curated AR shop index (gaming/perfumeria/electro/moda/bazar) — crawls
 *    each shop's search URL via entry template or guess URLs (⊥ direct results).
 * 3) ML listado last (often challenge-blocked)
 */
export function buildSeedUrls(params: SearchParams): string[] {
  const q = params.product.trim();
  const enc = encodeURIComponent(q);
  const slug = encodeURIComponent(q.replace(/\s+/g, '-'));
  const ddgSite = encodeURIComponent(`${q} site:.com.ar`);
  const ddgBuy = encodeURIComponent(`${q} comprar precio Argentina`);
  const bingAr = encodeURIComponent(`${q} site:com.ar`);
  const bingBuy = encodeURIComponent(`${q} comprar Argentina precio`);

  const hubs = [
    `https://html.duckduckgo.com/html/?q=${ddgSite}`,
    `https://html.duckduckgo.com/html/?q=${ddgBuy}`,
    `https://www.bing.com/search?q=${bingAr}&setlang=es-AR&cc=AR`,
    `https://www.bing.com/search?q=${bingBuy}&setlang=es-AR&cc=AR`,
  ];

  const cat = categoryFor(q);
  // Category priority (§V19, mirrors Python build_seed_urls): same-category
  // shops first; within each block, entry shops before entry-null guesses
  // (a known-good entry beats 7 speculative guesses under the 20 cap).
  const sameEntry: string[] = [];
  const sameNull: string[] = [];
  const otherEntry: string[] = [];
  const otherNull: string[] = [];
  for (const shop of loadArShops()) {
    if (!shop.curated) continue; // discovered shops: reached via BFS, not seeded
    if (shop.alive === false) continue;
    const sameCategory = shop.category === cat;
    if (typeof shop.entry === 'string') {
      const url = shop.entry.replaceAll('{q}', enc);
      (sameCategory ? sameEntry : otherEntry).push(url);
    } else {
      const urls = guessSearchUrls(`https://www.${shop.host}`, q, shop.platform ?? null);
      (sameCategory ? sameNull : otherNull).push(...urls);
    }
  }

  const indexSeeds = [...sameEntry, ...sameNull, ...otherEntry, ...otherNull].slice(0, 20);

  return [
    ...hubs,
    ...indexSeeds,
    `https://api.mercadolibre.com/sites/MLA/search?q=${enc}&limit=20`,
    `https://listado.mercadolibre.com.ar/${slug}`,
  ];
}


/** Extract outbound AR shop targets from a hub/SERP HTML blob. */
export function extractDiscoveryLinks(pageUrl: string, html: string): string[] {
  const out: string[] = [];
  const pushRaw = (raw: string): void => {
    for (const candidate of unwrapSerpRedirect(raw, pageUrl)) {
      if (isCrawlWorthy(candidate) && isPublishableResult(candidate)) out.push(candidate);
    }
  };

  for (const m of html.matchAll(/href="([^"]+)"/gi)) pushRaw(m[1]!);
  for (const m of html.matchAll(/href='([^']+)'/gi)) pushRaw(m[1]!);
  // Bing sometimes embeds targets only in u= query fragments in the page text
  for (const m of html.matchAll(/[?&]u=a1([A-Za-z0-9+/=_-]{20,})/g)) {
    try {
      const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
      if (isCrawlWorthy(decoded) && isPublishableResult(decoded)) out.push(decoded.split('#')[0]!);
    } catch {
      /* ignore */
    }
  }

  return [...new Set(out)];
}
