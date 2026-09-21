import { describe, expect, it } from 'vitest';
import { httpBodyLooksUseful, prefersHttp, Semaphore } from '../src/search/http-fetch.ts';
import { parseMercadoLibreApi } from '../src/search/parsers/mercadolibre-api.ts';
import { parseVtexCatalogApi } from '../src/search/parsers/vtex-api.ts';

describe('http-fetch helpers (T13)', () => {
  it('prefersHttp for SERP + VTEX catalog + ML API', () => {
    expect(prefersHttp('https://www.bing.com/search?q=x')).toBe(true);
    expect(prefersHttp('https://api.mercadolibre.com/sites/MLA/search?q=x')).toBe(true);
    expect(prefersHttp('https://www.fravega.com/api/catalog_system/pub/products/search/?ft=x')).toBe(true);
    expect(prefersHttp('https://www.fravega.com/producto/p')).toBe(false);
  });

  it('httpBodyLooksUseful rejects challenge + tiny shells', () => {
    expect(httpBodyLooksUseful('x', 'text/html')).toBe(false);
    expect(httpBodyLooksUseful('<html>negative_traffic</html>', 'text/html')).toBe(false);
    expect(httpBodyLooksUseful('[{"productName":"A"}]', 'application/json')).toBe(true);
  });

  it('Semaphore limits concurrency', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const run = async (): Promise<void> => {
      await sem.acquire();
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      sem.release();
    };
    await Promise.all([run(), run(), run(), run()]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('JSON API parsers (T13)', () => {
  it('parseVtexCatalogApi extracts offers', () => {
    const body = JSON.stringify([
      {
        productName: 'Bensimon Sunset Edp 100ml',
        linkText: 'bensimon-sunset-edp-100ml',
        items: [
          {
            images: [{ imageUrl: 'https://cdn.example/a.jpg' }],
            sellers: [{ commertialOffer: { Price: 45990, AvailableQuantity: 3 } }],
          },
        ],
      },
    ]);
    const out = parseVtexCatalogApi(
      'https://www.fravega.com/api/catalog_system/pub/products/search/?ft=bensimon',
      body,
      { product: 'bensimon', country: 'AR' },
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.priceRaw).toBe('45990');
    expect(out.results[0]!.url).toContain('/bensimon-sunset-edp-100ml/p');
  });

  it('parseMercadoLibreApi maps shipping + permalink', () => {
    const body = JSON.stringify({
      results: [
        {
          title: 'Perfume Bensimon Bold',
          price: 39990,
          permalink: 'https://articulo.mercadolibre.com.ar/MLA-1',
          thumbnail: 'http://http2.mlstatic.com/x.jpg',
          shipping: { free_shipping: true, logistic_type: 'fulfillment' },
          seller: { nickname: 'TIENDA' },
        },
      ],
    });
    const out = parseMercadoLibreApi('https://api.mercadolibre.com/sites/MLA/search?q=bensimon', body, {
      product: 'bensimon',
      country: 'AR',
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.shippingHint).toMatch(/Envío gratis/i);
    expect(out.results[0]!.image).toMatch(/^https:/);
  });
});
