import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobsDb } from '../src/persistence/jobs-db.ts';
import { JobStore } from '../src/jobs.ts';

const dirs: string[] = [];

function tempDb(): JobsDb {
  const dir = mkdtempSync(join(tmpdir(), 'ahorrar-jobs-'));
  dirs.push(dir);
  return new JobsDb(join(dir, 'jobs.sqlite'));
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('JobsDb (§V20)', () => {
  it('upsert + list roundtrip de un job completo', () => {
    const db = tempDb();
    const job = {
      searchId: 'abc123',
      params: { product: 'perfume', country: 'AR', maxResults: 5 },
      status: 'done' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      progress: { searchId: 'abc123', status: 'done' as const, depth: 1, nodesVisited: 5, resultsFound: 2, results: [] },
      error: null,
    };
    db.upsert(job);
    const [loaded] = db.list();
    expect(loaded).toEqual(job);
  });

  it('upsert overwrites la misma search_id', () => {
    const db = tempDb();
    db.upsert({
      searchId: 'x',
      params: { product: 'a', country: 'AR' },
      status: 'queued',
      createdAt: '2026-01-01T00:00:00.000Z',
      progress: { searchId: 'x', status: 'queued', depth: 0, nodesVisited: 0, resultsFound: 0 },
    });
    db.upsert({
      searchId: 'x',
      params: { product: 'a', country: 'AR' },
      status: 'error',
      createdAt: '2026-01-01T00:00:00.000Z',
      progress: { searchId: 'x', status: 'error', depth: 0, nodesVisited: 0, resultsFound: 0 },
      error: 'boom',
    });
    const [loaded] = db.list();
    expect(loaded.status).toBe('error');
    expect(loaded.error).toBe('boom');
    expect(db.list()).toHaveLength(1);
  });

  it('remove borra la fila', () => {
    const db = tempDb();
    db.upsert({
      searchId: 'x',
      params: { product: 'a', country: 'AR' },
      status: 'queued',
      createdAt: '2026-01-01T00:00:00.000Z',
      progress: { searchId: 'x', status: 'queued', depth: 0, nodesVisited: 0, resultsFound: 0 },
    });
    db.remove('x');
    expect(db.list()).toEqual([]);
  });

  it('sobrevive un reopen (persistencia real en disco)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahorrar-jobs-'));
    dirs.push(dir);
    const path = join(dir, 'jobs.sqlite');
    const db1 = new JobsDb(path);
    db1.upsert({
      searchId: 'persisted',
      params: { product: 'b', country: 'AR' },
      status: 'done',
      createdAt: '2026-01-01T00:00:00.000Z',
      progress: { searchId: 'persisted', status: 'done', depth: 0, nodesVisited: 0, resultsFound: 0 },
    });
    db1.close();

    const db2 = new JobsDb(path);
    expect(db2.list()).toHaveLength(1);
    expect(db2.list()[0]!.searchId).toBe('persisted');
    db2.close();
  });
});

describe('JobStore.attachDb (§V20)', () => {
  it('restaura jobs preexistentes al attach', () => {
    const db = tempDb();
    db.upsert({
      searchId: 'oldjob',
      params: { product: 'tele', country: 'AR' },
      status: 'done',
      createdAt: '2026-01-01T00:00:00.000Z',
      progress: { searchId: 'oldjob', status: 'done', depth: 0, nodesVisited: 0, resultsFound: 0 },
    });

    const store = new JobStore();
    store.attachDb(db);
    expect(store.get('oldjob')?.status).toBe('done');
    store.dispose();
  });

  it('persiste create y complete, y el snapshot sobrevive un restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahorrar-jobs-'));
    dirs.push(dir);
    const path = join(dir, 'jobs.sqlite');
    const db1 = new JobsDb(path);
    const store1 = new JobStore();
    store1.attachDb(db1);
    const job = store1.create({ product: 'zapatilla', country: 'AR', maxResults: 3 });
    store1.updateProgress(job.searchId, { status: 'running', resultsFound: 1 });
    store1.fail(job.searchId, 'red caída');
    store1.dispose();

    const db2 = new JobsDb(path);
    const store2 = new JobStore();
    store2.attachDb(db2);
    const restored = store2.get(job.searchId)!;
    expect(restored.status).toBe('error');
    expect(restored.error).toBe('red caída');
    expect(restored.progress.status).toBe('error');
    store2.dispose();
  });

  it('sweep purga también de SQLite', () => {
    const db = tempDb();
    const store = new JobStore();
    store.attachDb(db);
    const stale = store.create({ product: 'viejito', country: 'AR' });
    // Envejecer el job para que el sweep lo considere expirado.
    const job = store.get(stale.searchId)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job as any).createdAt = new Date(Date.now() - 60 * 60_000).toISOString();
    (store as unknown as { sweep(): void }).sweep();
    expect(store.get(stale.searchId)).toBeUndefined();
    expect(db.list()).toHaveLength(0);
    store.dispose();
  });
});