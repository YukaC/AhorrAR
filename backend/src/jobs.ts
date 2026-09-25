/**
 * In-memory job store with TTL cleanup and progress event fan-out (SSE).
 * Lifecycle: queued → running → done | error.
 */

import type { SearchParams, SearchProgress, SearchResponse, SearchStatus, ProductResult } from '../../shared/contract.ts';
import type { AppConfig } from './config.ts';
import { cacheKeyFor, SearchCache } from './cache/search-cache.ts';
import { JobsDb } from './persistence/jobs-db.ts';
import { runLiveSearch } from './search/service.ts';
import type { CrawlDeps } from './search/types.ts';
import { logger } from './utils/logger.ts';
import { shortId } from './utils/ids.ts';

export interface JobRecord {
  searchId: string;
  params: SearchParams;
  status: SearchStatus;
  createdAt: string;
  progress: SearchProgress;
  result?: SearchResponse;
  error?: string | null;
}

type ProgressListener = (progress: SearchProgress) => void;

const TTL_MS = 30 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly listeners = new Map<string, Set<ProgressListener>>();
  private readonly sweepTimer: NodeJS.Timeout;
  private db: JobsDb | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweepTimer.unref();
  }

  /** Activa persistencia SQLite (§V20): restaura los jobs del disco al arranque. */
  attachDb(db: JobsDb | null): void {
    this.db = db;
    if (db === null) return;
    let restored = 0;
    for (const persisted of db.list()) {
      const job: JobRecord = { ...persisted };
      this.jobs.set(job.searchId, job);
      restored++;
    }
    if (restored > 0) logger.info(`jobs restaurados de SQLite: ${restored}`);
  }

  create(params: SearchParams): JobRecord {
    const searchId = shortId();
    const job: JobRecord = {
      searchId,
      params,
      status: 'queued',
      createdAt: new Date().toISOString(),
      progress: { searchId, status: 'queued', depth: 0, nodesVisited: 0, resultsFound: 0 },
    };
    this.jobs.set(searchId, job);
    this.persist(job);
    return job;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  private persist(job: JobRecord): void {
    this.db?.upsert(job);
  }

  updateProgress(
    id: string,
    patch: { status?: SearchStatus; depth?: number; nodesVisited?: number; resultsFound?: number; message?: string; results?: ProductResult[] },
  ): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    job.progress = { ...job.progress, ...patch, status: patch.status ?? job.progress.status, searchId: id };
    if (patch.status !== undefined) job.status = patch.status;
    this.persist(job);
    this.emit(id, job.progress);
  }

  complete(id: string, result: SearchResponse): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    job.result = result;
    job.error = null;
    this.updateProgress(id, {
      status: 'done',
      depth: result.stats.maxDepthReached,
      nodesVisited: result.stats.nodesVisited,
      resultsFound: result.results.length,
      message: 'Búsqueda completada',
    });
  }

  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    job.error = error;
    this.updateProgress(id, { status: 'error', message: error });
  }

  /** Returns an unsubscribe function. */
  onProgress(id: string, listener: ProgressListener): () => void {
    let set = this.listeners.get(id);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  private emit(id: string, progress: SearchProgress): void {
    const set = this.listeners.get(id);
    if (set === undefined) return;
    for (const listener of set) listener(progress);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - Date.parse(job.createdAt) > TTL_MS) {
        this.jobs.delete(id);
        this.listeners.delete(id);
        this.db?.remove(id);
        logger.info(`job expirado y purgado: ${id}`);
      }
    }
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
    this.db?.close();
    this.db = null;
  }
}

export const jobStore = new JobStore();

/** Caché compartido de resultados rankeados (§V21); TTL se ajusta con cfg. */
export const searchCache = new SearchCache(
  15 * 60_000,
  Number.parseInt(process.env.CACHE_MAX_ENTRIES ?? '0', 10) || 0,
);

/* ------------------------------------------------------------------------ */
/* Executors — run off the event loop; SSE stays responsive.                */
/* ------------------------------------------------------------------------ */

/** Hermetic testing seam (⊥ red en tests): tests swap the runner for a stub. */
export type JobRunner = (id: string, cfg: AppConfig, deps?: Partial<CrawlDeps>) => Promise<void>;

let currentRunner: JobRunner = runLiveJob;

export function setJobRunner(runner: JobRunner): void {
  currentRunner = runner;
}

/** True while a hermetic runner is installed (tests). */
export function isLiveRunner(): boolean {
  return currentRunner === runLiveJob;
}

/** Refresh en background para SWR: repuebla el caché sin bloquear el job (ya sirvió stale). */
async function refreshCache(params: SearchParams, cfg: AppConfig, deps?: Partial<CrawlDeps>): Promise<void> {
  try {
    const response = await runLiveSearch(params, cfg, undefined, deps);
    searchCache.set(cacheKeyFor(params.product, params.maxResults ?? cfg.maxResults), response);
    logger.debug(`caché refrescada (SWR): ${params.product}`);
  } catch (err) {
    logger.warn(`refresh SWR falló (se mantiene stale): ${params.product} — ${toErrorMessage(err)}`);
  }
}

export async function runLiveJob(id: string, cfg: AppConfig, deps?: Partial<CrawlDeps>): Promise<void> {
  const job = jobStore.get(id);
  if (job === undefined) return;

  searchCache.setTtl(cfg.cacheTtlMs);
  const cacheKey = cacheKeyFor(job.params.product, job.params.maxResults ?? cfg.maxResults);
  const hit = searchCache.get(cacheKey);

  if (hit !== undefined) {
    // Hit fresca → respuesta al instante, sin tocar el crawler (§V21).
    if (searchCache.isFresh(hit)) {
      jobStore.complete(id, hit.data);
      logger.info(`caché hit (fresh): ${job.params.product}`);
      return;
    }
    // Hit vencida → SWR: sirve stale y refresca en background.
    jobStore.complete(id, hit.data);
    logger.info(`caché hit (stale, SWR): ${job.params.product}`);
    void refreshCache(job.params, cfg, deps);
    return;
  }

  jobStore.updateProgress(id, { status: 'running', message: 'Iniciando crawler en vivo' });
  const response = await runLiveSearch(
    job.params,
    cfg,
    (p) => jobStore.updateProgress(id, { depth: p.depth, nodesVisited: p.nodesVisited, resultsFound: p.resultsFound, message: p.message }),
    deps,
    (partial) => jobStore.updateProgress(id, { resultsFound: partial.length, results: partial }),
  );
  searchCache.set(cacheKey, response);
  jobStore.complete(id, response);
}

/** Runs the current job runner (live by default, stub in hermetic tests). */
export function executeJob(id: string, cfg: AppConfig): Promise<void> {
  return currentRunner(id, cfg);
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Error interno durante la búsqueda.';
}