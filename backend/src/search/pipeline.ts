/**
 * Result pipeline shared by the live crawler (§C: DRY).
 * A raw parsed item flows through: price normalize → shipping validate (§V1)
 * → contract-shape ProductResult.
 */

import type {
  CountryConfig,
  EventInfo,
  ProductResult,
  SearchParams,
  SearchResponse,
  SearchStats,
} from '../../../shared/contract.ts';
import { normalizePrice } from '../normalize/price.ts';
import { normalizeUrl } from '../normalize/url.ts';
import { validateShipping } from '../shipping/shipping.ts';
import { isRelevantResult } from './relevance.ts';
import type { RawItem } from './types.ts';

export function finalizeRawItem(raw: RawItem, params: SearchParams, country: CountryConfig): ProductResult | null {
  if (!isRelevantResult(raw.name, params.product)) return null;

  const price = normalizePrice(raw.priceRaw, country);
  if (price === null) return null;

  const shipping = validateShipping(country, raw.shippingHint ?? '', raw.store.local);
  // §V1: non-negotiable filter — anything unconfirmed is discarded here.
  if (!shipping.confirmed) return null;
  // Señal estructurada (VTEX ShippingSLA / ML free_shipping) gana sobre el regex del hint.
  if (raw.shippingFree !== undefined) shipping.free = raw.shippingFree;

  const url = normalizeUrl(raw.url);
  if (url === null) return null;

  return {
    rank: 0,
    name: raw.name.trim(),
    price,
    currency: country.currency, // (§V2) currency-force: always destination country
    store: raw.store,
    url,
    image: raw.image ?? null,
    shipping,
    installments: raw.installments ?? null,
    depth: raw.depth,
    sourceUrl: normalizeUrl(raw.sourceUrl) ?? raw.sourceUrl,
  };
}

export interface ResponseParts {
  params: SearchParams;
  results: ProductResult[];
  event: EventInfo;
  stats: SearchStats;
  message?: string;
}

export function buildResponse(parts: ResponseParts): SearchResponse {
  const resp: SearchResponse = {
    query: parts.params,
    generatedAt: new Date().toISOString(),
    event: parts.event,
    results: parts.results,
    stats: parts.stats,
  };
  if (parts.message !== undefined) resp.message = parts.message;
  return resp;
}