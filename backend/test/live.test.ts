import { describe, expect, it } from 'vitest';
import { isSearchResponse } from '../../shared/contract.ts';
import { runLiveSearch } from '../src/search/service.ts';
import { isAllowed } from '../src/search/seeds.ts';
import { LISTING_URL, PRODUCT_URL, TEST_CFG, fetchFixture } from './fixtures/live.ts';

const deps = {
  seedUrls: () => [LISTING_URL],
  fetch: fetchFixture,
};

describe('live search hermético (T10, ⊥ red en tests)', () => {
  it('BFS + extractor + pipeline produce una SearchResponse válida (§V8)', async () => {
    const resp = await runLiveSearch({ product: 'perfume', country: 'AR', maxResults: 5 }, TEST_CFG, undefined, deps);
    expect(isSearchResponse(resp)).toBe(true);
    expect(resp.stats.source).toBe('live');
    expect(resp.results.length).toBeGreaterThanOrEqual(2);
  });

  it('rank normalizado 1..n y envío confirmado (§V4, §V1)', async () => {
    const resp = await runLiveSearch({ product: 'perfume', country: 'AR', maxResults: 5 }, TEST_CFG, undefined, deps);
    expect(resp.results.map((r) => r.rank)).toEqual(resp.results.map((_, i) => i + 1));
    expect(resp.results.every((r) => r.shipping.confirmed)).toBe(true);
  });

  it('imágenes reales extraídas por parser (V11)', async () => {
    const resp = await runLiveSearch({ product: 'perfume', country: 'AR', maxResults: 5 }, TEST_CFG, undefined, deps);
    for (const r of resp.results) {
      expect(r.image).toBeTruthy();
      expect(r.image).not.toBeNull();
    }
  });
});

describe('reputación AR + prune externos (V13)', () => {
  it('nunca fetch-ea hosts no-AR; sí recursa dentro de .ar', async () => {
    const fetched: string[] = [];
    const spy = {
      seedUrls: deps.seedUrls,
      fetch: (url: string, depth: number) => {
        fetched.push(url);
        expect(isAllowed(url)).toBe(true);
        return fetchFixture(url, depth);
      },
    };
    const resp = await runLiveSearch({ product: 'perfume', country: 'AR', maxResults: 5 }, TEST_CFG, undefined, spy);
    expect(fetched.includes('https://www.amazon.com.mx/dp/B00')).toBe(false);
    expect(fetched.some((u) => u.startsWith(LISTING_URL))).toBe(true);
    expect(fetched.includes(PRODUCT_URL)).toBe(true);
    expect(resp.results.length).toBeGreaterThan(0);
  });
});
