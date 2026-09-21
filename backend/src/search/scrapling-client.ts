/**
 * Client for the Scrapling primary crawler (Python sidecar on :4100).
 * Falls back gracefully when the service is down — caller uses Node legacy.
 */

import type { ProductResult, SearchParams, SearchStats } from '../../../shared/contract.ts';
import { getCountry } from '../calendar/countries.ts';
import { buildEventInfo } from '../calendar/events.ts';
import { rankByPriority } from '../scoring/score.ts';
import type { AppConfig } from '../config.ts';
import { buildResponse, finalizeRawItem } from './pipeline.ts';
import type { RawItem } from './types.ts';
import type { SearchResponse } from '../../../shared/contract.ts';
import { logger } from '../utils/logger.ts';

export interface ScraplingOffer {
  name: string;
  price: number;
  currency?: string;
  url: string;
  image?: string | null;
  shippingHint?: string;
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
      depth: offer.depth ?? 0,
      sourceUrl: offer.sourceUrl ?? offer.url,
    };
    const done = finalizeRawItem(raw, params, country);
    if (done !== null) usable.push(done);
  }

  const ranked = rankByPriority(usable, country).slice(0, params.maxResults ?? cfg.maxResults);
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
