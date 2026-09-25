import type { ProductResult } from '../../../shared/contract';

export type SortMode = 'price-asc' | 'price-desc';

export interface Filters {
  /**
   * Kept for when free-shipping signal is real (VTEX logistics / HTML / ML).
   * UI button hidden until then — see ROADMAP "Envío gratis".
   */
  freeShipping: boolean;
  priceMin: number | null;
  priceMax: number | null;
}

export const EMPTY_FILTERS: Filters = { freeShipping: false, priceMin: null, priceMax: null };

export function sortResults(results: ProductResult[], sort: SortMode): ProductResult[] {
  return [...results].sort((a, b) => {
    const byPrice = sort === 'price-asc' ? a.price - b.price : b.price - a.price;
    return byPrice !== 0 ? byPrice : a.rank - b.rank;
  });
}

export function filterResults(results: ProductResult[], filters: Filters): ProductResult[] {
  return results.filter((r) => {
    if (filters.freeShipping && !r.shipping.free) return false;
    if (filters.priceMin !== null && r.price < filters.priceMin) return false;
    if (filters.priceMax !== null && r.price > filters.priceMax) return false;
    return true;
  });
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.freeShipping || filters.priceMin !== null || filters.priceMax !== null;
}

export function filterAndSort(results: ProductResult[], filters: Filters, sort: SortMode): ProductResult[] {
  return sortResults(filterResults(results, filters), sort).map((result, index) => ({
    ...result,
    rank: index + 1,
  }));
}
