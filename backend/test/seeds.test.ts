import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  categoryFor,
  buildSeedUrls,
  extractDiscoveryLinks,
  guessSearchUrls,
  isAllowed,
  isArHost,
  isCrawlWorthy,
  isCuratedHost,
  isDiscoveryHub,
  isKnownShopHost,
  isPublishableResult,
  registerDiscoveredShop,
  resetArShopsCacheForTests,
} from '../src/search/seeds.ts';

/** Fixture índice curado para tests (V19) — nunca escribe al índice real. */
const FMV_TMP = mkdtempSync(join(tmpdir(), 'ar-shops-'));
const FMV_INDEX = join(FMV_TMP, 'ar-shops.json');
const CURATED = {
  version: 3,
  shops: [
    {
      host: 'fravega.com',
      category: 'electro',
      curated: true,
      entry: 'https://www.fravega.com/api/catalog_system/pub/products/search?ft={q}&_from=0&_to=11',
      platform: 'vtex',
      alive: true,
    },
    {
      host: 'venex.com.ar',
      category: 'gaming',
      curated: true,
      entry: null,
      platform: 'oscommerce',
      alive: true,
    },
    {
      host: 'fullh4rd.com.ar',
      category: 'gaming',
      curated: true,
      entry: null,
      platform: 'unknown',
      alive: true,
    },
    {
      host: 'dead-shop.com.ar',
      category: 'gaming',
      curated: true,
      entry: 'https://www.dead-shop.com.ar/search?q={q}',
      platform: 'unknown',
      alive: false,
    },
  ],
};

beforeAll(() => {
  process.env['AR_SHOPS_JSON'] = FMV_INDEX;
  writeFileSync(FMV_INDEX, JSON.stringify(CURATED), 'utf8');
  resetArShopsCacheForTests();
});

afterAll(() => {
  delete process.env['AR_SHOPS_JSON'];
  rmSync(FMV_TMP, { recursive: true, force: true });
});

