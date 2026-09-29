import { describe, expect, it } from 'vitest';
import type { ProductResult } from '../../shared/contract.ts';
import { dedupeVariantsByHost, normalizeTitleForVariantDedupe } from '../src/search/dedupe-variants.ts';

function offer(name: string, price: number, host: string): ProductResult {
  return {
    rank: 0,
    name,
    price,
    currency: 'ARS',
    store: { name: host, local: true, siteUrl: `https://${host}/` },
    url: `https://${host}/p/${price}`,
    shipping: {
      confirmed: true,
      country: 'AR',
      type: 'local',
      free: false,
      note: 'Envío confirmado',
    },
    depth: 0,
    sourceUrl: `https://${host}/p/${price}`,
  };
}

describe('dedupeVariantsByHost T60', () => {
  it('normalizes color/size tokens away', () => {
    expect(normalizeTitleForVariantDedupe('iPhone 15 128GB Negro')).toBe(
      normalizeTitleForVariantDedupe('iPhone 15 256GB Blanco'),
    );
  });

  it('keeps cheapest variant per host+title', () => {
    const out = dedupeVariantsByHost([
      offer('iPhone 15 128GB Negro', 1_300_000, 'fravega.com'),
      offer('iPhone 15 256GB Blanco', 1_200_000, 'fravega.com'),
      offer('iPhone 15 128GB Negro', 1_250_000, 'musimundo.com'),
    ]);
    expect(out).toHaveLength(2);
    const fravega = out.find((r) => r.store.siteUrl.includes('fravega'));
    expect(fravega?.price).toBe(1_200_000);
  });
});
