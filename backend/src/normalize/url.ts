/**
 * URL normalization and domain helpers.
 */

const TRACKING_KEYS = new Set([
  'fbclid',
  'gclid',
  'twclid',
  'igshid',
  'ref',
  'srsltid',
  'icid',
  'spm',
  'scm',
  'sca_source',
  'ranMID',
  'ranEAID',
  'ranSiteID',
  'tag',
  'linkCode',
  'psc',
  // Venex (and similar) append listing search leftovers on PDP hrefs.
  'keywords',
]);

export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const key of TRACKING_KEYS) u.searchParams.delete(key);
  for (const key of [...u.searchParams.keys()]) {
    if (key.startsWith('utm_')) u.searchParams.delete(key);
  }
  if (u.search === '?') u.search = '';
  return u.toString();
}

export function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function isSameDomain(a: string, b: string): boolean {
  try {
    return bareHost(new URL(a).hostname) === bareHost(new URL(b).hostname);
  } catch {
    return false;
  }
}

export function absoluteUrl(base: string, href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.toString();
}