/**
 * Set-level adaptive relevance (§V31). Only demotes; never promotes past V29.
 * Strong set = core-phrase hits (not raw gate score), so FP score=1.0 don't pollute.
 */

import type { ProductResult } from '../../../shared/contract.ts';
import {
  normalizeText,
  queryInCorePhrase,
  queryTokens,
  titleRelevanceScore,
} from './relevance.ts';

export const MIN_STRONG_FOR_SET_SIGNALS = 8;
/** Prices below this fraction of the high-confidence median are demoted. */
export const OUTLIER_MEDIAN_FRACTION = 0.3;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Returns a demotion flag per result index: true → treat as weak relevance tier
 * even if title score was strong (price outlier vs core-phrase median).
 */
export function adaptivePriceOutlierDemotions(
  results: ProductResult[],
  product: string,
): boolean[] {
  const tokens = queryTokens(product);
  const demote = results.map(() => false);
  const coreIdx: number[] = [];
  for (let i = 0; i < results.length; i++) {
    const hay = normalizeText(results[i]!.name);
    if (queryInCorePhrase(hay, tokens) && titleRelevanceScore(results[i]!.name, product) > 0) {
      coreIdx.push(i);
    }
  }
  if (coreIdx.length < MIN_STRONG_FOR_SET_SIGNALS) return demote;

  const strongPrices = coreIdx.map((i) => results[i]!.price).filter((p) => p > 0);
  const ref = median(strongPrices);
  if (ref <= 0) return demote;

  const floor = ref * OUTLIER_MEDIAN_FRACTION;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (titleRelevanceScore(r.name, product) <= 0) continue;
    if (r.price > 0 && r.price < floor) demote[i] = true;
  }
  return demote;
}
