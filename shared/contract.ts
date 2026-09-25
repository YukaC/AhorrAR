/**
 * AhorrAR — shared API contract.
 * Single source of truth for the JSON exchanged between backend and frontend.
 * Pure type + runtime-shape module. No external deps, no enums (Node type-stripping).
 */

export type CountryCode = 'AR' | 'MX' | 'ES';

export const COUNTRY_CODES: readonly CountryCode[] = ['AR', 'MX', 'ES'];

export interface CountryConfig {
  code: CountryCode;
  name: string;
  flag: string;
  currency: string;
  locale: string;
  ccTLD: string;
  domains: string[];
  marketplaces: string[];
  description: string;
}

export interface SearchParams {
  product: string;
  country: CountryCode;
  maxDepth?: number;
  maxResults?: number;
}

export type SearchStatus = 'queued' | 'running' | 'done' | 'error';

export interface SearchProgress {
  searchId: string;
  status: SearchStatus;
  depth: number;
  nodesVisited: number;
  resultsFound: number;
  message?: string;
  /** Parciales en vivo (SSE streaming, §V16). Solo presente mientras corre el job. */
  results?: ProductResult[];
}

export interface ShippingInfo {
  confirmed: boolean;
  country: CountryCode;
  type: 'local' | 'international';
  free?: boolean;
  eta?: string;
  note?: string;
}

export interface InstallmentsInfo {
  count: number;
  interestFree: boolean;
  note?: string;
}

export interface ProductResult {
  rank: number;
  name: string;
  price: number;
  currency: string;
  store: {
    name: string;
    logo?: string | null;
    local: boolean;
    siteUrl: string;
  };
  url: string;
  image?: string | null;
  shipping: ShippingInfo;
  /** Cuotas — solo presente cuando la fuente lo expone (VTEX, §V18). */
  installments?: InstallmentsInfo | null;
  depth: number;
  sourceUrl: string;
}

export interface EventPeriod {
  name: string;
  start: string;
  end: string;
}

export interface EventInfo {
  activeToday: boolean;
  eventToday?: {
    name: string;
    date: string;
    endDate?: string;
    description?: string;
  };
  season?: EventPeriod;
  nextEvent: {
    name: string;
    date: string;
    daysLeft: number;
  };
}

export interface SearchStats {
  source: 'live';
  nodesVisited: number;
  linksQueued: number;
  pagesFetched: number;
  maxDepthReached: number;
  skippedNoShipping: number;
  skippedDedupe: number;
  elapsedMs: number;
}

export interface SearchResultJob {
  searchId: string;
  status: SearchStatus;
  params: SearchParams;
  createdAt: string;
  progress: SearchProgress;
  result?: SearchResponse;
  error?: string;
}

export interface SearchResponse {
  query: SearchParams;
  generatedAt: string;
  event: EventInfo;
  results: ProductResult[];
  stats: SearchStats;
  message?: string;
}

/* -------------------------------------------------------------------------- */
/* Runtime shape validator (used by backend to enforce §V8 and by tests).      */
/* -------------------------------------------------------------------------- */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isCountryCode = (v: unknown): v is CountryCode =>
  typeof v === 'string' && (COUNTRY_CODES as readonly string[]).includes(v);

export function isSearchResponse(v: unknown): v is SearchResponse {
  if (!isObject(v)) return false;
  if (!isObject(v.query)) return false;
  if (!isCountryCode(v.query.country)) return false;
  if (typeof v.query.product !== 'string' || v.query.product.length === 0) return false;
  if (typeof v.generatedAt !== 'string') return false;
  if (!isObject(v.event)) return false;
  if (!isObject(v.event.nextEvent)) return false;
  if (typeof v.event.nextEvent.name !== 'string') return false;
  if (typeof v.event.nextEvent.daysLeft !== 'number') return false;
  if (!Array.isArray(v.results)) return false;
  for (const r of v.results) {
    if (!isProductResult(r)) return false;
  }
  if (!isObject(v.stats)) return false;
  if (v.stats.source !== 'live') return false;
  return true;
}

export function isProductResult(v: unknown): v is ProductResult {
  if (!isObject(v)) return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.price !== 'number' || !(v.price > 0)) return false; // §V2
  if (typeof v.currency !== 'string' || v.currency.length !== 3) return false;
  if (!isObject(v.store)) return false;
  if (typeof v.store.name !== 'string') return false;
  if (typeof v.store.local !== 'boolean') return false;
  if (typeof v.url !== 'string' || v.url.length === 0) return false;
  if (!isShippingInfo(v.shipping)) return false;
  return true;
}

export function isShippingInfo(v: unknown): v is ShippingInfo {
  if (!isObject(v)) return false;
  if (v.confirmed !== true) return false; // §V1
  if (!isCountryCode(v.country)) return false;
  if (v.type !== 'local' && v.type !== 'international') return false;
  return true;
}