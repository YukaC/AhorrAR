/**
 * VTEX / AR retail listing parser (Farmacity, Pigmento, Juleriaque, Frávega…).
 * 1) JSON blobs: productName + lowPrice + linkText
 * 2) Shelf HTML cards: <a title href=…/p> + BestPrice/ListPrice (Frávega)
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { absoluteUrl, normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';
import { extractImage } from './images.ts';

const URL_RE = /href="([^"]+)"/g;

function isFravegaHost(host: string): boolean {
  const h = host.replace(/^www\./, '').toLowerCase();
  return h === 'fravega.com' || h.endsWith('.fravega.com');
}

/** ML / anti-bot interstitial — do not crawl further. */
export function isChallengePage(html: string): boolean {
  return /negative_traffic|suspicious-traffic|account-verification/i.test(html);
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

function storeOf(pageUrl: string): RawItem['store'] {
  try {
    const u = new URL(pageUrl);
    return { name: u.hostname.replace(/^www\./, ''), logo: null, local: true, siteUrl: u.origin };
  } catch {
    return { name: 'Tienda AR', logo: null, local: true, siteUrl: pageUrl };
  }
}

function shippingHintOf(content: string): string {
  for (const re of [
    /env[íi]o\s+gratis/i,
    /env[íi]o\s+a\s+todo(?:\s+el\s+pa[íi]s)?/i,
    /env[íi]o\s+a\s+domicilio/i,
    /env[íi]o\s+nacional/i,
  ]) {
    const m = re.exec(content);
    if (m !== null) return m[0];
  }
  return 'Envío a domicilio';
}

function decodeJsonString(raw: string): string {
  return raw.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Pull product cards from VTEX JSON blobs embedded in the HTML. */
function vtexJsonItems(pageUrl: string, content: string): RawItem[] {
  let host = '';
  let origin = '';
  try {
    const u = new URL(pageUrl);
    origin = u.origin;
    host = u.hostname.replace(/^www\./, '');
  } catch {
    return [];
  }
  // Frávega Next PDPs need itemId from the catalog API — HTML linkText often
  // ends in productId and yields empty shells (§V22). Skip this path.
  if (isFravegaHost(host)) return [];

  const names = [...content.matchAll(/"productName":"([^"\\]{4,120})"/g)].map((m) => m[1]!);
  const prices = [...content.matchAll(/"lowPrice":(\d+(?:\.\d+)?)/g)].map((m) => m[1]!);
  const slugs = [...content.matchAll(/"linkText":"([^"\\]+)"/g)].map((m) => m[1]!);
  const images = [...content.matchAll(/"imageUrl":"(https?:[^"]+)"/g)].map((m) => m[1]!.replace(/\\u002F/g, '/'));

  const n = Math.min(names.length, prices.length, slugs.length);
  if (n === 0) return [];

  const items: RawItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n && items.length < 20; i++) {
    const slug = slugs[i]!;
    const productUrl = normalizeUrl(`${origin}/${slug}/p`) ?? `${origin}/${slug}/p`;
    if (seen.has(productUrl)) continue;
    seen.add(productUrl);
    items.push({
      name: decodeJsonString(names[i]!),
      priceRaw: prices[i]!,
      shippingHint: shippingHintOf(content),
      store: storeOf(pageUrl),
      url: productUrl,
      image: images[i] ?? extractImage(content, pageUrl),
      depth: 0,
      sourceUrl: normalizeUrl(pageUrl) ?? pageUrl,
    });
  }
  return items;
}

/**
 * Legacy VTEX shelf: <li>…<a title href=…/p>…<em class="BestPrice">$ x
 * Frávega shelves skipped — need catalog itemId (§V22).
 */
function shelfItems(pageUrl: string, content: string): RawItem[] {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    if (isFravegaHost(host)) return [];
  } catch {
    return [];
  }
  const blocks = content.split(/<li\b[^>]*>/i).slice(1);
  const items: RawItem[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const link =
      /\bhref="((?:https?:\/\/[^"]+)?\/[^"]+-\d{5,}\/p)"/i.exec(block) ??
      /\bhref="((?:https?:\/\/[^"]+)?\/[^"]+\/p)"/i.exec(block);
    if (link === null) continue;
    const abs = absoluteUrl(pageUrl, link[1]!);
    if (abs === null) continue;
    const productUrl = normalizeUrl(abs) ?? abs;
    if (seen.has(productUrl)) continue;
    // Skip category listing pages that end with /brand?PS=
    if (/[?&]PS=/i.test(productUrl) || !/\/p(?:\?|$)/i.test(productUrl)) continue;

    const titleM = /\btitle="([^"]{4,160})"/i.exec(block);
    const name = titleM?.[1]?.trim();
    if (!name || /^producto$/i.test(name)) continue;

    const best = /class="BestPrice"[^>]*>\s*\$?\s*([\d][\d.\s]*)/i.exec(block);
    const list = /class="ListPrice"[^>]*>\s*\$?\s*([\d][\d.\s]*)/i.exec(block);
    const priceRaw = (best?.[1] ?? list?.[1] ?? '').replace(/\s+/g, '');
    if (!priceRaw) continue;

    const imgM = /<img[^>]+src="(https?:[^"]+)"/i.exec(block);

    seen.add(productUrl);
    items.push({
      name,
      priceRaw,
      shippingHint: shippingHintOf(block) || shippingHintOf(content),
      store: storeOf(pageUrl),
      url: productUrl,
      image: imgM?.[1] ?? extractImage(block, pageUrl),
      depth: 0,
      sourceUrl: normalizeUrl(pageUrl) ?? pageUrl,
    });
    if (items.length >= 20) break;
  }
  return items;
}

export function parsePage(url: string, content: string, _params: SearchParams): ExtractResult {
  if (isChallengePage(content)) return { results: [], links: [] };

  const fromJson = vtexJsonItems(url, content);
  const fromShelf = fromJson.length > 0 ? [] : shelfItems(url, content);
  const results = fromJson.length > 0 ? fromJson : fromShelf;

  const links = [
    ...results.map((r) => r.url),
    ...collectLinks(url, content).filter((l) => /\/[^/]+-\d{5,}\/p(?:\?|$)/i.test(l)),
  ];
  return { results, links: [...new Set(links)] };
}

export function looksLikeVtex(host: string, content: string): boolean {
  if (/"productName"\s*:/.test(content)) return true;
  if (/vtex|io\.vtexassets|vteximg|shelf-resultado|prodPrice/i.test(content)) return true;
  return /farmacity|pigmento|juleriaque|fravega|musimundo|falabella|watcom|garbarino|cetrogar|compragamer/i.test(host);
}
