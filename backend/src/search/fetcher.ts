/**
 * Live fetcher: HTTP-first (fast path) → Playwright fallback.
 * Semaphore limits in-flight requests (asyncio-style). Per-host polite delay.
 * Challenge pages blacklist the host for the rest of the session (ML).
 */

import { RobotsFile } from 'crawlee';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { normalizeUrl } from '../normalize/url.ts';
import { logger } from '../utils/logger.ts';
import { hrefsFromHtml, httpGetText, looksLikeMlApi, looksLikeVtexApi, prefersHttpFirst, Semaphore } from './http-fetch.ts';
import { isChallengePage } from './parsers/vtex.ts';
import { extractDiscoveryLinks, isCrawlWorthy, isPublishableResult, isSerpHub } from './seeds.ts';
import type { FetchResult } from './types.ts';

export class BrowserUnavailableError extends Error {
  constructor() {
    super('Browser de Playwright no disponible');
    this.name = 'BrowserUnavailableError';
  }
}

export interface FetcherOptions {
  userAgent: string;
  stealth: boolean;
  maxConcurrency: number;
}

const NAV_TIMEOUT_MS = 18_000;

let probe: boolean | null = null;

export async function browserAvailable(): Promise<boolean> {
  if (probe !== null) return probe;
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    probe = true;
  } catch {
    probe = false;
  } finally {
    await browser?.close().catch(() => undefined);
  }
  logger.info(`browser available: ${probe}`);
  return probe;
}

export function clearBrowserProbe(): void {
  probe = null;
}

function sameDomainInteresting(url: string, candidate: string): boolean {
  if (!candidate.startsWith('http')) return false;
  if (!candidate.startsWith(url.split('/').slice(0, 3).join('/'))) return false;
  if (/\.(png|jpe?g|gif|webp|css|js|svg|woff2?|ttf|ico|pdf)(\?|$)/i.test(candidate)) return false;
  if (/\/(login|registration|privacidad|seguridad|ayuda|customer|gz\/account)/i.test(candidate)) return false;
  return (
    /\/listado\//i.test(candidate) ||
    /\/p\/[A-Z]{2,3}-/i.test(candidate) ||
    /\/[A-Z]{2,3}-\d{5,}/i.test(candidate) ||
    /_Desde_\d+/.test(candidate) ||
    /[?&](_q|q|s|palabra|ft)=/.test(candidate) ||
    /\/(s|search)\?/.test(candidate) ||
    /\/api\/catalog_system\//i.test(candidate) ||
    /\/pagina\//i.test(candidate) ||
    /\/[^/]+\/p\/?$/i.test(candidate)
  );
}

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Collapse ML subdomains into one blacklist key. */
function blockKey(url: string): string {
  const host = hostKey(url);
  if (/mercadolibre\.com\.ar$/i.test(host)) return 'mercadolibre.com.ar';
  if (/api\.mercadolibre\.com$/i.test(host)) return 'mercadolibre.com.ar';
  return host;
}

export class LiveFetcher {
  private readonly opts: FetcherOptions;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private robotsFiles = new Map<string, { isAllowed(url: string, userAgent?: string): boolean } | 'open'>();
  private lastHostAt = new Map<string, number>();
  private readonly blockedHosts = new Set<string>();
  private readonly sem: Semaphore;

