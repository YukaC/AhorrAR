import { describe, expect, it } from 'vitest';
import { isSearchProgress, isSearchResultJob } from './client';

const DONE_JOB = {
  searchId: 'xp8RTK1s',
  status: 'done',
  params: { product: 'zapatilla', country: 'MX', maxDepth: 2, maxResults: 10 },
  createdAt: '2026-09-20T18:36:00.318Z',
  progress: {
    searchId: 'xp8RTK1s',
    status: 'done',
    depth: 2,
    nodesVisited: 27,
    resultsFound: 6,
    message: 'Búsqueda completada',
  },
  result: {
    query: { product: 'zapatilla', country: 'MX', maxDepth: 2, maxResults: 10 },
    generatedAt: '2026-09-20T18:36:00.335Z',
    event: {
      activeToday: false,
      nextEvent: { name: 'El Buen Fin', date: '2026-11-20', daysLeft: 61 },
    },
    results: [
      {
        rank: 1,
        name: 'Zapatilla 128GB',
        price: 1670.03,
        currency: 'MXN',
        store: {
          name: 'Amazon MX',
          logo: null,
          local: true,
          siteUrl: 'https://www.amazon.com.mx',
        },
        url: 'https://www.amazon.com.mx/p/zapatilla-3484519840-1',
        image: null,
        shipping: {
          confirmed: true,
          country: 'MX',
          type: 'local',
          free: true,
          note: 'Envío confirmado al país destino',
        },
        depth: 1,
        sourceUrl: 'https://listado.mercadolibre.com.mx/zapatilla',
      },
    ],
    stats: {
      source: 'live',
      nodesVisited: 27,
      linksQueued: 52,
      pagesFetched: 24,
      maxDepthReached: 2,
      skippedNoShipping: 0,
      skippedDedupe: 4,
      elapsedMs: 137,
    },
    message: 'Búsqueda live completada.',
  },
  error: null,
};

describe('isSearchResultJob (V9: guard accepts real server payload)', () => {
  it('V9 — accepts a done job exactly as the backend returns it (error: null)', () => {
    expect(isSearchResultJob(DONE_JOB)).toBe(true);
  });

  it('V9 — accepts queued/running jobs (no result, error null)', () => {
    const running = { ...DONE_JOB, status: 'running', result: undefined, error: null };
    expect(isSearchResultJob(running)).toBe(true);
    const queued = { ...DONE_JOB, status: 'queued', result: undefined, error: null };
    expect(isSearchResultJob(queued)).toBe(true);
  });

  it('V9 — accepts a real error string', () => {
    const failed = { ...DONE_JOB, status: 'error', result: undefined, error: 'boom' };
    expect(isSearchResultJob(failed)).toBe(true);
  });

  it('V9/V10 — rejects a non-null, non-string error', () => {
    const broken = { ...DONE_JOB, error: 42 };
    expect(isSearchResultJob(broken)).toBe(false);
  });

  it('V10 — rejects result: null on the wire (optional keys must be absent, never null)', () => {
    const wireNull = { ...DONE_JOB, status: 'running', result: null };
    expect(isSearchResultJob(wireNull)).toBe(false);
  });
});

describe('isSearchProgress', () => {
  it('accepts SSE progress frames', () => {
    expect(isSearchProgress(DONE_JOB.progress)).toBe(true);
  });
});