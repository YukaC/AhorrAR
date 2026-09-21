import type { AppConfig } from '../../src/config.ts';
import type { FetchResult } from '../../src/search/types.ts';

export const TEST_CFG: AppConfig = {
  port: 0,
  stealth: false,
  maxDepth: 2,
  maxNodes: 10,
  maxResults: 5,
  concurrency: 2,
  userAgent: 'ahorrar-test',
  crawler: 'legacy',
  scraplingUrl: 'http://127.0.0.1:4100',
  includeMl: false,
};

export const LISTING_URL = 'https://listado.mercadolibre.com.ar/perfume';

export const LISTING_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Perfume Dolce | MercadoLibre Argentina">
<title>Perfume Dolce | MercadoLibre Argentina</title>
</head><body><ul class="ui-search-layout__items">
<li>
  <a href="/p/MLA-1234567890-1" title="Perfume Dolce 100ml"><img src="https://http2.mlstatic.com/foto-perfume-420.jpg" width="200" alt="Perfume Dolce 100ml"></a>
  <h2>Perfume Dolce 100ml</h2>
  <div itemprop="price" content="14500"></div>
  <span title="$ 14.500"></span>
  <p>Envío gratis a todo el país</p>
</li>
<li>
  <a href="/p/MLA-9876543210-2" title="Perfume Chanel Chance 50ml"><img src="https://http2.mlstatic.com/foto-chanel-420.jpg" width="200" alt="Perfume Chanel Chance 50ml"></a>
  <h2>Perfume Chanel Chance 50ml</h2>
  <div itemprop="price" content="89900"></div>
  <span title="$ 89.900"></span>
  <p>Envío gratis a todo el país</p>
</li>
</ul>
<a href="https://www.amazon.com.mx/dp/B00" title="fuera de AR">otro pais</a></body></html>`;

export const PRODUCT_URL = 'https://listado.mercadolibre.com.ar/p/MLA-1234567890-1';
export const PRODUCT_URL_B = 'https://listado.mercadolibre.com.ar/p/MLA-9876543210-2';

export const PRODUCT_HTML = `<html><head>
<meta property="og:title" content="Perfume Dolce 100ml Original">
<meta property="og:image" content="https://http2.mlstatic.com/foto-perfume-producto-800.jpg">
<meta itemprop="price" content="16950">
</head><body><h1>Perfume Dolce 100ml Original</h1><p>Envío gratis a todo el país. Mercado Envíos Full.</p></body></html>`;

export function fetchFixture(url: string, _depth: number): Promise<FetchResult | null> {
  if (url === LISTING_URL) {
    return Promise.resolve({ url, html: LISTING_HTML, links: [], nextUrls: [] });
  }
  if (url === PRODUCT_URL) {
    return Promise.resolve({ url, html: PRODUCT_HTML, links: [], nextUrls: [] });
  }
  if (url === PRODUCT_URL_B) {
    return Promise.resolve({
      url,
      html: `<html><head>
<meta property="og:title" content="Perfume Chanel Chance 50ml">
<meta property="og:image" content="https://http2.mlstatic.com/foto-chanel-800.jpg">
<meta itemprop="price" content="89900">
</head><body><h1>Perfume Chanel Chance 50ml</h1><p>Envío gratis a todo el país</p></body></html>`,
      links: [],
      nextUrls: [],
    });
  }
  return Promise.resolve(null);
}
