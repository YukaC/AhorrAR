import { describe, expect, it } from 'vitest';
import { isProductResult, isSearchResponse, isShippingInfo } from '../../shared/contract.ts';

/* Hand-built sample that MUST pass the shared validator (§V8). */
const valid = {
  query: { product: 'iphone 16', country: 'AR', maxDepth: 2, maxResults: 10 },
  generatedAt: '2026-01-01T00:00:00.000Z',
  event: {
    activeToday: false,
    nextEvent: { name: 'Hot Sale AR', date: '2026-05-04', daysLeft: 123 },
  },
  results: [
    {
      rank: 1,
      name: 'iPhone 16 128GB',
      price: 249999,
      currency: 'ARS',
      store: { name: 'MercadoLibre', logo: null, local: true, siteUrl: 'https://www.mercadolibre.com.ar' },
      url: 'https://listado.mercadolibre.com.ar/iphone-16',
      image: null,
      shipping: { confirmed: true, country: 'AR', type: 'local', free: false },
      depth: 1,
      sourceUrl: 'https://listado.mercadolibre.com.ar/iphone-16',
    },
  ],
  stats: {
    source: 'live',
    nodesVisited: 22,
    linksQueued: 52,
    pagesFetched: 19,
    maxDepthReached: 2,
    skippedNoShipping: 0,
    skippedDedupe: 4,
    elapsedMs: 137,
  },
  message: 'OK',
};

describe('shared contract validator', () => {
  it('accepts a well-formed SearchResponse (§V8)', () => {
    expect(isSearchResponse(valid)).toBe(true);
  });

  it('rejects products with non-positive price (§V2)', () => {
    expect(isProductResult({ ...valid.results[0], price: 0 })).toBe(false);
    expect(isProductResult({ ...valid.results[0], price: -1 })).toBe(false);
  });

  it('rejects unconfirmed shipping (§V1)', () => {
    expect(isShippingInfo({ ...valid.results[0].shipping, confirmed: false })).toBe(false);
    expect(isProductResult({ ...valid.results[0], shipping: { ...valid.results[0].shipping, confirmed: false } })).toBe(false);
  });

  it('rejects invalid country codes and empty queries', () => {
    expect(isSearchResponse({ ...valid, query: { ...valid.query, country: 'BR' } })).toBe(false);
    expect(isSearchResponse({ ...valid, query: { ...valid.query, product: '' } })).toBe(false);
  });

  it('rejects missing event, missing stats, or bad source', () => {
    const { event: _event, ...noEvent } = valid;
    expect(isSearchResponse(noEvent)).toBe(false);
    const { stats: _stats, ...noStats } = valid;
    expect(isSearchResponse(noStats)).toBe(false);
    expect(isSearchResponse({ ...valid, stats: { ...valid.stats, source: 'live' } })).toBe(true);
    expect(isSearchResponse({ ...valid, stats: { ...valid.stats, source: 'scraped' } })).toBe(false);
  });
});