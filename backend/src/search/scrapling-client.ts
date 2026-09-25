/**
 * Client for the Scrapling primary crawler (Python sidecar on :4100).
 * Falls back gracefully when the service is down — caller uses Node legacy.
 */

import type { ProductResult, SearchParams, SearchStats, InstallmentsInfo } from '../../../shared/contract.ts';
import { getCountry } from '../calendar/countries.ts';
import { buildEventInfo } from '../calendar/events.ts';
import { rankByPriority } from '../scoring/score.ts';
import type { AppConfig } from '../config.ts';
import { buildResponse, finalizeRawItem } from './pipeline.ts';
import type { RawItem, CrawlProgress } from './types.ts';
import { hostOf, isMarketplaceSeedHost, isSerpHub, registerDiscoveredShop } from './seeds.ts';
import type { SearchResponse } from '../../../shared/contract.ts';
import { logger } from '../utils/logger.ts';

export interface ScraplingOffer {
  name: string;
  price: number;
  currency?: string;
  url: string;
  image?: string | null;
  shippingHint?: string;
  installments?: InstallmentsInfo | null;
  store: { name: string; logo?: string | null; local: boolean; siteUrl: string };
  depth?: number;
  sourceUrl?: string;
}

export interface ScraplingCrawlResponse {
  product: string;
  country: string;
  results: ScraplingOffer[];
  stats: {
    source: string;
    nodesVisited: number;
    linksQueued: number;
    pagesFetched: number;
    maxDepthReached: number;
    skippedNoShipping: number;
    skippedDedupe: number;
    elapsedMs: number;
  };
  mlBlocked?: boolean;
}

export async function scraplingAvailable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; engine?: string };
    return body.ok === true && body.engine === 'scrapling';
  } catch {
    return false;
  }
}

