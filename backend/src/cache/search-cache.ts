/**
 * Resultado rankeado ya cacheado, TTL corto + stale-while-revalidate (§V21).
 * Key normalizada: minúsculas, sin tildes, sin puntuación, palabras ordenadas
 * (el orden de palabras no cambia el producto). Storage in-memory (una instancia).
 */

import type { SearchResponse } from '../../../shared/contract.ts';

export interface CacheEntry {
  data: SearchResponse;
  ts: number;
}

export function normalizeQueryKey(q: string): string {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // saca tildes
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Cache key includes result cap so "mostrar más" (25→50→100) does not reuse a smaller hit (§V17/V21). */
export function cacheKeyFor(product: string, maxResults: number): string {
  return `${normalizeQueryKey(product)}:n${maxResults}`;
}

export class SearchCache {
  private readonly entries = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): CacheEntry | undefined {
    // SWR: una entrada vencida sigue disponible para servir (stale); el runner
    // decide con isFresh() si además dispara un refresh en background.
    return this.entries.get(key);
  }

  setTtl(ms: number): void {
    if (ms > 0) this.ttlMs = ms;
  }

  set(key: string, data: SearchResponse): void {
    this.entries.set(key, { data, ts: Date.now() });
  }

  /** Fresh si no venció el TTL; el runner usa esto para SWR. */
  isFresh(entry: CacheEntry, now: number = Date.now()): boolean {
    return now - entry.ts <= this.ttlMs;
  }

  /** Borra solo una clave (Fase 1: invalidación por TTL, expuesta para refresh manual). */
  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}