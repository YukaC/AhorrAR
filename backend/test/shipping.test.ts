import { describe, expect, it } from 'vitest';
import { getCountry } from '../src/calendar/countries.ts';
import { validateShipping } from '../src/shipping/shipping.ts';
import { finalizeRawItem } from '../src/search/pipeline.ts';
import type { RawItem } from '../src/search/types.ts';

const AR = getCountry('AR');
const MX = getCountry('MX');
const ES = getCountry('ES');

describe('validateShipping', () => {
  it('confirms provable texts per country', () => {
    expect(validateShipping(AR, 'Envío a todo el país', true).confirmed).toBe(true);
    expect(validateShipping(AR, 'Envío gratis en compras superiores a $99.999', true)).toMatchObject({
      confirmed: true,
      free: true,
      type: 'local',
    });
    expect(validateShipping(MX, 'Envíos a México', true).confirmed).toBe(true);
    expect(validateShipping(MX, 'Envío full (Envío a todo México)', true).confirmed).toBe(true);
    expect(validateShipping(ES, 'Envío en 24h a toda España', true)).toMatchObject({
      confirmed: true,
      free: false,
    });
    expect(validateShipping(AR, 'Mercado Envíos Full', true).confirmed).toBe(true);
  });

  it('confirms international shipping to the destination country', () => {
    expect(validateShipping(AR, 'Shipping to Argentina', false)).toMatchObject({
      confirmed: true,
      type: 'international',
    });
    expect(validateShipping(MX, 'Ships to Mexico', false).confirmed).toBe(true);
    expect(validateShipping(ES, 'Shipping to Spain', false).confirmed).toBe(true);
  });

  it('extracts eta when present', () => {
    const eta = validateShipping(AR, 'Envío gratis · 3-5 días hábiles', true);
    expect(eta.eta).toBe('3-5 días');
  });

  it('rejects ambiguous or absent shipping hints (STRICT filter)', () => {
    expect(validateShipping(AR, '', true).confirmed).toBe(false);
    expect(validateShipping(AR, 'Solo retiro en local', true).confirmed).toBe(false);
    expect(validateShipping(MX, 'Entrega en mostrador', true).confirmed).toBe(false);
    expect(validateShipping(ES, 'Pickup disponible', true).confirmed).toBe(false);
  });

  it('UNCONFIRMED items are discarded before scoring (pipeline, §V1)', () => {
    const raw: RawItem = {
      name: 'iPhone 16',
      priceRaw: '1500',
      shippingHint: 'Solo retiro en tienda',
      store: { name: 'X', logo: null, local: true, siteUrl: 'https://x.example' },
      url: 'https://x.example/p/1',
      image: null,
      depth: 1,
      sourceUrl: 'https://x.example',
    };
    expect(finalizeRawItem(raw, { product: 'iphone', country: 'AR' }, AR)).toBeNull();

    const confirmed: RawItem = { ...raw, shippingHint: 'Envío a todo el país' };
    const done = finalizeRawItem(confirmed, { product: 'iphone', country: 'AR' }, AR);
    expect(done).not.toBeNull();
    expect(done!.shipping.confirmed).toBe(true);
    expect(done!.currency).toBe('ARS'); // §V2 currency-force
  });

  it('structured shippingFree overrides the hint regex (T37)', () => {
    const base: RawItem = {
      name: 'iPhone 16',
      priceRaw: '1500',
      shippingHint: 'Envío a domicilio',
      store: { name: 'X', logo: null, local: true, siteUrl: 'https://x.example' },
      url: 'https://x.example/p/1',
      image: null,
      depth: 1,
      sourceUrl: 'https://x.example',
    };
    // VTEX ShippingSLA Price 0 → free=true aunque el hint no diga "gratis".
    const free = finalizeRawItem({ ...base, shippingFree: true }, { product: 'iphone', country: 'AR' }, AR);
    expect(free!.shipping.free).toBe(true);
    // ML free_shipping=false → free=false aunque el hint diga "gratis".
    const notFree = finalizeRawItem(
      { ...base, shippingHint: 'Envío gratis', shippingFree: false },
      { product: 'iphone', country: 'AR' },
      AR,
    );
    expect(notFree!.shipping.free).toBe(false);
    // Sin señal estructurada → el regex del hint decide (comportamiento previo).
    const regex = finalizeRawItem({ ...base, shippingHint: 'Envío gratis' }, { product: 'iphone', country: 'AR' }, AR);
    expect(regex!.shipping.free).toBe(true);
  });
});