import { describe, expect, it } from 'vitest';
import { getCountry } from '../src/calendar/countries.ts';
import { domainAffinity, rankByPriority } from '../src/scoring/score.ts';
import type { ProductResult } from '../../shared/contract.ts';

const AR = getCountry('AR');

function result(over: Partial<ProductResult> & { price: number }): ProductResult {
  return {
    rank: 0,
    name: 'Producto',
    price: over.price,
    currency: 'ARS',
    store: {
      name: over.store?.name ?? 'Tienda',
      logo: null,
      local: over.store?.local ?? true,
      siteUrl: over.store?.siteUrl ?? 'https://www.mercadolibre.com.ar',
    },
    url: 'https://tienda.example/p/1',
    image: null,
    shipping: { confirmed: true, country: 'AR', type: over.shipping?.type ?? (over.store?.local ?? true ? 'local' : 'international'), free: true },
    depth: over.depth ?? 1,
    sourceUrl: 'https://tienda.example',
    ...over,
  };
}

describe('rankByPriority', () => {
  it('local store beats international at equal price (§V4)', () => {
    const local = result({ price: 1000, store: { name: 'Local', local: true, siteUrl: 'https://local.com.ar' } });
    const intl = result({ price: 1000, store: { name: 'Intl', local: false, siteUrl: 'https://intl.com' } });
    const ranked = rankByPriority([intl, local], AR);
    expect(ranked.map((r) => r.store.name)).toEqual(['Local', 'Intl']);
    expect(ranked[0]!.rank).toBe(1);
  });

  it('international must lose even when much cheaper (tier gap)', () => {
    const local = result({ price: 1_249_999 });
    const intl = result({ price: 10_000, depth: 2, store: { name: 'Intl', local: false, siteUrl: 'https://intl.com' } });
    const ranked = rankByPriority([intl, local], AR);
    expect(ranked[0]!.store.local).toBe(true);
  });

  it('price is the tiebreak inside the same tier', () => {
    const dear = result({ price: 5000 });
    const cheap = result({ price: 3000 });
    expect(rankByPriority([dear, cheap], AR).map((r) => r.price)).toEqual([3000, 5000]);
  });

  it('depth is the last-resort tiebreak (shallower wins)', () => {
    const shallow = result({ price: 4000, depth: 1 });
    const deep = result({ price: 4000, depth: 3 });
    expect(rankByPriority([deep, shallow], AR).map((r) => r.depth)).toEqual([1, 3]);
  });

  it('domainAffinity detects official marketplaces and ccTLD', () => {
    expect(domainAffinity('https://www.mercadolibre.com.ar', AR)).toBe(true);
    expect(domainAffinity('https://listado.mercadolibre.com.ar', AR)).toBe(true);
    expect(domainAffinity('https://www.amazon.com', AR)).toBe(false);
    expect(domainAffinity('not a url', AR)).toBe(false);
  });

  it('assigns contiguous ranks 1..n', () => {
    const ranked = rankByPriority([result({ price: 3 }), result({ price: 1 }), result({ price: 2 })], AR);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('curated reputation wins the tie at equal price (§V18)', () => {
    const curated = result({ price: 1000, store: { name: 'Fravega', local: true, siteUrl: 'https://www.fravega.com' } });
    const unknown = result({ price: 1000, store: { name: 'tienda-desconocida.com.ar', local: true, siteUrl: 'https://tienda-desconocida.com.ar' } });
    const ranked = rankByPriority([unknown, curated], AR);
    expect(ranked[0]!.store.name).toBe('Fravega');
  });

  it('cuotas sin interés bonifican el ranking (§V18)', () => {
    const cuotas = result({
      price: 1000,
      store: { name: 'A', local: true, siteUrl: 'https://a.com.ar' },
      installments: { count: 12, interestFree: true },
    });
    const sinCuotas = result({ price: 1000, store: { name: 'B', local: true, siteUrl: 'https://b.com.ar' } });
    const ranked = rankByPriority([sinCuotas, cuotas], AR);
    expect(ranked[0]!.store.name).toBe('A');
  });

  it('ML share capped at 50% of top-N (§V17)', () => {
    const mk = (n: string, price: number, ml: boolean): ProductResult =>
      result({
        price,
        store: {
          name: ml ? `ML · ${n}` : n,
          local: true,
          siteUrl: ml ? 'https://www.mercadolibre.com.ar' : `https://${n}.com.ar`,
        },
      });
    const results = [
      mk('ml1', 1, true), mk('ml2', 2, true), mk('ml3', 3, true),
      mk('ml4', 4, true), mk('ml5', 5, true), mk('ml6', 6, true),
      mk('tienda1', 7, false), mk('tienda2', 8, false),
    ];
    const ranked = rankByPriority(results, AR, 8);
    expect(ranked.length).toBeLessThanOrEqual(8);
    const ml = ranked.filter((r) => r.store.name.startsWith('ML ·')).length;
    expect(ml).toBeLessThanOrEqual(4); // 50% de 8
    expect(ranked.some((r) => r.store.name === 'tienda2')).toBe(true);
  });
});