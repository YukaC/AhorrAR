import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResponse } from '../../shared/contract.ts';
import { jobStore, runLiveJob, searchCache } from '../src/jobs.ts';
import { normalizeQueryKey, cacheKeyFor, SearchCache } from '../src/cache/search-cache.ts';
import { LISTING_URL, TEST_CFG, fetchFixture } from './fixtures/live.ts';

/** Fixture mínimo válido (§V8) para seed del caché. */
const RESPONSE: SearchResponse = {
  query: { product: 'perfume', country: 'AR', maxResults: 5 },
  generatedAt: new Date().toISOString(),
  event: {
    activeToday: false,
    nextEvent: { name: 'x', date: '2026-01-01', daysLeft: 1 },
  },
  results: [],
  stats: { source: 'live', nodesVisited: 0, linksQueued: 0, pagesFetched: 0, maxDepthReached: 0, skippedNoShipping: 0, skippedDedupe: 0, elapsedMs: 1 },
};

describe('normalizeQueryKey (§V21)', () => {
  it('minúsculas, sin tildes, sin puntuación', () => {
    expect(normalizeQueryKey('SAMSUNG GALÁX: ¡s24!')).toBe('galax s24 samsung');
  });

  it('orden de palabras indiferente', () => {
    expect(normalizeQueryKey('samsung galaxy s24')).toBe(normalizeQueryKey('s24 galaxy samsung'));
  });

  it('colapsa espacios y vacío', () => {
    expect(normalizeQueryKey('  iphone   16 pro  ')).toBe('16 iphone pro');
    expect(normalizeQueryKey('   ')).toBe('');
    expect(normalizeQueryKey('')).toBe('');
  });
});

describe('cacheKeyFor (§V17/V21)', () => {
  it('incluye el cap de resultados para no reusar hits más chicos', () => {
    expect(cacheKeyFor('perfume', 25)).toBe('perfume:n25');
    expect(cacheKeyFor('perfume', 25)).not.toBe(cacheKeyFor('perfume', 50));
    expect(cacheKeyFor('SAMSUNG s24', 100)).toBe('s24 samsung:n100');
  });
});

describe('SearchCache', () => {
  it('set/get roundtrip y size', () => {
    const c = new SearchCache(1000);
    expect(c.get('k')).toBeUndefined();
    c.set('k', RESPONSE);
    expect(c.get('k')?.data).toBe(RESPONSE);
    expect(c.size).toBe(1);
  });

  it('isFresh respeta TTL y get mantiene stale (SWR)', () => {
    const c = new SearchCache(1000);
    c.set('k', RESPONSE);
    const entry = c.get('k')!;
    expect(c.isFresh(entry)).toBe(true);
    expect(c.isFresh(entry, entry.ts + 1001)).toBe(false);
    expect(c.get('k')).toBeDefined(); // stale sigue disponible
  });

  it('delete/clear', () => {
    const c = new SearchCache(1000);
    c.set('a', RESPONSE);
    c.set('b', RESPONSE);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    c.clear();
    expect(c.size).toBe(0);
  });

  it('setTtl modifica la política', () => {
    const c = new SearchCache(10_000);
    c.set('k', RESPONSE);
    expect(c.isFresh(c.get('k')!)).toBe(true);
    c.setTtl(1);
    expect(c.isFresh(c.get('k')!, c.get('k')!.ts + 2)).toBe(false); // con TTL 1ms, +2ms ya es stale
  });

  it('evicts oldest when maxEntries exceeded', () => {
    const c = new SearchCache(60_000, 2);
    c.set('a', RESPONSE);
    c.set('b', RESPONSE);
    expect(c.size).toBe(2);
    c.set('c', RESPONSE);
    expect(c.size).toBe(2);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeDefined();
    expect(c.get('c')).toBeDefined();
  });
});

describe('Integración caché en runLiveJob (§V21)', () => {
  beforeEach(() => {
    searchCache.clear();
  });

  afterEach(() => {
    searchCache.setTtl(TEST_CFG.cacheTtlMs);
  });

  it('miss → crawlea y puebla la caché', async () => {
    const job = jobStore.create({ product: 'perfume', country: 'AR', maxResults: 5 });
    const deps = { seedUrls: () => [LISTING_URL], fetch: fetchFixture };
    await runLiveJob(job.searchId, TEST_CFG, deps);
    const done = jobStore.get(job.searchId)!;
    expect(done.status).toBe('done');
    expect(searchCache.get(cacheKeyFor('perfume', 5))).toBeDefined();
  });

  it('hit fresco → no crawlea y devuelve la respuesta cacheada', async () => {
    const job = jobStore.create({ product: 'perfume', country: 'AR', maxResults: 5 });
    searchCache.set(cacheKeyFor('perfume', 5), RESPONSE);
    const fetchSpy = vi.fn(fetchFixture);
    const deps = { seedUrls: () => [LISTING_URL], fetch: fetchSpy };
    await runLiveJob(job.searchId, TEST_CFG, deps);
    expect(jobStore.get(job.searchId)!.result).toBe(RESPONSE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hit stale → sirve stale al instante y refresca en background (SWR)', async () => {
    const job = jobStore.create({ product: 'perfume', country: 'AR', maxResults: 5 });
    searchCache.set(cacheKeyFor('perfume', 5), RESPONSE);
    // Envejecer la entrada de verdad: el correr del tiempo es el único mecanismo
    // real de SWR (el TTL de la caché no se toca, lo re-setea runLiveJob con cfg).
    const entryBefore = searchCache.get(cacheKeyFor('perfume', 5))!;
    entryBefore.ts -= TEST_CFG.cacheTtlMs + 1;
    expect(searchCache.isFresh(entryBefore)).toBe(false);

    const deps = { seedUrls: () => [LISTING_URL], fetch: fetchFixture };
    await runLiveJob(job.searchId, TEST_CFG, deps);
    expect(jobStore.get(job.searchId)!.result).toBe(RESPONSE); // stale servido sin crawlear

    await vi.waitFor(() => {
      const entryAfter = searchCache.get(cacheKeyFor('perfume', 5))!;
      expect(entryAfter.ts).toBeGreaterThan(entryBefore.ts); // el refresh repobló con ts nuevo
    }, { timeout: 2000 });
  });
});