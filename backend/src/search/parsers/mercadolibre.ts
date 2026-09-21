/**
 * MercadoLibre parser (mercadolibre.*, incl. MLA/MLM/MLS ids).
 * Pure regex/heuristic, best-effort, never throws. Full pipeline
 * (normalize/shipping) runs downstream — this only extracts RAW text.
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { absoluteUrl, normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';
import { extractImage } from './images.ts';

const URL_RE = /href="([^"]+)"/g;
const PRICE_META_RE = /itemprop="price"\s+content="([^"]+)"/i;

function firstMeta(content: string, name: string): string | null {
  const m = new RegExp(`<meta[^>]*(?:property|name)="${name}"[^>]*content="([^"]+)"`, 'i').exec(content);
  return m === null ? null : m[1]?.trim() ?? null;
}

function titleOf(content: string): string {
  return (
    firstMeta(content, 'og:title') ??
    firstMeta(content, 'twitter:title') ??
    /<title[^>]*>([^<]+)<\/title>/i.exec(content)?.[1]?.trim() ??
    'Producto'
  );
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectLinks(url: string, content: string): string[] {
  const links: string[] = [];
  for (const m of content.matchAll(URL_RE)) {
    const abs = absoluteUrl(url, m[1]!);
    if (abs !== null) {
      const norm = normalizeUrl(abs);
      if (norm !== null) links.push(norm);
    }
  }
  return [...new Set(links)];
}

function listingItems(url: string, content: string, _params: SearchParams): RawItem[] {
  const items: RawItem[] = [];
  // Prefer per-card <li> blocks; fall back to the whole page.
  const liBlocks = content.split(/<li\b[^>]*>/i).slice(1);
  const layoutBlocks = content.split(/class="(?=[^"]*ui-search-layout__items)/).slice(1);
  const sources = liBlocks.length > 0 ? liBlocks : layoutBlocks.length > 0 ? layoutBlocks : [content];

  for (const block of sources) {
    const link = /\bhref="([^"]*?\/(?:[A-Z]{2,3})-\d{5,}[^"]*)"/i.exec(block) ?? /\bhref="((?:https?:\/\/[^"]+)?\/[^"]*?-\d{5,}[^"]*)"/i.exec(block);
    if (link === null) continue;
    const itemUrl = absoluteUrl(url, link[1]!);
    if (itemUrl === null) continue;

    const priceM = PRICE_META_RE.exec(block);
    const priceSpan = /title="\$?\s*([\d][\d\s.,]*\d)"/.exec(block);
    const priceRaw = priceM?.[1] ?? priceSpan?.[1] ?? null;
    if (priceRaw === null) continue;

    const nameM = /\btitle="([^"]+)"/.exec(block) ?? /<h2[^>]*>\s*([\s\S]*?)<\/h2>/.exec(block);
    const rawName = nameM === null ? titleOf(block) : stripTags(nameM[1]!);

    items.push({
      name: clean(rawName),
      priceRaw,
      shippingHint: shippingHintOf(block),
      store: {
        name: 'MercadoLibre',
        logo: null,
        local: true,
        siteUrl: 'https://www.mercadolibre.com.ar',
      },
      url: itemUrl,
      image: extractImage(block, url),
      depth: 0,
      sourceUrl: normalizeUrl(url) ?? url,
    });
  }
  return items;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function shippingHintOf(content: string): string | undefined {
  // Match body text AND attribute values — never require a trailing `>`
  // (that broke `<p>Envío gratis a todo el país</p>` and dropped listings via §V1).
  for (const re of [
    /env[íi]o\s+gratis(?:\s+a\s+todo\s+el\s+pa[íi]s)?/i,
    /env[íi]o\s+a\s+todo\s+el\s+pa[íi]s/i,
    /env[íi]os?\s+a\s+todo\s+el\s+pa[íi]s/i,
    /env[íi]o\s+nacional/i,
    /\bmercado\s+env[íi]os?\b/i,
    /\bfull\b/i,
  ]) {
    const m = re.exec(content);
    if (m !== null) return clean(m[0]);
  }
  return undefined;
}

function productPage(url: string, content: string): RawItem | null {
  const priceM = PRICE_META_RE.exec(content) ?? /content="([\d][\d\s.,]*\d)"/.exec(content) ?? null;
  if (priceM === null) return null;
  return {
    name: clean(titleOf(content)),
    priceRaw: priceM[1]!,
    shippingHint: (shippingHintOf(content) ?? 'Mercado Envíos Full') as string,
    store: { name: 'MercadoLibre', logo: null, local: true, siteUrl: 'https://www.mercadolibre.com.ar' },
    url: normalizeUrl(url) ?? url,
    image: extractImage(content, url),
    depth: 0,
    sourceUrl: normalizeUrl(url) ?? url,
  };
}

export function parsePage(url: string, content: string, params: SearchParams): ExtractResult {
  const isProduct = /\/[A-Z]{2,3}-\d{7,}/.test(url);
  let results: RawItem[];
  if (isProduct) {
    const single = productPage(url, content);
    results = single === null ? [] : [single];
  } else {
    results = listingItems(url, content, params);
    if (results.length === 0) {
      const single = productPage(url, content);
      if (single !== null) results = [single];
    }
  }
  return { results, links: collectLinks(url, content) };
}