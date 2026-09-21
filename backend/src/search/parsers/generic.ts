/**
 * Generic fallback parser: schema.org JSON-LD first, then microdata, then
 * a price-regex heuristic. Never throws. RAW extraction only.
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { absoluteUrl, normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';
import { extractImage } from './images.ts';

const URL_RE = /href="([^"]+)"/g;
const PRICE_RE = /(?:desde\s+)?[$€£]\s?([\d][\d\s.,]{0,12}\d)/g;

interface JsonLdNode {
  '@type'?: string | string[];
  name?: string;
  image?: string | string[] | { url?: string };
  offers?:
    | { price?: number | string; priceSpecification?: { price?: number | string }; availability?: string }
    | Array<{ price?: number | string; priceSpecification?: { price?: number | string } }>;
  price?: number | string;
  [key: string]: unknown;
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

function titleOf(content: string): string {
  const og = /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(content);
  if (og !== null) return og[1]!.trim();
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
  return title === null ? 'Producto' : title[1]!.trim();
}

function priceFromLd(node: JsonLdNode): number | string | undefined {
  const offers = node.offers;
  if (Array.isArray(offers) && offers.length > 0) {
    const first = offers[0];
    return first?.price ?? first?.priceSpecification?.price;
  }
  if (offers !== undefined && !Array.isArray(offers)) {
    return offers.price ?? offers.priceSpecification?.price;
  }
  return node.price;
}

function imageFromLd(node: JsonLdNode): string | null {
  const img = node.image;
  const raw = Array.isArray(img) ? img[0] : typeof img === 'string' ? img : img?.url;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function ldProducts(content: string): RawItem[] {
  const items: RawItem[] = [];
  const scripts = content.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const script of scripts) {
    const json = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of list) {
      const graph = (entry as { '@graph'?: JsonLdNode[] })['@graph'] ?? [(entry as JsonLdNode)];
      for (const node of graph) {
        const t = node['@type'];
        if (typeof t !== 'string' || !/product|offer/i.test(t)) continue;
        const price = priceFromLd(node);
        if (price === undefined) continue;
        const name = String(node.name ?? '').trim();
        if (name.length < 4 || /^producto$/i.test(name)) continue;
        const productUrl =
          (typeof node.url === 'string' && node.url) ||
          (typeof node['@id'] === 'string' && node['@id'].startsWith('http') ? node['@id'] : '') ||
          '';
        items.push({
          name,
          priceRaw: String(price),
          shippingHint: shippingHintOf(content),
          store: genericStore(),
          url: productUrl,
          image: imageFromLd(node) ?? extractImage(content),
          depth: 0,
          sourceUrl: '',
        });
      }
    }
  }
  return items;
}

function genericStore(): { name: string; logo: null; local: boolean; siteUrl: string } {
  return { name: 'Tienda online', logo: null, local: true, siteUrl: '' };
}

function microdataItems(content: string): RawItem[] {
  const priceM = /itemprop="price"\s+content="([^"]+)"/gi.exec(content);
  if (priceM === null || priceM[1] === undefined) return [];
  const nameM = /itemprop="name"\s+content="([^"]+)"/i.exec(content) ?? /itemprop="name">([^<]+)</.exec(content);
  return [
    {
      name: nameM === null ? titleOf(content) : clean(nameM[1]!),
      priceRaw: priceM[1],
      shippingHint: shippingHintOf(content),
      store: genericStore(),
      url: '',
      image: null,
      depth: 0,
      sourceUrl: '',
    },
  ];
}

function regexItems(title: string, content: string): RawItem[] {
  const items: RawItem[] = [];
  for (const m of content.matchAll(PRICE_RE)) {
    if (m[1] === undefined) continue;
    items.push({
      name: title,
      priceRaw: m[1],
      shippingHint: shippingHintOf(content),
      store: genericStore(),
      url: '',
      image: null,
      depth: 0,
      sourceUrl: '',
    });
    if (items.length >= 6) break;
  }
  return items;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function shippingHintOf(content: string): string | undefined {
  for (const re of [/env[íi]o\s+(?:gratis|a\s+todo|a\s+[\w\u00E0-\u00FF]+|nacional)/i, /free\s+shipping/i, /env[íi]o?\s+gratuito/i]) {
    const m = re.exec(content);
    if (m !== null) return m[0];
  }
  return undefined;
}

export function parsePage(url: string, content: string, _params: SearchParams): ExtractResult {
  const links = collectLinks(url, content).filter((l) => !l.match(/\.(png|jpg|jpeg|gif|webp|css|js|svg|woff2?|ttf)(\?|$)/i));
  const ld = ldProducts(content);
  // Prefer structured data; regex flood collapses every hit onto the same page URL.
  const results: RawItem[] = ld.length > 0 ? ld : [...microdataItems(content), ...regexItems(titleOf(content), content)];
  const pageUrl = normalizeUrl(url) ?? url;
  const seen = new Set<string>();
  const unique: RawItem[] = [];
  for (const item of results) {
    const itemUrl = item.url && item.url.startsWith('http') ? (normalizeUrl(item.url) ?? item.url) : pageUrl;
    if (seen.has(itemUrl)) continue;
    if (/^producto$/i.test(item.name) || item.name.trim().length < 4) continue;
    seen.add(itemUrl);
    item.url = itemUrl;
    item.sourceUrl = pageUrl;
    if (!item.store.siteUrl) {
      try {
        item.store.siteUrl = new URL(pageUrl).origin;
        item.store.name = new URL(pageUrl).hostname.replace(/^www\./, '');
      } catch {
        /* keep defaults */
      }
    }
    if (item.image === undefined || item.image === null) item.image = extractImage(content, url);
    unique.push(item);
  }
  return { results: unique, links };
}
