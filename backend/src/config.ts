/**
 * App configuration, parsed once from environment variables.
 * Every variable has a safe default; garbage values fall back to the default.
 */

export interface AppConfig {
  port: number;
  host: string;
  stealth: boolean;
  maxDepth: number;
  maxNodes: number;
  maxResults: number;
  concurrency: number;
  userAgent: string;
  /** scrapling (primary) | legacy (Node BFS) | auto (scrapling then legacy) */
  crawler: 'scrapling' | 'legacy' | 'auto';
  scraplingUrl: string;
  includeMl: boolean;
  /** Comma-separated browser origins allowed by CORS (empty = reflect all, dev-friendly). */
  corsOrigins: string[];
  /** Caché de resultados rankeados (TTL + SWR, Fase 1). */
  cacheTtlMs: number;
  /** Ruta del archivo SQLite de jobs persistidos (Fase 3); vacío = en-memoria. */
  jobsDbPath: string;
}

function intFromEnv(name: string, fallback: number, min?: number, max?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function crawlerFromEnv(): 'scrapling' | 'legacy' | 'auto' {
  const raw = (process.env.CRAWLER ?? 'auto').trim().toLowerCase();
  if (raw === 'scrapling' || raw === 'legacy' || raw === 'auto') return raw;
  return 'auto';
}

function corsOriginsFromEnv(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw === undefined || raw === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const config: AppConfig = {
  port: intFromEnv('PORT', 4000, 1, 65_535),
  host: process.env.HOST?.trim() || '0.0.0.0',
  stealth: boolFromEnv('STEALTH', false),
  maxDepth: intFromEnv('MAX_DEPTH', 2, 0, 4),
  maxNodes: intFromEnv('MAX_NODES', 120, 1, 10_000),
  maxResults: intFromEnv('MAX_RESULTS', 25, 1, 100),
  concurrency: intFromEnv('CONCURRENCY', 4, 1, 8),
  userAgent: process.env.USER_AGENT?.trim() || DEFAULT_UA,
  crawler: crawlerFromEnv(),
  scraplingUrl: process.env.SCRAPLING_URL?.trim() || 'http://127.0.0.1:4100',
  includeMl: boolFromEnv('INCLUDE_ML', false),
  corsOrigins: corsOriginsFromEnv(),
  cacheTtlMs: intFromEnv('CACHE_TTL_MS', 15 * 60_000, 1_000, 24 * 60 * 60_000),
  jobsDbPath: process.env.JOBS_DB?.trim() || '',
};
