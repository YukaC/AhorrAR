import type {
  CountryCode,
  SearchParams,
  SearchProgress,
  SearchResponse,
  SearchResultJob,
  SearchStatus,
} from '../../../shared/contract';
import { isCountryCode, isSearchResponse } from '../../../shared/contract';

/* ------------------------------------------------------------------ */
/* Error model                                                        */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Runtime shape guards (API responses validated against contract)     */
/* ------------------------------------------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Production: set VITE_API_BASE (e.g. https://api.example.com). Dev: empty → same origin / Vite proxy. */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

const SEARCH_STATUSES: SearchStatus[] = ['queued', 'running', 'done', 'error'];

export function isSearchProgress(v: unknown): v is SearchProgress {
  if (!isRecord(v)) return false;
  if (typeof v.searchId !== 'string') return false;
  if (typeof v.status !== 'string' || !(SEARCH_STATUSES as string[]).includes(v.status)) return false;
  if (typeof v.depth !== 'number') return false;
  if (typeof v.nodesVisited !== 'number') return false;
  if (typeof v.resultsFound !== 'number') return false;
  return true;
}

function isSearchParams(v: unknown): v is SearchParams {
  if (!isRecord(v)) return false;
  if (typeof v.product !== 'string' || v.product.length === 0) return false;
  if (!isCountryCode(v.country)) return false;
  if (v.maxDepth !== undefined && typeof v.maxDepth !== 'number') return false;
  if (v.maxResults !== undefined && typeof v.maxResults !== 'number') return false;
  return true;
}

function isSearchResultJob(v: unknown): v is SearchResultJob {
  if (!isRecord(v)) return false;
  if (typeof v.searchId !== 'string') return false;
  if (typeof v.status !== 'string' || !(SEARCH_STATUSES as string[]).includes(v.status)) return false;
  if (!isSearchParams(v.params)) return false;
  if (typeof v.createdAt !== 'string') return false;
  if (!isSearchProgress(v.progress)) return false;
  if (v.result !== undefined && !isSearchResponse(v.result)) return false;
  if (v.error !== undefined && v.error !== null && typeof v.error !== 'string') return false;
  return true;
}

function isCreated(v: unknown): v is { searchId: string; status: SearchStatus; params: SearchParams } {
  if (!isRecord(v)) return false;
  if (typeof v.searchId !== 'string' || v.searchId.length === 0) return false;
  if (typeof v.status !== 'string' || !(SEARCH_STATUSES as string[]).includes(v.status)) return false;
  if (!isSearchParams(v.params)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

async function readMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (isRecord(data) && typeof data.error === 'string' && data.error.length > 0) return data.error;
    if (isRecord(data) && typeof data.message === 'string' && data.message.length > 0) return data.message;
  } catch {
    /* body no era JSON */
  }
  return `El servidor respondió con estado ${res.status}.`;
}

async function request<T>(url: string, init: RequestInit, guard: (v: unknown) => v is T): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'No se pudo conectar con el servidor (¿está corriendo en :4000?).');
  }
  if (!res.ok) throw new ApiError(res.status, await readMessage(res));
  const data: unknown = await res.json().catch(() => undefined);
  if (!guard(data)) {
    throw new ApiError(502, 'La respuesta del servidor no coincide con el contrato (V8).');
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function createSearch(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<{ searchId: string; status: SearchStatus; params: SearchParams }> {
  return request(
    apiUrl('/api/search'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    },
    isCreated,
  );
}

export function getJob(searchId: string, signal?: AbortSignal): Promise<SearchResultJob> {
  return request(apiUrl(`/api/search/${encodeURIComponent(searchId)}`), { signal }, isSearchResultJob);
}

export interface EventsSub {
  close: () => void;
}

/**
 * Live progress via SSE. Best-effort: the poll loop over getJob is the
 * source of truth; this stream only feeds the LoadingState readout.
 */
export function subscribeToEvents(searchId: string, onProgress: (p: SearchProgress) => void): EventsSub {
  const source = new EventSource(apiUrl(`/api/search/${encodeURIComponent(searchId)}/events`));
  source.onmessage = (event) => {
    let data: unknown;
    try {
      data = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }
    if (isSearchProgress(data) && data.searchId === searchId) onProgress(data);
  };
  source.onerror = () => source.close();
  return { close: () => source.close() };
}

export type CountryOption = CountryCode;
export { isCountryCode, isSearchResultJob };
export type { SearchParams, SearchProgress, SearchResponse, SearchResultJob, SearchStatus, CountryCode };