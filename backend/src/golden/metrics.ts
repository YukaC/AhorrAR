/**
 * Golden-set metrics (T58). Replay labeled offer pools through the live
 * publish gate + rankByPriority — reproducible, no network.
 *
 * Split: `tuning/` for iteration, `holdout/` sealed for validation.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductResult } from '../../../shared/contract.ts';
import { getCountry } from '../calendar/countries.ts';
import { isRelevantResult } from '../search/relevance.ts';
import { rankByPriority } from '../scoring/score.ts';

export type GoldenLabel = 'product' | 'accessory';

export interface GoldenOffer {
  name: string;
  price: number;
  url: string;
  host: string;
  label: GoldenLabel;
  ml?: boolean;
  /** T60: false ⇒ stock filter should drop before ranking (ignored until T60 wires it). */
  inStock?: boolean;
  /** T60: shared key for color/size variant group (same host+base title). */
  variantGroup?: string;
}

export interface GoldenQueryFile {
  query: string;
  offers: GoldenOffer[];
}

export interface QueryMetrics {
  query: string;
  precisionAt10: number;
  /** Product-labeled offers in top-10 / all product-labeled in fixture. */
  recallAt10: number;
  /** Product-labeled that passed the publish gate / all product-labeled. */
  recallPublished: number;
  /** Product-labeled offers that never entered top-10 (gate reject or ranked out). */
  missedProducts: string[];
  minPriceRelevant: number | null;
  distinctHosts: number;
  mlOfferCount: number;
  hasMl: boolean;
  publishedCount: number;
  productLabeled: number;
  top10Labels: GoldenLabel[];
}

export interface GoldenSummary {
  split: 'tuning' | 'holdout' | 'all';
  queries: QueryMetrics[];
  meanPrecisionAt10: number;
  meanRecallAt10: number;
  meanRecallPublished: number;
  meanHosts: number;
  mlCoveragePct: number;
  meanMlOffersWhenPresent: number;
}

const GOLDEN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../shared/golden');
export const TUNING_DIR = join(GOLDEN_ROOT, 'tuning');
export const HOLDOUT_DIR = join(GOLDEN_ROOT, 'holdout');

export function loadGoldenQueries(dir = TUNING_DIR): GoldenQueryFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenQueryFile;
    return raw;
  });
}

function toProductResult(offer: GoldenOffer, index: number): ProductResult {
  const siteUrl = `https://${offer.host}/`;
  return {
    rank: index + 1,
    name: offer.name,
    price: offer.price,
    currency: 'ARS',
    store: {
      name: offer.ml ? `ML · ${offer.host}` : offer.host,
      local: true,
      siteUrl,
    },
    url: offer.url,
    image: null,
    shipping: {
      confirmed: true,
      country: 'AR',
      type: 'local',
      free: false,
      note: 'Envío confirmado',
    },
    depth: 0,
    sourceUrl: offer.url,
  };
}

export function metricsForQuery(gq: GoldenQueryFile, topN = 10): QueryMetrics {
  const country = getCountry('AR');
  const labelByUrl = new Map(gq.offers.map((o) => [o.url, o.label]));
  const mlByUrl = new Map(gq.offers.map((o) => [o.url, o.ml === true]));
  const productLabeled = gq.offers.filter((o) => o.label === 'product').length;

  const candidates = gq.offers
    .map((o, i) => toProductResult(o, i))
    .filter((r) => isRelevantResult(r.name, gq.query));

  const ranked = rankByPriority(candidates, country, topN, gq.query);
  const top = ranked.slice(0, topN);
  const top10Labels = top.map((r) => labelByUrl.get(r.url) ?? 'accessory');
  const productHits = top10Labels.filter((l) => l === 'product').length;
  const precisionAt10 = top.length === 0 ? 0 : productHits / top.length;

  const productPublished = candidates.filter((r) => labelByUrl.get(r.url) === 'product').length;
  const recallAt10 = productLabeled === 0 ? 1 : productHits / productLabeled;
  const recallPublished = productLabeled === 0 ? 1 : productPublished / productLabeled;

  const topUrls = new Set(top.map((r) => r.url));
  const missedProducts = gq.offers
    .filter((o) => o.label === 'product' && !topUrls.has(o.url))
    .map((o) => o.name);

  const productPrices = candidates
    .filter((r) => labelByUrl.get(r.url) === 'product')
    .map((r) => r.price);
  const minPriceRelevant = productPrices.length === 0 ? null : Math.min(...productPrices);

  const hosts = new Set(top.map((r) => new URL(r.store.siteUrl).hostname.replace(/^www\./, '')));
  const mlOfferCount = top.filter((r) => mlByUrl.get(r.url) === true).length;

  return {
    query: gq.query,
    precisionAt10,
    recallAt10,
    recallPublished,
    missedProducts,
    minPriceRelevant,
    distinctHosts: hosts.size,
    mlOfferCount,
    hasMl: mlOfferCount > 0,
    publishedCount: ranked.length,
    productLabeled,
    top10Labels,
  };
}

export function summarizeGolden(
  queries = loadGoldenQueries(),
  split: GoldenSummary['split'] = 'tuning',
): GoldenSummary {
  const rows = queries.map((q) => metricsForQuery(q));
  const n = rows.length || 1;
  const withMl = rows.filter((r) => r.hasMl);
  return {
    split,
    queries: rows,
    meanPrecisionAt10: rows.reduce((s, r) => s + r.precisionAt10, 0) / n,
    meanRecallAt10: rows.reduce((s, r) => s + r.recallAt10, 0) / n,
    meanRecallPublished: rows.reduce((s, r) => s + r.recallPublished, 0) / n,
    meanHosts: rows.reduce((s, r) => s + r.distinctHosts, 0) / n,
    mlCoveragePct: (withMl.length / n) * 100,
    meanMlOffersWhenPresent:
      withMl.length === 0 ? 0 : withMl.reduce((s, r) => s + r.mlOfferCount, 0) / withMl.length,
  };
}
