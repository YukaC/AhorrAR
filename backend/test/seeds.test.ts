import { describe, expect, it } from 'vitest';
import {
  categoryFor,
  buildSeedUrls,
  extractDiscoveryLinks,
  guessSearchUrls,
  isAllowed,
  isArHost,
  isCrawlWorthy,
  isDiscoveryHub,
  isPublishableResult,
} from '../src/search/seeds.ts';

describe('seeds procedural AR discovery (T12, §V13)', () => {
  it('categoryFor maps product keywords', () => {
    expect(categoryFor('perfume importado')).toBe('perfume');
    expect(categoryFor('motherboard amd')).toBe('pc');
    expect(categoryFor('bensimon')).toBe('perfume');
  });

  it('buildSeedUrls = hubs + bootstrap VTEX APIs + ML último', () => {
    const seeds = buildSeedUrls({ product: 'bensimon', country: 'AR', maxResults: 5 });
    expect(seeds.some((s) => /duckduckgo\.com/.test(s))).toBe(true);
    expect(seeds.some((s) => /bing\.com/.test(s))).toBe(true);
    expect(seeds.some((s) => /fravega\.com\/api\/catalog_system/.test(s))).toBe(true);
    expect(seeds.at(-1)).toMatch(/listado\.mercadolibre\.com\.ar/);
    expect(seeds.some((s) => /api\.mercadolibre\.com/.test(s))).toBe(true);
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
