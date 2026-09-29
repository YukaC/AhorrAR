/**
 * Collapse color/size/capacity variants of the same product on one host
 * before the result cap (T60) — keep the cheapest.
 */

import type { ProductResult } from '../../../shared/contract.ts';
import { hostOf } from './seeds.ts';

const VARIANT_TOKEN_RE =
  /\b(?:negro|negra|blanco|blanca|azul|rojo|roja|verde|gris|rosa|dorado|plateado|black|white|blue|red|green|gray|grey|pink|gold|silver|xs|s|m|l|xl|xxl|\d+\s*gb|\d+\s*tb|\d+\s*"|\d+\s*pulgadas?|talle\s*\w+)\b/gi;

export function normalizeTitleForVariantDedupe(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(VARIANT_TOKEN_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function dedupeVariantsByHost(results: ProductResult[]): ProductResult[] {
  const best = new Map<string, ProductResult>();
  for (const r of results) {
    const host = hostOf(r.store.siteUrl) || hostOf(r.url);
    const key = `${host}::${normalizeTitleForVariantDedupe(r.name)}`;
    const prev = best.get(key);
    if (!prev || r.price < prev.price) best.set(key, r);
  }
  return [...best.values()];
}
