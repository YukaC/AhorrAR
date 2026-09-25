/**
 * VTEX catalog_system JSON API — HTTP-fast product search without rendering.
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';

interface VtexProduct {
  productId?: string;
  productName?: string;
  linkText?: string;
  link?: string;
  items?: Array<{
    itemId?: string;
    images?: Array<{ imageUrl?: string }>;
    sellers?: Array<{
      sellerId?: string;
      commertialOffer?: { Price?: number; ListPrice?: number; AvailableQuantity?: number };
    }>;
  }>;
}

function isFravegaHost(host: string): boolean {
  const h = host.replace(/^www\./, '').toLowerCase();
  return h === 'fravega.com' || h.endsWith('.fravega.com');
}

/**
 * Frávega Next PDP: `/p/{slug}-{itemId}/`.
 * GraphQL `sku(code:)` resolves VTEX **itemId**; trailing **productId** (legacy
 * `link`/`linkText`) yields an empty shell. Keep double-hyphens; only swap the id.
 */
export function fravegaPdpUrl(
  origin: string,
  opts: { linkText?: string; productId?: string; itemId?: string },
): string | null {
  const itemId = opts.itemId?.trim();
  if (!itemId) return null;
  let slug = (opts.linkText ?? '').trim().replace(/^\/+|\/+$/g, '');
  const productId = opts.productId?.trim() ?? '';
  if (productId && slug.endsWith(`-${productId}`)) {
    slug = `${slug.slice(0, -(productId.length + 1))}-${itemId}`;
  } else if (slug.endsWith(`-${itemId}`)) {
    // already storefront form
  } else if (slug) {
    slug = `${slug}-${itemId}`;
  } else {
    return null;
  }
  const raw = `${origin.replace(/\/$/, '')}/p/${slug}/`;
  return normalizeUrl(raw) ?? raw;
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
    let productUrl: string | null = null;
    if (isFravegaHost(storeHost)) {
      productUrl = fravegaPdpUrl(origin, {
        linkText: slug,
        productId: product.productId,
        itemId: item?.itemId,
      });
    } else if (typeof product.link === 'string' && product.link.startsWith('http')) {
      productUrl = product.link;
    } else if (slug) {
      productUrl = `${origin}/${slug}/p`;
    }
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
