/**
 * Live search orchestration.
 * PRIMARY: Scrapling Python sidecar (TLS impersonation + VTEX/SERP).
 * SECONDARY: Node BFS legacy (Playwright/HTTP) when CRAWLER=legacy|auto fallback.
 */

import type { SearchParams, SearchResponse, SearchStats } from '../../../shared/contract.ts';
import { buildEventInfo } from '../calendar/events.ts';
import { getCountry } from '../calendar/countries.ts';
import { rankByPriority } from '../scoring/score.ts';
import type { AppConfig } from '../config.ts';
import { bfsSearch } from './bfs.ts';
import { extractPage } from './extractor.ts';
import { LiveFetcher } from './fetcher.ts';
import { buildResponse } from './pipeline.ts';
import { crawlViaScrapling, scraplingAvailable } from './scrapling-client.ts';
import {
  buildSeedUrls,
  extractDiscoveryLinks,
  guessSearchUrls,
  isCrawlWorthy,
  isMarketplaceSeedHost,
  isPublishableResult,
  isSerpHub,
} from './seeds.ts';
import type { CrawlDeps, CrawlProgress, FetchResult } from './types.ts';
import { logger } from '../utils/logger.ts';

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function expandNewOrigins(urls: string[], product: string, knownOrigins: Set<string>): string[] {
  const extra: string[] = [];
  for (const url of urls) {
    if (!isPublishableResult(url)) continue;
    if (isMarketplaceSeedHost(url)) continue;
    const origin = originOf(url);
    if (origin === null || knownOrigins.has(origin)) continue;
    knownOrigins.add(origin);
    extra.push(...guessSearchUrls(origin, product));
  }
  return extra.filter((u) => isCrawlWorthy(u));
}

/** Node legacy BFS (secondary path). */
export function runLegacySearch(
  params: SearchParams,
  cfg: AppConfig,
  onProgress?: (progress: CrawlProgress) => void,
  deps?: Partial<CrawlDeps>,
): Promise<SearchResponse> {
  const country = getCountry(params.country);
  const ownFetcher = deps?.fetch === undefined ? new LiveFetcher({ userAgent: cfg.userAgent, stealth: cfg.stealth, maxConcurrency: cfg.concurrency }) : undefined;
  const knownOrigins = new Set<string>();

  const crawlDeps: CrawlDeps = {
    seedUrls: deps?.seedUrls ?? ((): string[] => buildSeedUrls(params)),
    fetch:
      deps?.fetch ??
      (async (url: string): Promise<FetchResult | null> => {
        const out = await ownFetcher!.fetch(url);
        if (out === null) return null;
        const links = out.links.filter((l) => isCrawlWorthy(l));
        const nextUrls = out.nextUrls.filter((l) => isCrawlWorthy(l));
        return { ...out, links, nextUrls };
      }),
    extract:
      deps?.extract ??
      (async (input: { url: string; html: string; params: SearchParams }) => {
        const out = await extractPage(input.url, input.html, input.params);
        let links = out.links.filter((l) => isCrawlWorthy(l));
        if (isSerpHub(input.url)) {
          links = [...new Set([...links, ...extractDiscoveryLinks(input.url, input.html)])];
        }
        const expanded = expandNewOrigins([...links, input.url], input.params.product, knownOrigins);
        return { ...out, results: out.results.filter((r) => isPublishableResult(r.url)), links: [...links, ...expanded] };
      }),
  };

  return (async () => {
    try {
      const startedAt = Date.now();
      const outcome = await bfsSearch(
        params,
        crawlDeps,
        {
          maxDepth: params.maxDepth ?? cfg.maxDepth,
          maxNodes: Math.min(cfg.maxNodes, Math.max(24, (params.maxResults ?? cfg.maxResults) * 5 + 16)),
          concurrency: cfg.concurrency,
        },
        onProgress,
      );
      const usable = outcome.results.filter((r) => isPublishableResult(r.url));
      const ranked = rankByPriority(usable, country).slice(0, params.maxResults ?? cfg.maxResults);
      const event = buildEventInfo(new Date(), params.country);
      const stats: SearchStats = {
        source: 'live',
        ...outcome.stats,
        elapsedMs: Date.now() - startedAt,
      };
      return buildResponse({ params, results: ranked, event, stats });
    } finally {
      await ownFetcher?.close().catch(() => undefined);
    }
  })();
}

export async function runLiveSearch(
  params: SearchParams,
  cfg: AppConfig,
  onProgress?: (progress: CrawlProgress) => void,
  deps?: Partial<CrawlDeps>,
): Promise<SearchResponse> {
  // Hermetic tests inject deps → always legacy path (no Scrapling network).
  if (deps !== undefined) {
    return runLegacySearch(params, cfg, onProgress, deps);
  }

  if (cfg.crawler === 'legacy') {
    return runLegacySearch(params, cfg, onProgress);
  }

  if (cfg.crawler === 'scrapling' || cfg.crawler === 'auto') {
    onProgress?.({ depth: 0, nodesVisited: 0, resultsFound: 0, message: 'Scrapling primary…' });
    const up = await scraplingAvailable(cfg.scraplingUrl);
    if (up) {
      const via = await crawlViaScrapling(params, cfg);
      if (via !== null && via.results.length > 0) {
        logger.info(`scrapling ok: ${via.results.length} results in ${via.stats.elapsedMs}ms`);
        return via;
      }
      if (via !== null && via.results.length === 0 && cfg.crawler === 'scrapling') {
        return via;
      }
      logger.info('scrapling empty/fail → legacy fallback');
    } else if (cfg.crawler === 'scrapling') {
      throw new Error(`Scrapling no disponible en ${cfg.scraplingUrl}. Arrancá: cd scraper && uv run ahorrar-scraper`);
    } else {
      logger.info('scrapling down → legacy fallback');
    }
  }

  return runLegacySearch(params, cfg, onProgress);
}