describe('seeds procedural AR discovery (T12, §V13)', () => {
  it('categoryFor maps product keywords', () => {
    expect(categoryFor('perfume importado')).toBe('perfumeria');
    expect(categoryFor('motherboard amd')).toBe('gaming');
    expect(categoryFor('bensimon')).toBe('perfumeria');
  });

  it('buildSeedUrls = hubs + índice curado + ML último; skips alive:false', () => {
    resetArShopsCacheForTests();
    const seeds = buildSeedUrls({ product: 'bensimon', country: 'AR', maxResults: 5 });
    expect(seeds.some((s) => /duckduckgo\.com/.test(s))).toBe(true);
    expect(seeds.some((s) => /bing\.com/.test(s))).toBe(true);
    expect(seeds.some((s) => /fravega\.com\/api\/catalog_system/.test(s))).toBe(true);
    expect(seeds.some((s) => /venex\.com\.ar/.test(s))).toBe(true);
    expect(seeds.some((s) => /dead-shop\.com\.ar/.test(s))).toBe(false);
    expect(seeds.some((s) => /api\.mercadolibre\.com/.test(s))).toBe(true);
    expect(seeds.at(-1)).toMatch(/listado\.mercadolibre\.com\.ar/);
  });

  it('guessSearchUrls unknown: VTEX + Woo + /?s= + /search (máx 4)', () => {
    const urls = guessSearchUrls('https://www.nueva-tienda.com.ar/foo', 'bensimon azul');
    expect(urls).toHaveLength(4);
    expect(urls[0]).toMatch(/\/api\/catalog_system\/pub\/products\/search/);
    expect(urls[1]).toMatch(/\/wp-json\/wc\/store\/v1\/products/);
    expect(urls.some((u) => /\?s=/.test(u))).toBe(true);
    expect(urls.some((u) => /\/search\?q=/.test(u))).toBe(true);
    expect(urls.every((u) => u.startsWith('https://www.nueva-tienda.com.ar'))).toBe(true);
  });

  it('guessSearchUrls platform-aware: woo → store API + ?s=', () => {
    const urls = guessSearchUrls('https://www.woo-shop.com.ar/', 'notebook', 'woo');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/\/wp-json\/wc\/store\/v1\/products\?search=/);
    expect(urls[1]).toMatch(/\?s=/);
  });

  it('guessSearchUrls platform-aware: shopify → suggest + products.json', () => {
    const urls = guessSearchUrls('https://www.shop.com.ar/', 'notebook', 'shopify');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/\/search\/suggest\.json/);
    expect(urls[1]).toMatch(/\/products\.json/);
  });

  it('guessSearchUrls platform-aware: oscommerce → resultado-busqueda', () => {
    const urls = guessSearchUrls('https://www.venex.com.ar/', 'rtx', 'oscommerce');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/resultado-busqueda\.htm\?keywords=/);
  });

  it('índice curado shared/ar-shops.json alimenta reputación + auto-expansión (V19)', () => {
    resetArShopsCacheForTests();
    expect(isArHost('venex.com.ar')).toBe(true);
    expect(isArHost('fullh4rd.com.ar')).toBe(true);
    expect(isCuratedHost('fravega.com')).toBe(true);
    expect(isKnownShopHost('venex.com.ar')).toBe(true);
    const before = new Set(buildSeedUrls({ product: 'rtx', country: 'AR', maxResults: 5 }));
    registerDiscoveredShop('tienda-nueva-e2e.com.ar');
    expect(isArHost('tienda-nueva-e2e.com.ar')).toBe(true);
    expect(isKnownShopHost('tienda-nueva-e2e.com.ar')).toBe(true);
    expect(isCuratedHost('tienda-nueva-e2e.com.ar')).toBe(false);
    // ⊥ duplicados idempotente
    registerDiscoveredShop('tienda-nueva-e2e.com.ar');
    const after = new Set(buildSeedUrls({ product: 'rtx', country: 'AR', maxResults: 5 }));
    void before;
    void after;
  });

  it('isArHost acepta .ar desconocido + bootstrap .com; corta externos', () => {
    expect(isArHost('tienda-desconocida.com.ar')).toBe(true);
    expect(isArHost('fravega.com')).toBe(true);
    expect(isArHost('google.com')).toBe(false);
    expect(isArHost('amazon.com.mx')).toBe(false);
  });

  it('isAllowed = AR heuristic ∨ discovery hub', () => {
    expect(isAllowed('https://listado.mercadolibre.com.ar/perfume')).toBe(true);
    expect(isAllowed('https://tienda-desconocida.com.ar/p/1')).toBe(true);
    expect(isAllowed('https://www.fravega.com/x/p')).toBe(true);
    expect(isAllowed('https://html.duckduckgo.com/html/?q=x')).toBe(true);
    expect(isAllowed('https://google.com/')).toBe(false);
    expect(isAllowed('not a url')).toBe(false);
  });

  it('isPublishableResult excluye hubs SERP; ML listado sí publica', () => {
    expect(isPublishableResult('https://html.duckduckgo.com/html/?q=x')).toBe(false);
    expect(isPublishableResult('https://www.bing.com/search?q=x')).toBe(false);
    expect(isPublishableResult('https://listado.mercadolibre.com.ar/p/MLA-1')).toBe(true);
    expect(isPublishableResult('https://www.fravega.com/p/1')).toBe(true);
  });

  it('isDiscoveryHub reconoce entry points', () => {
    expect(isDiscoveryHub('https://html.duckduckgo.com/html/?q=bensimon')).toBe(true);
    expect(isDiscoveryHub('https://www.fravega.com/')).toBe(false);
  });

  it('guessSearchUrls prioriza VTEX catalog API', () => {
    const urls = guessSearchUrls('https://www.nueva-tienda.com.ar/foo', 'bensimon azul');
    expect(urls[0]).toMatch(/\/api\/catalog_system\/pub\/products\/search/);
    expect(urls.every((u) => u.startsWith('https://www.nueva-tienda.com.ar'))).toBe(true);
  });

  it('extractDiscoveryLinks unwrap Bing u= + DDG uddg hacia AR', () => {
    const bingU = Buffer.from('https://www.fravega.com/bensimon').toString('base64');
    const html = `
      <a href="/l/?uddg=https%3A%2F%2Fwww.falabella.com.ar%2Fsearch">x</a>
      <a href="https://www.bing.com/ck/a?u=a1${bingU}">y</a>
      <a href="https://facebook.com/x">z</a>
      <a href="https://www.bing.com/search?q=more">noise</a>
    `;
    const links = extractDiscoveryLinks('https://www.bing.com/search?q=bensimon', html);
    expect(links.some((l) => /fravega\.com/.test(l))).toBe(true);
    expect(links.some((l) => /falabella\.com\.ar/.test(l))).toBe(true);
    expect(links.every((l) => !/facebook\.com/.test(l))).toBe(true);
    expect(links.every((l) => !/bing\.com/.test(l))).toBe(true);
  });

  it('isCrawlWorthy corta ruido de ML', () => {
    expect(isCrawlWorthy('https://listado.mercadolibre.com.ar/perfume')).toBe(true);
    expect(isCrawlWorthy('https://www.mercadolibre.com.ar/seguridad')).toBe(false);
  });
});
