/**
 * MercadoLibre public JSON search — when reachable (often 403 from datacenter).
 * Parses API payloads into RawItems so we skip HTML challenge pages.
 */

import type { SearchParams } from '../../../../shared/contract.ts';
import { normalizeUrl } from '../../normalize/url.ts';
import type { ExtractResult, RawItem } from '../types.ts';

interface MlResult {
  id?: string;
  title?: string;
  price?: number;
  permalink?: string;
  thumbnail?: string;
  shipping?: { free_shipping?: boolean; logistic_type?: string; mode?: string };
  seller?: { nickname?: string };
}

interface MlSearchPayload {
  results?: MlResult[];
}

export function isMercadoLibreApiUrl(url: string): boolean {
  try {
    return /api\.mercadolibre\.com/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function parseMercadoLibreApi(url: string, body: string, _params: SearchParams): ExtractResult {
  let data: MlSearchPayload;
  try {
    data = JSON.parse(body) as MlSearchPayload;
  } catch {
    return { results: [], links: [] };
  }
  if (data.results === undefined || !Array.isArray(data.results)) {
    return { results: [], links: [] };
  }

  const results: RawItem[] = [];
  const links: string[] = [];
  for (const item of data.results.slice(0, 25)) {
    if (typeof item.title !== 'string' || typeof item.price !== 'number' || item.price <= 0) continue;
    const permalink = typeof item.permalink === 'string' ? item.permalink : null;
    if (permalink === null) continue;
    const norm = normalizeUrl(permalink) ?? permalink;
    const free = Boolean(item.shipping?.free_shipping);
    const logistic = item.shipping?.logistic_type ?? item.shipping?.mode ?? '';
    const shippingHint = free
      ? 'Envío gratis Mercado Envíos'
      : /fulfillment|xd_drop_off|cross_docking/i.test(logistic)
        ? 'Mercado Envíos'
        : 'Envío a todo el país Mercado Envíos';

    results.push({
      name: item.title.trim(),
      priceRaw: String(item.price),
      shippingHint,
      store: {
        name: item.seller?.nickname ? `ML · ${item.seller.nickname}` : 'MercadoLibre',
        logo: null,
        local: true,
        siteUrl: 'https://www.mercadolibre.com.ar',
      },
      url: norm,
      image: typeof item.thumbnail === 'string' ? item.thumbnail.replace(/^http:/, 'https:') : null,
      depth: 0,
      sourceUrl: url,
    });
    links.push(norm);
  }
  return { results, links: [...new Set(links)] };
}