export async function crawlViaScrapling(
  params: SearchParams,
  cfg: AppConfig,
): Promise<SearchResponse | null> {
  const base = cfg.scraplingUrl.replace(/\/$/, '');
  const started = Date.now();
  let payload: ScraplingCrawlResponse;
  try {
    const res = await fetch(`${base}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        product: params.product,
        maxResults: params.maxResults ?? cfg.maxResults,
        maxNodes: cfg.maxNodes,
        maxDepth: params.maxDepth ?? cfg.maxDepth,
        includeMl: cfg.includeMl,
      }),
    });
    if (!res.ok) {
      logger.warn(`scrapling crawl HTTP ${res.status}`);
      return null;
    }
    payload = (await res.json()) as ScraplingCrawlResponse;
  } catch (err) {
    logger.warn('scrapling crawl failed', err instanceof Error ? err.message : err);
    return null;
  }

  const country = getCountry(params.country);
  const usable: ProductResult[] = [];
  for (const offer of payload.results) {
    const raw: RawItem = {
      name: offer.name,
      priceRaw: String(offer.price),
      shippingHint: offer.shippingHint,
      store: offer.store,
      url: offer.url,
      image: offer.image ?? null,
      installments: offer.installments ?? null,
      depth: offer.depth ?? 0,
      sourceUrl: offer.sourceUrl ?? offer.url,
    };
    const done = finalizeRawItem(raw, params, country);
    if (done !== null) usable.push(done);
  }

  const ranked = rankByPriority(usable, country, params.maxResults ?? cfg.maxResults);
  const stats: SearchStats = {
    source: 'live',
    nodesVisited: payload.stats.nodesVisited,
    linksQueued: payload.stats.linksQueued,
    pagesFetched: payload.stats.pagesFetched,
    maxDepthReached: payload.stats.maxDepthReached,
    skippedNoShipping: payload.stats.skippedNoShipping,
    skippedDedupe: payload.stats.skippedDedupe,
    elapsedMs: Date.now() - started,
  };

  return buildResponse({
    params,
    results: ranked,
    event: buildEventInfo(new Date(), params.country),
    stats,
    message: payload.mlBlocked ? 'MercadoLibre bloqueado esta sesión; resultados de otras tiendas AR.' : undefined,
  });
}

/**
 * Streaming crawl (ndjson → SSE). Feeds partial offers to `onPartials` as the
 * scraper finds them, so the frontend can render live cards (§V16).
 * Returns the final full response (ranked) when the stream closes with `done`.
 */

/** Pure ndjson line → event dict (ignores garbage lines, §V16). */
export function parseScraplingLine(line: string): Record<string, unknown> | null {
  if (line.trim() === '') return null;
  try {
    const evt = JSON.parse(line) as Record<string, unknown>;
    return evt && typeof evt === 'object' ? evt : null;
  } catch {
    return null;
  }
}

export async function crawlViaScraplingStream(
  params: SearchParams,
  cfg: AppConfig,
  onPartials: (partial: ProductResult[]) => void,
  onProgress?: (p: CrawlProgress) => void,
): Promise<SearchResponse | null> {
  const base = cfg.scraplingUrl.replace(/\/$/, '');
  const started = Date.now();
  const country = getCountry(params.country);
  const usable: ProductResult[] = [];
  let statsIn: ScraplingCrawlResponse['stats'] | null = null;
  let mlBlocked = false;

  const onOffer = (offer: ScraplingOffer): void => {
    const raw: RawItem = {
      name: offer.name,
      priceRaw: String(offer.price),
      shippingHint: offer.shippingHint,
      store: offer.store,
      url: offer.url,
      image: offer.image ?? null,
      installments: offer.installments ?? null,
      depth: offer.depth ?? 0,
      sourceUrl: offer.sourceUrl ?? offer.url,
    };
    const done = finalizeRawItem(raw, params, country);
    if (done !== null) {
      usable.push(done);
      // Auto-expansión índice: tiendas nuevas con results se persisten (§V19).
      const host = hostOf(offer.url);
      if (host !== '' && !isMarketplaceSeedHost(offer.url) && !isSerpHub(offer.url)) {
        registerDiscoveredShop(host);
      }
    }
    // Re-rank on every offer so SSE parciales llegan ordenados (§V16/§V18).
    const cap = params.maxResults ?? cfg.maxResults;
    onPartials(rankByPriority([...usable], country, cap));
  };

  try {
    const res = await fetch(`${base}/crawl/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        product: params.product,
        maxResults: params.maxResults ?? cfg.maxResults,
        maxNodes: cfg.maxNodes,
        maxDepth: params.maxDepth ?? cfg.maxDepth,
        includeMl: cfg.includeMl,
      }),
    });
    if (!res.ok) {
      logger.warn(`scrapling crawl/stream HTTP ${res.status}`);
      return null;
    }
    if (!res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const evt = parseScraplingLine(line);
        if (evt === null) continue;
        if (evt.type === 'offer' && evt.offer) {
          onOffer(evt.offer as ScraplingOffer);
        } else if (evt.type === 'progress') {
          onProgress?.({
            depth: typeof evt.depth === 'number' ? evt.depth : 0,
            nodesVisited: typeof evt.nodes_visited === 'number' ? evt.nodes_visited : 0,
            resultsFound: usable.length,
            message: typeof evt.message === 'string' ? evt.message : undefined,
          });
        } else if (evt.type === 'done' && evt.summary) {
          const summary = evt.summary as Record<string, unknown>;
          statsIn = summary.stats as ScraplingCrawlResponse['stats'];
          mlBlocked = Boolean((summary as { mlBlocked?: boolean }).mlBlocked);
        } else if (evt.type === 'error') {
          logger.warn('scrapling crawl/stream error', typeof evt.message === 'string' ? evt.message : '');
          return null;
        }
      }
    }
  } catch (err) {
    logger.warn('scrapling crawl/stream failed', err instanceof Error ? err.message : err);
    return null;
  }

  const ranked = rankByPriority(usable, country, params.maxResults ?? cfg.maxResults);
  const stats: SearchStats = {
    source: 'live',
    nodesVisited: statsIn?.nodesVisited ?? usable.length,
    linksQueued: statsIn?.linksQueued ?? 0,
    pagesFetched: statsIn?.pagesFetched ?? 0,
    maxDepthReached: statsIn?.maxDepthReached ?? 0,
    skippedNoShipping: statsIn?.skippedNoShipping ?? 0,
    skippedDedupe: statsIn?.skippedDedupe ?? 0,
    elapsedMs: Date.now() - started,
  };

  return buildResponse({
    params,
    results: ranked,
    event: buildEventInfo(new Date(), params.country),
    stats,
    message: mlBlocked ? 'MercadoLibre bloqueado esta sesión; resultados de otras tiendas AR.' : undefined,
  });
}
