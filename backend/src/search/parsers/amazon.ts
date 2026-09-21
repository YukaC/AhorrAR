/**
 * Amazon parser (amazon.es / amazon.com.mx / amazon.*). Pure regex, best-effort.

 * Listing cards expose prices in `.a-price-whole` / `.a-price-fraction` spans;
 * product pages expose them in `#corePrice_feature_div`. RAW extraction only —
 * normalize/shipping run in the shared pipeline.
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { absoluteUrl, normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';
import { extractImage } from './images.ts';

const URL_RE = /href="([^"]+)"/g;

function clean(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectLinks(url: string, content: string): string[] {
  const links: string[] = [];
  for (const m of content.matchAll(URL_RE)) {
    const abs = absoluteUrl(url, m[1]!);
    if (abs === null) continue;
    const norm = normalizeUrl(abs);
    if (norm !== null) links.push(norm);
  }
  return [...new Set(links)];
}

function priceInBlock(block: string): string | null {
  const whole = /class="a-price-whole">([\d,.]+)</.exec(block);
  const fraction = /class="a-price-fraction">(\d+)</.exec(block);
  if (whole === null) return null;
  const dec = fraction !== null && fraction[1] !== '00' ? `.${fraction[1]}` : '';
  return `${whole[1]}${dec}`;
}

function nameInBlock(block: string): string {
  const span = /class="a-size-base-plus a-color-base a-text-normal"[^>]*>([\s\S]*?)</.exec(block);
  if (span !== null) return span[1]!.trim();
  const title = /<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block);
  return title === null ? '' : clean(title[1]!);
}

function shippingHintOf(block: string): string | undefined {
  for (const re of [/env[íi]o\s+GRATIS/i, /env[íi]o\s+a\s+(?:toda\s+)?(?:Espa[ñn]a|M[ée]xico)/i, /FREE\s+delivery/i, /GRATIS\s+en\s+pedidos/i, /gastos\s+de\s+env[íi]o[^<"]*gratis/i]) {
    const m = re.exec(block);
    if (m !== null) return m[0];
  }
  return undefined;
}

function listingItems(url: string, content: string): RawItem[] {
  const items: RawItem[] = [];
  const cards = content.split(/data-asin="[^"]*"/).slice(1);
  const sources = cards.length > 0 ? cards : [content];

  for (const block of sources) {
    const link = /href="((?:https?:\/\/[^"]+)?\/dp\/[A-Z0-9]{10}[^"]*)"/.exec(block);
    if (link === null) continue;
    const itemUrl = absoluteUrl(url, link[1]!);
    if (itemUrl === null) continue;

    const priceRaw = priceInBlock(block);
    if (priceRaw === null) continue;

    const name = nameInBlock(block);
    if (name === '') continue;

    items.push({
      name: clean(name),
      priceRaw,
      shippingHint: shippingHintOf(block),
      store: { name: 'Amazon', logo: null, local: true, siteUrl: url.match(/amazon\.[^/]+/)?.[0] ?? 'https://www.amazon.es' },
      url: itemUrl,
      image: extractImage(block, url),
      depth: 0,
      sourceUrl: normalizeUrl(url) ?? url,
    });
  }
  return items;
}

function productPage(url: string, content: string): RawItem | null {
  const titleM = /<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/.exec(content);
  if (titleM === null) return null;
  const price = /=([\d.,]+)[^0-9]{0,12}id="corePriceDisplay_desktop_feature_div"|class="a-offscreen">([\d.,]+)</.exec(content) ?? /class="a-offscreen">([\d.,]+)</.exec(content);
  if (price === null) return null;
  const raw = price[1] ?? price[2];
  if (raw === undefined) return null;
  return {
    name: clean(titleM[1]!),
    priceRaw: raw.trim(),
    shippingHint: shippingHintOf(content),
    store: { name: 'Amazon', logo: null, local: true, siteUrl: url.match(/amazon\.[^/]+/)?.[0] ?? 'https://www.amazon.es' },
    url: normalizeUrl(url) ?? url,
    image: extractImage(content, url),
    depth: 0,
    sourceUrl: normalizeUrl(url) ?? url,
  };
}

export function parsePage(url: string, content: string, _params: SearchParams): ExtractResult {
  const isProduct = /\/dp\/[A-Z0-9]{10}/.test(url);
  let results: RawItem[];
  if (isProduct) {
    const single = productPage(url, content);
    results = single === null ? [] : [single];
  } else {
    results = listingItems(url, content);
    if (results.length === 0) {
      const single = productPage(url, content);
      if (single !== null) results = [single];
    }
  }
  return { results, links: collectLinks(url, content) };
}