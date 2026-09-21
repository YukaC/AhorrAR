/**
 * Result ranking.
 *
 * Priority, in order:
 *   1. Domain affinity — local (ccTLD país + marketplaces oficiales) antes
 *      que internacional (§V4). Modeled as a tier with a large gap so price
 *      can never flip tiers.
 *   2. Price (lower wins).
 *   3. Depth (shallower wins; fewer hops = closer to the seed).
 *
 * Implemented as a single weighted-decay numeric score. When two results tie
 * exactly, insertion order is preserved (Array.prototype.sort is stable).
 */

import type { CountryConfig, ProductResult } from '../../../shared/contract.ts';

const TIER_INT = 1_000_000;
const PRICE_FACTOR = 1e-3; // decays: price matters only inside the same tier
const DEPTH_FACTOR = 1e-6; // minimal last-resort tiebreak

export function domainAffinity(hostOrUrl: string, country: CountryConfig): boolean {
  let host: string;
  try {
    host = new URL(hostOrUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (host === country.ccTLD || host.endsWith(`.${country.ccTLD}`)) return true;
  for (const d of [...country.domains, ...country.marketplaces]) {
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}

export function isLocalResult(result: Pick<ProductResult, 'store'>): boolean {
  return result.store.local === true;
}

export function scoreFor(result: ProductResult, country: CountryConfig): number {
  const local = isLocalResult(result) || domainAffinity(result.store.siteUrl, country);
  const tier = local ? 0 : TIER_INT;
  return tier + PRICE_FACTOR * result.price + DEPTH_FACTOR * result.depth;
}

export function rankByPriority(results: ProductResult[], country: CountryConfig): ProductResult[] {
  const ranked = [...results].sort((a, b) => scoreFor(a, country) - scoreFor(b, country));
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}