import { describe, expect, it } from 'vitest';
import { extractImage } from '../src/search/parsers/images.ts';
import { parsePage as parseAmazon } from '../src/search/parsers/amazon.ts';
import { parsePage as parseGeneric } from '../src/search/parsers/generic.ts';
import { parsePage as parseMercadoLibre } from '../src/search/parsers/mercadolibre.ts';

describe('extractImage (V11: real images, never hardcoded null)', () => {
  it('og:image meta wins and resolves absolute', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.store.com/foto-perfume.webp/1000">
    </head></html>`;
    expect(extractImage(html, 'https://perfumeria.com.ar/p/1')).toBe('https://cdn.store.com/foto-perfume.webp/1000');
  });

  it('falls back to twitter:image when og:image is absent', () => {
    const html = `<html><head><meta name="twitter:image" content="https://cdn.store.com/foto.jpg"></head></html>`;
    expect(extractImage(html)).toBe('https://cdn.store.com/foto.jpg');
  });

  it('skips data:, svg, gif, icons, logos, trackers and hidden imgs; picks the biggest', () => {
    const html = `
      <img class="logo" src="https://site.com/logo.png" width="120">
      <img src="data:image/png;base64,AAAA">
      <img src="https://site.com/spacer.gif">
      <img class="icon" src="https://site.com/icon.svg">
      <img src="https://site.com/icon-16.png" width="16" height="16">
      <img style="display:none" src="https://site.com/hidden.jpg">
      <img src="https://site.com/foto-producto-bien-descriptiva.jpg">
      <img src="https://site.com/thumb.jpg">
    `;
    expect(extractImage(html)).toBe('https://site.com/foto-producto-bien-descriptiva.jpg');
  });

  it('resolves relative src against the page URL', () => {
    const html = `<img src="/media/products/pc-3.jpg" width="400">`;
    expect(extractImage(html, 'https://store.com.ar/tienda/pc')).toBe('https://store.com.ar/media/products/pc-3.jpg');
  });

  it('returns null when there is no usable image', () => {
    expect(extractImage('<html><body><p>sin imágenes</p></body></html>', 'https://a.com')).toBeNull();
    expect(extractImage('<img src="https://a.com/tracker.gif">')).toBeNull();
  });
});

const AR = { product: 'perfume', country: 'AR' as const };

describe('parser wiring (V11: RawItem.image populated)', () => {
  it('mercadolibre listing extracts per-card image', () => {
    const listing = `
      <div class="ui-search-layout__items">
        <li>
          <a href="/p/MLA-1234567890-1"><img src="https://http2.mlstatic.com/foto-perfume-420.jpg" width="200"></a>
          <div itemprop="price" content="14500"></div>
          <span title="$ 14500"></span>
        </li>
      </div>`;
    const { results } = parseMercadoLibre('https://listado.mercadolibre.com.ar/perfume', listing, AR);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.image).toBe('https://http2.mlstatic.com/foto-perfume-420.jpg');
  });

  it('amazon product page extracts og:image', () => {
    const page = `
      <span id="productTitle">Perfume 100ml</span>
      <span class="a-price"><span class="a-offscreen">45.999</span></span>
      <meta property="og:image" content="https://m.media-amazon.com/images/perfume-500.jpg">
    `;
    const { results } = parseAmazon('https://www.amazon.com/dp/B0ABC12345', page, AR);
    expect(results.length).toBe(1);
    expect(results[0]!.image).toBe('https://m.media-amazon.com/images/perfume-500.jpg');
  });

  it('generic JSON-LD image takes precedence, else og:image', () => {
    const html = `<html><head><meta property="og:image" content="https://cdn.com/og.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Perfume","offers":{"price":7400,"priceCurrency":"ARS"},"image":"https://cdn.com/ld-foto.jpg"}</script></html>`;
    const generic = parseGeneric('https://tienda.com.ar/p/1', html, AR);
    expect(generic.results[0]!.image).toBe('https://cdn.com/ld-foto.jpg');

    const plain = `<html><head><title>Crema facial hidratante 50ml</title><meta property="og:image" content="https://cdn.com/og-foto.jpg"></head><body>$ 5.000 Envío gratis</body></html>`;
    const fallback = parseGeneric('https://otra.com.ar/p/2', plain, AR);
    expect(fallback.results[0]!.image).toBe('https://cdn.com/og-foto.jpg');
    expect(fallback.results[0]!.name).toMatch(/Crema facial/i);
  });
});