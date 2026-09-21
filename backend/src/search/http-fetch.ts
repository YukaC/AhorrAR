/**
 * HTTP fast path (aiohttp-style): undici fetch without Playwright.
 * Used for SERP HTML, VTEX JSON APIs, ML JSON API (when not 403).
 * Returns null when the response is useless → caller falls back to browser.
 */

import { isChallengePage } from './parsers/vtex.ts';

const HTTP_TIMEOUT_MS = 12_000;

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export function looksLikeVtexApi(url: string): boolean {
  return /\/api\/catalog_system\/pub\/products\/search/i.test(url);
}

export function looksLikeMlApi(url: string): boolean {
  try {
    return /api\.mercadolibre\.com/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Prefer HTTP when browser is overkill (SERP static / JSON APIs). */
export function prefersHttpFirst(url: string): boolean {
  if (looksLikeVtexApi(url) || looksLikeMlApi(url)) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/duckduckgo\.com$/i.test(host)) return true;
    if (/bing\.com$/i.test(host)) return true;
  } catch {
    return false;
  }
  return false;
}

/** Alias used by tests / call sites. */
export const prefersHttp = prefersHttpFirst;

export function httpBodyLooksUseful(body: string, contentType: string): boolean {
  if (isChallengePage(body)) return false;
  if (/application\/json/i.test(contentType) && /^\s*[\[{]/.test(body) && body.length >= 2) return true;
  if (body.length < 80) return false;
  if (/productName|"@type"\s*:\s*"Product"|ui-search|BestPrice|og:title/i.test(body)) return true;
  return body.length > 2_000;
}

export async function httpGetText(
  url: string,
  userAgent: string,
): Promise<{ text: string; finalUrl: string; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    if (!httpBodyLooksUseful(text, contentType)) return null;
    return { text, finalUrl: res.url || url, contentType };
  } catch {
    return null;
  }
}

/** Href harvest from raw HTML (no DOM). */
export function hrefsFromHtml(pageUrl: string, html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      out.push(new URL(m[1]!, pageUrl).toString().split('#')[0]!);
    } catch {
      /* ignore */
    }
  }
  return [...new Set(out)];
}
