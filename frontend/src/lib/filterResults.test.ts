import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterAndSort, filterResults, hasActiveFilters, sortResults } from './filterResults';
import type { ProductResult } from '../../../shared/contract';

function item(id: number, price: number, opts: Partial<ProductResult> = {}): ProductResult {
  return {
    rank: id,
    name: `Producto ${id}`,
    price,
    currency: 'ARS',
    store: { name: `Store ${id}`, logo: null, local: true, siteUrl: `https://store${id}.com.ar` },
    url: `https://store${id}.com.ar/p/${id}`,
    image: null,
    shipping: { confirmed: true, country: 'AR', type: 'local', free: false, note: '' },
    depth: 1,
    sourceUrl: 'https://listado.mercadolibre.com.ar/',
    ...opts,
  };
}

const base = [item(1, 1000, { shipping: { confirmed: true, country: 'AR', type: 'local', free: true, note: '' } }), item(2, 2000), item(3, 3000, { store: { name: 'Global', logo: null, local: false, siteUrl: 'https://global.com' } })];

describe('sortResults (V12)', () => {
  it('price-asc then stable by price, fallback rank', () => {
    expect(sortResults([item(1, 300), item(2, 100), item(3, 200)], 'price-asc').map((r) => r.price)).toEqual([100, 200, 300]);
  });
  it('price-desc', () => {
    expect(sortResults([item(1, 300), item(2, 100)], 'price-desc').map((r) => r.price)).toEqual([300, 100]);
  });
  it('does not mutate the input array', () => {
    const input = [item(1, 300), item(2, 100)];
    sortResults(input, 'price-asc');
    expect(input.map((r) => r.price)).toEqual([300, 100]);
  });
});

describe('filterResults (V12)', () => {
  it('price min/max keep only the in-range offers', () => {
    const out = filterResults(base, { ...EMPTY_FILTERS, priceMin: 1500, priceMax: 2500 });
    expect(out.map((r) => r.price)).toEqual([2000]);
  });
  it('free shipping only', () => {
    const out = filterResults(base, { ...EMPTY_FILTERS, freeShipping: true });
    expect(out.map((r) => r.rank)).toEqual([1]);
  });
  it('solo local excludes international stores', () => {
    const out = filterResults(base, { ...EMPTY_FILTERS, soloLocal: true });
    expect(out.map((r) => r.rank)).toEqual([1, 2]);
  });
  it('combines filters', () => {
    const out = filterResults(base, { soloLocal: true, freeShipping: true, priceMin: null, priceMax: null });
    expect(out.map((r) => r.rank)).toEqual([1]);
  });
});

describe('filterAndSort + hasActiveFilters (V12)', () => {
  it('applies filters then sorts', () => {
    const out = filterAndSort(base, { ...EMPTY_FILTERS, priceMin: 1500 }, 'price-desc');
    expect(out.map((r) => r.price)).toEqual([3000, 2000]);
  });
  it('detects active filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, priceMax: 900 })).toBe(true);
  });
});