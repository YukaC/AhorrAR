/**
 * THE algorithm: explicit BFS with a min-heap priority queue (by depth) and a
 * visited set (O(1)) so each URL is processed at most once (§V3), bounded by
 * max_depth + max_nodes guards (§V5). No pure recursion.
 *
 * Parallel wave: pop up to `concurrency` items, fetch with Promise.all
 * (aiohttp gather + semaphore lives in LiveFetcher), then process serially
 * so enqueue/visited stay race-free.
 */

import type { ProductResult, SearchParams } from '../../../shared/contract.ts';
import { getCountry } from '../calendar/countries.ts';
import { domainAffinity } from '../scoring/score.ts';
import { normalizeUrl } from '../normalize/url.ts';
import { finalizeRawItem } from './pipeline.ts';
import { PriorityQueue } from './priorityQueue.ts';
import { isSerpHub } from './seeds.ts';
import type { CrawlBatch, CrawlDeps, CrawlOutcome, CrawlProgress, FetchResult } from './types.ts';

interface QueueItem {
  url: string;
  depth: number;
  cost: number;
}

function queueCost(depth: number, isLocalDomain: boolean, url: string): number {
  if (isSerpHub(url)) return depth * 10;
  // Prefer VTEX JSON APIs (cheap + dense offers).
  if (/\/api\/catalog_system\//i.test(url)) return depth * 10 + 0.5;
  const mlPenalty = /mercadolibre\.com\.ar/i.test(url) ? 3 : 0;
  return depth * 10 + (isLocalDomain ? 1 : 5) + mlPenalty;
}

function acceptResult(
  done: ProductResult,
  results: ProductResult[],
  seenResultUrls: Set<string>,
): 'added' | 'dedupe' | 'skip' {
  if (/^producto$/i.test(done.name) || done.name.trim().length < 4) return 'skip';
  try {
    const path = new URL(done.url).pathname;
    if (path === '/' || path === '') return 'skip';
  } catch {
    return 'skip';
  }
  if (seenResultUrls.has(done.url)) {
    const idx = results.findIndex((r) => r.url === done.url);
    if (idx >= 0) {
      const prev = results[idx]!;
      const richer =
        (Boolean(done.image) && !prev.image) ||
        done.name.length > prev.name.length + 5 ||
        (done.depth > prev.depth && Boolean(done.image));
      if (richer) results[idx] = done;
    }
    return 'dedupe';
  }
  seenResultUrls.add(done.url);
  results.push(done);
  return 'added';
}

export async function bfsSearch(
  params: SearchParams,
  deps: CrawlDeps,
  batch: CrawlBatch,
  onProgress?: (progress: CrawlProgress) => void,
): Promise<CrawlOutcome> {
  const country = getCountry(params.country);
  const queue = new PriorityQueue<QueueItem>((it) => it.cost);
  const visited = new Set<string>();
  const queued = new Set<string>();
  const results: ProductResult[] = [];
  const seenResultUrls = new Set<string>();
  const resultCap = params.maxResults ?? Number.POSITIVE_INFINITY;
  const width = Math.max(1, batch.concurrency ?? 1);

  let linksQueued = 0;
  let pagesFetched = 0;
  let maxDepthReached = 0;
  let skippedNoShipping = 0;
  let skippedDedupe = 0;

  const enqueue = (rawUrl: string, depth: number): void => {
    const url = normalizeUrl(rawUrl);
    if (url === null) return;
    if (visited.has(url) || queued.has(url)) return;
    if (depth > batch.maxDepth) return;
    queued.add(url);
    queue.push({ url, depth, cost: queueCost(depth, domainAffinity(url, country), url) });
    linksQueued++;
  };

  const report = (depth: number, message?: string): void => {
    onProgress?.({
      depth,
      nodesVisited: visited.size,
      resultsFound: results.length,
      message,
    });
  };

  const processFetched = async (item: QueueItem, fetched: FetchResult | null): Promise<void> => {
    if (fetched === null) {
      report(item.depth);
      return;
    }
    pagesFetched++;
    for (const link of [...fetched.nextUrls, ...fetched.links]) {
      enqueue(link, item.depth + 1);
    }
    const extracted = await deps.extract({ url: fetched.url, html: fetched.html, params });
    for (const raw of extracted.results) {
      const done = finalizeRawItem({ ...raw, depth: item.depth }, params, country);
      if (done === null) {
        skippedNoShipping++;
        continue;
      }
      const verdict = acceptResult(done, results, seenResultUrls);
      if (verdict === 'dedupe' || verdict === 'skip') skippedDedupe++;
      if (results.length >= resultCap) break;
    }
    for (const link of extracted.links) enqueue(link, item.depth + 1);
    report(item.depth);
  };

  for (const seed of deps.seedUrls(params)) enqueue(seed, 0);

  while (queue.size > 0) {
    if (visited.size >= batch.maxNodes) break;
    if (results.length >= resultCap) break;

    const wave: QueueItem[] = [];
    while (wave.length < width && queue.size > 0 && visited.size + wave.length < batch.maxNodes) {
      const item = queue.pop()!;
      if (visited.has(item.url)) {
        skippedDedupe++;
        continue;
      }
      visited.add(item.url);
      if (item.depth > maxDepthReached) maxDepthReached = item.depth;
      wave.push(item);
    }
    if (wave.length === 0) break;

    for (const item of wave) report(item.depth, `Visitando ${item.url}`);

    const fetchedList = await Promise.all(wave.map((item) => deps.fetch(item.url, item.depth)));
    for (let i = 0; i < wave.length; i++) {
      if (results.length >= resultCap) break;
      await processFetched(wave[i]!, fetchedList[i]!);
    }
  }

  return {
    results,
    progress: {
      depth: maxDepthReached,
      nodesVisited: visited.size,
      resultsFound: results.length,
    },
    stats: {
      nodesVisited: visited.size,
      linksQueued,
      pagesFetched,
      maxDepthReached,
      skippedNoShipping,
      skippedDedupe,
    },
  };
}