  constructor(opts: FetcherOptions) {
    this.opts = opts;
    this.sem = new Semaphore(Math.max(1, opts.maxConcurrency));
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context !== null) return this.context;
    const settings = this.opts.stealth
      ? { headless: true, args: ['--disable-blink-features=AutomationControlled'] }
      : { headless: true };
    this.browser = await chromium.launch(settings);
    this.context = await this.browser.newContext({
      userAgent: this.opts.userAgent,
      viewport: { width: 1366, height: 768 },
      locale: 'es-AR',
    });
    if (this.opts.stealth) {
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
    }
    return this.context;
  }

  private async robotsAllow(url: string): Promise<boolean> {
    if (this.opts.stealth && (isSerpHub(url) || looksLikeMlApi(url))) return true;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    const cached = this.robotsFiles.get(host);
    if (cached === 'open') return true;
    if (cached !== undefined) return cached.isAllowed(url, this.opts.userAgent);
    try {
      const loader = (RobotsFile as unknown as {
        load: (url: string, proxyUrl?: string, options?: { useragent?: string }) => Promise<{ isAllowed(url: string, userAgent?: string): boolean }>;
      }).load;
      const robots = await loader(`https://${host}/robots.txt`, undefined, { useragent: this.opts.userAgent });
      this.robotsFiles.set(host, robots);
      return robots.isAllowed(url, this.opts.userAgent);
    } catch {
      this.robotsFiles.set(host, 'open');
      return true;
    }
  }

  private async hostDelay(url: string): Promise<void> {
    const key = hostKey(url) || 'unknown';
    const delay = Math.max(80, Math.round(400 / this.opts.maxConcurrency));
    const last = this.lastHostAt.get(key) ?? 0;
    const since = Date.now() - last;
    if (since < delay) await new Promise((r) => setTimeout(r, delay - since));
    this.lastHostAt.set(key, Date.now());
  }

  private finishFromHtml(url: string, html: string, links: string[]): FetchResult {
    if (isChallengePage(html)) {
      const key = blockKey(url);
      if (key !== '') {
        this.blockedHosts.add(key);
        logger.info(`challenge → blacklist host: ${key}`);
      }
      return { url, html, links: [], nextUrls: [] };
    }
    if (isSerpHub(url)) {
      const fromDom = links.filter((l) => isCrawlWorthy(l) && isPublishableResult(l));
      const fromHtml = extractDiscoveryLinks(url, html);
      const discovered = [...new Set([...fromDom, ...fromHtml])];
      return { url, html, links: discovered, nextUrls: discovered };
    }
    const nextUrls = links.filter((l) => sameDomainInteresting(url, l));
    return { url, html, links, nextUrls };
  }

  private async fetchHttp(url: string): Promise<FetchResult | null> {
    const got = await httpGetText(url, this.opts.userAgent);
    if (got === null) return null;
    const links = hrefsFromHtml(got.finalUrl, got.text)
      .map((h) => normalizeUrl(h))
      .filter((h): h is string => h !== null);
    return this.finishFromHtml(got.finalUrl || url, got.text, links);
  }

  private async fetchBrowser(url: string): Promise<FetchResult | null> {
    let context: BrowserContext;
    try {
      context = await this.ensureContext();
    } catch {
      return null;
    }
    let page: Page | null = null;
    try {
      page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const html = await page.content();
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.href),
      );
      const links = [...new Set(hrefs.map((h) => normalizeUrl(h)).filter((h): h is string => h !== null))];
      return this.finishFromHtml(url, html, links);
    } catch (err) {
      logger.warn(`fetch failed: ${url}`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  async fetch(url: string): Promise<FetchResult | null> {
    const blocked = blockKey(url);
    if (blocked !== '' && this.blockedHosts.has(blocked)) {
      logger.info(`skip blacklisted host: ${url}`);
      return null;
    }
    if (!(await this.robotsAllow(url))) {
      logger.info(`robots.txt disallow: ${url}`);
      return null;
    }

    await this.sem.acquire();
    try {
      await this.hostDelay(url);

      if (prefersHttpFirst(url)) {
        const fast = await this.fetchHttp(url);
        if (fast !== null) return fast;
        // JSON APIs: no Playwright fallback (browser won't help / wastes nodes).
        if (looksLikeVtexApi(url) || looksLikeMlApi(url)) return null;
      } else {
        const fast = await this.fetchHttp(url);
        if (fast !== null && (fast.html.length > 2_000 || /productName|"@type"\s*:\s*"Product"/i.test(fast.html))) {
          return fast;
        }
      }

      return await this.fetchBrowser(url);
    } finally {
      this.sem.release();
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
  }
}
