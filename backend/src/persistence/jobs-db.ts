/**
 * Persistencia de jobs en SQLite (Fase 3, §V20).
 * `node:sqlite` DatabaseSync: tabla jobs keyed by searchId, JSON columns para
 * params/progress/result/error. Usado de forma transversal del JobStore:
 * los jobs sobreviven un restart del backend y el frontend puede re-conectarse
 * (SSE resume) al mismo searchId.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SearchParams, SearchProgress, SearchResponse, SearchStatus } from '../../../shared/contract.ts';

export interface PersistedJob {
  searchId: string;
  params: SearchParams;
  status: SearchStatus;
  createdAt: string;
  progress: SearchProgress;
  result?: SearchResponse;
  error?: string | null;
}

export class JobsDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        search_id TEXT PRIMARY KEY,
        params TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        progress TEXT NOT NULL,
        result TEXT,
        error TEXT
      );
    `);
  }

  upsert(job: PersistedJob): void {
    this.db
      .prepare(
        `INSERT INTO jobs(search_id, params, status, created_at, progress, result, error)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(search_id) DO UPDATE SET
           status = excluded.status,
           progress = excluded.progress,
           result = excluded.result,
           error = excluded.error`,
      )
      .run(
        job.searchId,
        JSON.stringify(job.params),
        job.status,
        job.createdAt,
        JSON.stringify(job.progress),
        job.result !== undefined ? JSON.stringify(job.result) : null,
        job.error ?? null,
      );
  }

  remove(searchId: string): void {
    this.db.prepare('DELETE FROM jobs WHERE search_id = ?').run(searchId);
  }

  list(): PersistedJob[] {
    const rows = this.db.prepare('SELECT * FROM jobs').all() as unknown as Array<{
      search_id: string;
      params: string;
      status: string;
      created_at: string;
      progress: string;
      result: string | null;
      error: string | null;
    }>;
    return rows.map((r) => ({
      searchId: r.search_id,
      params: JSON.parse(r.params) as SearchParams,
      status: r.status as SearchStatus,
      createdAt: r.created_at,
      progress: JSON.parse(r.progress) as SearchProgress,
      result: r.result !== null ? (JSON.parse(r.result) as SearchResponse) : undefined,
      error: r.error,
    }));
  }

  close(): void {
    this.db.close();
  }
}