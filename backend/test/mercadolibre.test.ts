import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/search/parsers/mercadolibre.ts';
import { LISTING_HTML, LISTING_URL, PRODUCT_HTML, PRODUCT_URL } from './fixtures/live.ts';

const params = { product: 'perfume', country: 'AR' as const };

describe('MercadoLibre parser shippingHint (B3 / §V1)', () => {
  it('listing con <p>Envío gratis…</p> produce shippingHint (no exige cierre `>`)', () => {
    const out = parsePage(LISTING_URL, LISTING_HTML, params);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    const hint = out.results[0]!.shippingHint;
    expect(hint).toBeTruthy();
    expect(hint!.toLowerCase()).toMatch(/env[íi]o\s+gratis|a\s+todo\s+el\s+pa[íi]s|mercado\s+env/i);
  });

  it('product page conserva shippingHint / fallback Mercado Envíos', () => {
    const out = parsePage(PRODUCT_URL, PRODUCT_HTML, params);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.shippingHint).toBeTruthy();
  });
});
