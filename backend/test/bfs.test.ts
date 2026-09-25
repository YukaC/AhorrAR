import { describe, expect, it } from 'vitest';
import type { SearchParams } from '../../shared/contract.ts';
import { bfsSearch } from '../src/search/bfs.ts';
import type { CrawlDeps } from '../src/search/types.ts';

const BASE = 'https://shop.test';

interface Node {
  links?: string[];
  price?: number;
  noShipping?: boolean;
}

const PARAMS: SearchParams = { product: 'test', country: 'AR', maxResults: 10, maxDepth: 2 };

function makeGraph(nodes: Record<string, Node>): { deps: CrawlDeps; fetchCalls: string[] } {
  const fetchCalls: string[] = [];
  const deps: CrawlDeps = {
    seedUrls: () => [`${BASE}/a`],
    fetch: async (url) => {
      fetchCalls.push(url);
      const name = url.replace(`${BASE}/`, '');
      const node = nodes[name];
      if (node === undefined) return null;
      return {
        url,
        html: `<html>${name}</html>`,
        links: (node.links ?? []).map((l) => `${BASE}/${l}`),
        nextUrls: [],
      };
    },
    extract: async ({ url }) => {
      const name = url.replace(`${BASE}/`, '');
      const node = nodes[name];
      if (node === undefined || node.price === undefined) return { results: [], links: [] };
      return {
        results: [
          {
            name: `Test ${name}`,
            priceRaw: String(node.price),
            shippingHint: node.noShipping === true ? 'Solo retiro en local' : 'Envío a todo el país',
            store: { name: `Tienda ${name}`, logo: null, local: true, siteUrl: BASE },
            url,
            image: null,
            depth: 0,
            sourceUrl: url,
          },
        ],
        links: [],
      };
    },
  };
  return { deps, fetchCalls };
}

describe('bfsSearch', () => {
  it('visits every node at most once (§V3)', async () => {
    const { deps, fetchCalls } = makeGraph({ a: { links: ['b', 'b', 'c'] }, b: { links: ['b'] }, c: {} });
    const out = await bfsSearch(PARAMS, deps, { maxDepth: 2, maxNodes: 10 });
    expect(fetchCalls).toEqual([`${BASE}/a`, `${BASE}/b`, `${BASE}/c`]);
    expect(out.stats.nodesVisited).toBe(3);
  });

  it('respects max_depth (§V5)', async () => {
    const { deps, fetchCalls } = makeGraph({ a: { links: ['b', 'c'] }, b: { links: ['d', 'e'] }, c: {} });
    const out = await bfsSearch(PARAMS, deps, { maxDepth: 1, maxNodes: 10 });
    expect(fetchCalls).toEqual([`${BASE}/a`, `${BASE}/b`, `${BASE}/c`]);
    expect(out.stats.maxDepthReached).toBe(1);
  });

  it('respects max_nodes (§V5)', async () => {
    const { deps, fetchCalls } = makeGraph({ a: { links: ['b', 'c', 'd'] } });
    const out = await bfsSearch(PARAMS, deps, { maxDepth: 2, maxNodes: 2 });
    expect(fetchCalls).toHaveLength(2);
    expect(out.stats.nodesVisited).toBe(2);
    expect(out.stats.linksQueued).toBe(4); // seed a + b,c,d
  });

  it('pops shallower nodes first, even when discovered later (priority by depth)', async () => {
    const { deps, fetchCalls } = makeGraph({
      a: { links: ['c', 'b'], price: 100 },
      c: { links: ['c2'], price: 200 },
      b: { price: 300 },
      c2: { links: ['c3'], price: 400 },
    });
    const out = await bfsSearch(PARAMS, deps, { maxDepth: 2, maxNodes: 10 });
    expect(fetchCalls).toEqual([`${BASE}/a`, `${BASE}/c`, `${BASE}/b`, `${BASE}/c2`]);
    expect(out.results).toHaveLength(4);
    expect(out.stats.maxDepthReached).toBe(2);
  });

  it('same depth: local-domain URLs pop before international ones (affinity cost, §C/§V4)', async () => {
    const LOCAL = 'https://www.mercadolibre.com.ar';
    const INTL = 'https://www.amazon.com';
    const fetchCalls: string[] = [];
    const deps: CrawlDeps = {
      seedUrls: () => [INTL, LOCAL], // intl enqueued first on purpose
      fetch: async (url) => {
        fetchCalls.push(url);
        return null;
      },
      extract: async ({ url }) => ({ results: [], links: [] }),
    };
    await bfsSearch(PARAMS, deps, { maxDepth: 1, maxNodes: 10 });
    // normalizeUrl appends the root trailing slash.
    expect(fetchCalls).toEqual([`${LOCAL}/`, `${INTL}/`]);
  });

  it('counts unconfirmed-shipping items and drops them (integration §V1)', async () => {
    const { deps } = makeGraph({ a: { links: ['b', 'c'], price: 100 }, b: { price: 200, noShipping: true }, c: { price: 300 } });
    const out = await bfsSearch(PARAMS, deps, { maxDepth: 1, maxNodes: 10 });
    expect(out.results).toHaveLength(2);
    expect(out.stats.skippedNoShipping).toBe(1);
    for (const r of out.results) expect(r.shipping.confirmed).toBe(true);
  });

  it('reports monotonic progress', async () => {
    const { deps } = makeGraph({ a: { links: ['b'], price: 100 }, b: { price: 200 } });
    const progress: Array<{ depth: number; nodesVisited: number; resultsFound: number }> = [];
    const out = await bfsSearch(PARAMS, deps, { maxDepth: 2, maxNodes: 10 }, (p) => progress.push(p));
    expect(progress.length).toBeGreaterThan(0);
    for (const p of progress) expect(p.nodesVisited).toBeGreaterThanOrEqual(1);
    expect(progress[progress.length - 1]).toEqual(out.progress);
    expect(out.progress.resultsFound).toBe(2);
  });
});