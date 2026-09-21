/**
 * Shared crawl types. Dependency-free so the BFS core and the live pipeline
 * both use the same, contract-shaped structures.
 */

import type { ProductResult, SearchParams } from '../../../shared/contract.ts';

export interface RawItem {
  name: string;
  priceRaw: string;
  shippingHint?: string;
  store: { name: string; logo?: string | null; local: boolean; siteUrl: string };
  url: string;
  image?: string | null;
  depth: number;
  sourceUrl: string;
}

export interface FetchResult {
  url: string;
  html: string;
  links: string[];
  nextUrls: string[];
}

export interface ExtractInput {
  url: string;
  html: string;
  params: SearchParams;
}

export interface ExtractResult {
  results: RawItem[];
  links: string[];
}

export interface CrawlDeps {
  seedUrls(params: SearchParams): string[];
  fetch(url: string, depth: number): Promise<FetchResult | null>;
  extract(input: ExtractInput): Promise<ExtractResult>;
}

export interface CrawlBatch {
  maxDepth: number;
  maxNodes: number;
  /** Parallel fetch width (aiohttp-style gather + semaphore upstream). */
  concurrency?: number;
}

export interface CrawlProgress {
  depth: number;
  nodesVisited: number;
  resultsFound: number;
  message?: string;
}

export interface CrawlStats {
  nodesVisited: number;
  linksQueued: number;
  pagesFetched: number;
  maxDepthReached: number;
  skippedNoShipping: number;
  skippedDedupe: number;
}

export interface CrawlOutcome {
  results: ProductResult[];
  progress: CrawlProgress;
  stats: CrawlStats;
}