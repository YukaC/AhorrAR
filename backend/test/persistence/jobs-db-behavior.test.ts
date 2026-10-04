import { describe, it, expect } from 'vitest';
import { JobsDb } from '../../src/persistence/jobs-db.ts';

describe('JobsDb SQLite behavior', () => {
  it('returns at most 500 most recent jobs ordered by created_at DESC', () => {
    const jobsDb = new JobsDb(':memory:');

    // Insert 600 jobs with increasing timestamps
    for (let i = 0; i < 600; i++) {
      const pad = String(i).padStart(4, '0');
      jobsDb.upsert({
        searchId: `id_${pad}`,
        params: { product: `product_${pad}`, country: 'AR' },
        status: 'done',
        createdAt: `2026-10-04T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
        progress: { status: 'done' },
      });
    }

    const list = jobsDb.list();

    // Verify limit is enforced (500 items)
    expect(list.length).toBe(500);

    // Verify deterministic ORDER BY created_at DESC (newest first)
    expect(list[0].searchId).toBe('id_0599');
    expect(list[499].searchId).toBe('id_0100');

    jobsDb.close();
  });
});
