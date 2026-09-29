import { describe, expect, it } from 'vitest';
import type { ProductResult } from '../../shared/contract.ts';
import { getCountry } from '../src/calendar/countries.ts';
import { adaptivePriceOutlierDemotions } from '../src/search/adaptive-relevance.ts';
import { rankByPriority } from '../src/scoring/score.ts';

function offer(name: string, price: number, host = 'fravega.com'): ProductResult {
  return {
    rank: 0,
    name,
    price,
    currency: 'ARS',
    store: { name: host, local: true, siteUrl: `https://${host}/` },
    url: `https://${host}/p/${encodeURIComponent(name)}-${price}`,
    shipping: {
      confirmed: true,
      country: 'AR',
      type: 'local',
      free: false,
      note: 'Envío confirmado',
    },
    depth: 0,
    sourceUrl: `https://${host}/`,
  };
}

describe('adaptive relevance §V31', () => {
  it('demotes price outliers when enough strong offers exist', () => {
    const product = 'iphone 15';
    const results: ProductResult[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(offer(`Apple iPhone 15 128GB modelo ${i}`, 1_200_000 + i * 1000, `shop${i}.com.ar`));
    }
    // Passes title gate but absurdly cheap vs median → demote (outlier / bad parse)
    results.push(offer('Apple iPhone 15 128GB oferta', 5_000, 'outlier.com.ar'));
    const demote = adaptivePriceOutlierDemotions(results, product);
    const cheapIdx = results.findIndex((r) => r.price === 5_000);
    expect(demote[cheapIdx]).toBe(true);
  });

  it('skips set signals with fewer than 8 strong offers', () => {
    const results = [
      offer('Apple iPhone 15 128GB', 1_200_000),
      offer('Funda para iPhone 15', 5_000, 'x.com.ar'),
    ];
    const demote = adaptivePriceOutlierDemotions(results, 'iphone 15');
    expect(demote.every((d) => d === false)).toBe(true);
  });

  it('ranked #1 prefers real product over cheap accessory when set is large', () => {
    const product = 'notebook';
    const results: ProductResult[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(offer(`Notebook Lenovo IdeaPad ${i} Intel i5`, 900_000 + i * 1000, `nb${i}.com.ar`));
    }
    results.push(offer('Funda para notebook 15.6', 12_000, 'funda.com.ar'));
    const ranked = rankByPriority(results, getCountry('AR'), 10, product);
    expect(ranked[0]!.name.toLowerCase()).toContain('notebook');
    expect(ranked[0]!.name.toLowerCase()).not.toContain('funda');
  });
});
