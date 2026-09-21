/**
 * VTEX catalog_system JSON API — HTTP-fast product search without rendering.
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';

interface VtexProduct {
  productName?: string;
  linkText?: string;
  link?: string;
  items?: Array<{
    images?: Array<{ imageUrl?: string }>;
    sellers?: Array<{
      commertialOffer?: { Price?: number; ListPrice?: number; AvailableQuantity?: number };
    }>;
  }>;
}

export function isVtexCatalogApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/api\/catalog_system\/pub\/products\/search/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function parseVtexCatalogApi(url: string, body: string, _params: SearchParams): ExtractResult {
  let products: VtexProduct[];
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) return { results: [], links: [] };
    products = parsed as VtexProduct[];
  } catch {
    return { results: [], links: [] };
  }

  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    return { results: [], links: [] };
  }

  const storeHost = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'Tienda AR';
    }
  })();

  const results: RawItem[] = [];
  const links: string[] = [];
  const seen = new Set<string>();

  for (const product of products.slice(0, 25)) {
    const name = product.productName?.trim();
    if (!name || name.length < 4) continue;
    const item = product.items?.[0];
    const offer = item?.sellers?.[0]?.commertialOffer;
    const price = offer?.Price ?? offer?.ListPrice;
    if (typeof price !== 'number' || price <= 0) continue;
    if (typeof offer?.AvailableQuantity === 'number' && offer.AvailableQuantity <= 0) continue;

    const slug = product.linkText;
    const productUrl =
      (typeof product.link === 'string' && product.link.startsWith('http')
        ? product.link
        : slug
          ? `${origin}/${slug}/p`
          : null) ?? null;
    if (productUrl === null) continue;
    const norm = normalizeUrl(productUrl) ?? productUrl;
    if (seen.has(norm)) continue;
    seen.add(norm);

    const image = item?.images?.[0]?.imageUrl ?? null;
    results.push({
      name,
      priceRaw: String(price),
      shippingHint: 'Envío a domicilio',
      store: { name: storeHost, logo: null, local: true, siteUrl: origin },
      url: norm,
      image,
      depth: 0,
      sourceUrl: url,
    });
    links.push(norm);
  }

  return { results, links: [...new Set(links)] };
}
