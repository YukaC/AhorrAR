/**
 * Result ranking.
 *
 * Priority, in order:
 *   1. Domain affinity — local (ccTLD país + marketplaces oficiales) antes
 *      que internacional (§V4). Modeled as a tier with a large gap so price
 *      can never flip tiers.
 *   2. Effective price — weighted by curation reputation (§V18: curated index
 *      y shops descubiertas ponderan mejor) and interest-free installments
 *      bonus (§V18: cuotas sin interés).
 *   3. Depth (shallower wins; fewer hops = closer to the seed).
 *
 * When a cap is given, MercadoLibre share is clamped to ≤50% (§V17).
 * Implemented as a single weighted-decay numeric score. When two results tie
 * exactly, insertion order is preserved (Array.prototype.sort is stable).
 */

import type { CountryConfig, ProductResult } from '../../../shared/contract.ts';
import { hostOf, isCuratedHost, isKnownShopHost } from '../search/seeds.ts';

const TIER_INT = 1_000_000;
const PRICE_FACTOR = 1e-3; // decays: price matters only inside the same tier
const DEPTH_FACTOR = 1e-6; // minimal last-resort tiebreak

// Effective-price discounts (reputation + financing) — modest so price stays
// the dominant signal, but curated reputation and 0% installments win ties
// and narrow gaps (§V18).
const REP_CURATED = 0.08;
const REP_DISCOVERED = 0.04;
const INSTALLMENTS_BONUS = 0.03;

function isMlResult(result: ProductResult): boolean {
  try {
    const host = hostOf(result.store.siteUrl);
    if (host === '' || host === 'mercadolibre.com.ar' || host.endsWith('.mercadolibre.com.ar')) return true;
  } catch {
    /* fallthrough */
  }
  return result.store.name.startsWith('ML ·');
}

function reputationDiscount(result: ProductResult): number {
  const host = hostOf(result.store.siteUrl);
  if (host === '') return 0;
  if (isCuratedHost(host)) return REP_CURATED;
  if (isKnownShopHost(host)) return REP_DISCOVERED;
  return 0;
}

function installmentDiscount(result: ProductResult): number {
  if (result.installments?.interestFree === true) return INSTALLMENTS_BONUS;
  return 0;
}

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
  const discount = reputationDiscount(result) + installmentDiscount(result);
  const effective = result.price * (1 - discount);
  return tier + PRICE_FACTOR * effective + DEPTH_FACTOR * result.depth;
}

/**
 * Rank by priority, optionally clamping ML share to ≤50% of the top
 * `maxResults` (§V17). Without a cap, behavior matches the pure sort.
 */
export function rankByPriority(
  results: ProductResult[],
  country: CountryConfig,
  capMlShareOf?: number | null,
): ProductResult[] {
  const ranked = [...results].sort((a, b) => scoreFor(a, country) - scoreFor(b, country));
  if (capMlShareOf === undefined || capMlShareOf === null || capMlShareOf <= 0) {
    return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
  }
  const mlMax = Math.ceil(capMlShareOf * 0.5);
  const picked: ProductResult[] = [];
  let ml = 0;
  for (const r of ranked) {
    if (picked.length >= capMlShareOf) break;
    if (isMlResult(r)) {
      if (ml >= mlMax) continue; // drop over-share ML
      ml += 1;
    }
    picked.push(r);
  }
  return picked.map((r, i) => ({ ...r, rank: i + 1 }));
}