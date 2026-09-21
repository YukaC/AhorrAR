/**
 * AR discovery (§C, §V13): reputation by heuristic (not a closed shop list).
 * Seeds are discovery HUBS + marketplace search — BFS expands to any AR host
 * found in links, then procedurally guesses that host's search URL.
 */

import type { SearchParams } from '../../../shared/contract.ts';

export type CategoryId = 'pc' | 'perfume' | 'moda' | 'bazar' | 'electro' | 'general';

/** Non-.ar hosts that still sell primarily in Argentina (reputation bootstrap). */
const AR_COM_BOOTSTRAP = new Set([
  'fravega.com',
  'farmacity.com',
  'compragamer.com',
  'musimundo.com',
  'garbarino.com',
  'cetrogar.com',
]);

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

function hostOf(url: string): string {
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

/** AR reputation: ccTLD .ar, or known AR .com retailers. */
export function isArHost(hostRaw: string): boolean {
  const host = hostRaw.replace(/^www\./, '').toLowerCase();
  if (host === '') return false;
  if (BLOCKED_HOST_SUFFIXES.some((b) => host === b || host.endsWith(`.${b}`))) return false;
  if (host === 'ar' || host.endsWith('.ar')) return true;
  if (AR_COM_BOOTSTRAP.has(host)) return true;
  return false;
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

/**
 * Procedural search-URL guesses for a newly discovered AR shop origin.
 * VTEX JSON API first (HTTP-fast), then HTML search templates.
 */
export function guessSearchUrls(originOrUrl: string, product: string): string[] {
  let origin: string;
  try {
    origin = new URL(originOrUrl).origin;
  } catch {
    return [];
  }
  const q = encodeURIComponent(product.trim());
  const slug = productSlug(product);
  const base = origin.replace(/\/$/, '');
  return [
    `${base}/api/catalog_system/pub/products/search?ft=${q}&_from=0&_to=11`,
    `${base}/${slug}?_q=${q}&map=ft`,
    `${base}/search?q=${q}`,
    `${base}/buscar?q=${q}`,
    `${base}/?s=${q}`,
  ];
}

/** Category hint — only used for logging / optional ranking, not seed lists. */
export function categoryFor(product: string): CategoryId {
  const text = ` ${product} `;
  if (/perfume|fragancia|colonia|makeup|cosmetic|bensimon/i.test(text)) return 'perfume';
  if (/zapatilla|zapatos|remera|campera|jean|ropa|nike|adidas/i.test(text)) return 'moda';
  if (/motherboard|procesador|cpu|ryzen|gpu|rtx|rx\s*\d|notebook/i.test(text)) return 'pc';
  if (/bazar|vajilla|cacerola|cubiertos/i.test(text)) return 'bazar';
  if (/tv\b|televisor|heladera|lavarropas|smart tv/i.test(text)) return 'electro';
  return 'general';
}

/**
 * Procedural seeds:
 * 1) SERP hubs (discover unknown .com.ar)
 * 2) Bootstrap VTEX APIs for known AR .com (HTTP-fast, not a shop crawl list)
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

  const bootstrapApis = [...AR_COM_BOOTSTRAP].map(
    (host) => `https://www.${host}/api/catalog_system/pub/products/search?ft=${enc}&_from=0&_to=11`,
  );

  return [
    ...hubs,
    ...bootstrapApis,
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

/** @deprecated kept for tests — now equals hosts matching AR heuristic samples. */
export const ALLOWED_DOMAINS = [
  'mercadolibre.com.ar',
  ...AR_COM_BOOTSTRAP,
];
