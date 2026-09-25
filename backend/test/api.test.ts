import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { isSearchResponse, type SearchResponse } from '../../shared/contract.ts';
import { jobStore, runLiveJob, setJobRunner } from '../src/jobs.ts';
import { app } from '../src/server.ts';
import { LISTING_URL, fetchFixture } from './fixtures/live.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const base = '/api';

const fixtureDeps = { seedUrls: () => [LISTING_URL], fetch: fetchFixture };

async function pollUntilDone(searchId: string, timeoutMs = 4000): Promise<SearchResponse> {
  const start = Date.now();
  for (;;) {
    const res = await request(app).get(`${base}/search/${searchId}`);
    expect(res.status).toBe(200);
    const job = res.body;
    if (job.status === 'done') {
      expect(job.result).toBeTruthy();
      if (job.error) throw new Error(`job error: ${job.error}`);
      return job.result;
    }
    if (job.status === 'error') throw new Error(`job error: ${job.error}`);
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for job ${searchId}`);
    await sleep(20);
  }
}

describe('AhorrAR API (live, hermético)', () => {
  beforeAll(() => {
    setJobRunner((id, cfg) => runLiveJob(id, cfg, fixtureDeps));
  });

  afterAll(() => {
    setJobRunner(runLiveJob);
  });

  it('GET /api/health → ok + live mode', async () => {
    const res = await request(app).get(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'live' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('POST /webhooks/ml acks ML notifications (stub)', async () => {
    const notif = {
      _id: '652...',
      resource: '/items/MLA123456789',
      user_id: 1134148467,
      topic: 'item_competition',
      application_id: 8567113374842839,
      sent: '2026-09-23T20:00:00.000-04:00',
      attempts: 1,
      received: '2026-09-23T20:00:01.000-04:00',
    };
    const res = await request(app).post('/webhooks/ml').send(notif);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect((await request(app).get('/webhooks/ml')).status).toBe(200);
  });

  it('POST /api/search → 202 queued job; polling ends in a valid response (§V8)', async () => {
    const post = await request(app).post(`${base}/search`).send({ product: 'perfume', country: 'AR', maxResults: 5 });
    expect(post.status).toBe(202);
    expect(post.body.status).toBe('queued');
    expect(typeof post.body.searchId).toBe('string');

    const snapshot = await request(app).get(`${base}/search/${post.body.searchId}`);
    expect(snapshot.status).toBe(200);
    expect(['queued', 'running', 'done']).toContain(snapshot.body.status);

    const result = await pollUntilDone(post.body.searchId);
    expect(isSearchResponse(result)).toBe(true);
    expect(result.results.map((r) => r.rank)).toEqual(result.results.map((_, i) => i + 1));
    expect(result.results.every((r) => r.shipping.confirmed)).toBe(true);
  });

  it('GET /api/search/:id/events streams SSE and ends with event: done', async () => {
    const post = await request(app).post(`${base}/search`).send({ product: 'perfume', country: 'AR' });
    const id = post.body.searchId;
    const res = await request(app)
      .get(`${base}/search/${id}/events`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });
    const body = res.body as string;
    expect(body).toContain('data: ');
    expect(body).toContain('event: done');
  });

  it('validates input and replies 400', async () => {
    expect((await request(app).post(`${base}/search`).send({})).status).toBe(400);
    expect((await request(app).post(`${base}/search`).send({ product: '  ', country: 'AR' })).status).toBe(400);
    expect((await request(app).post(`${base}/search`).send({ product: 'x'.repeat(121), country: 'AR' })).status).toBe(400);
    expect((await request(app).post(`${base}/search`).send({ product: 'x', country: 'BR' })).status).toBe(400);
    expect((await request(app).post(`${base}/search`).send({ product: 'x', country: 'MX' })).status).toBe(400);
    expect((await request(app).post(`${base}/search`).send({ product: 'x', country: 'AR', maxDepth: 7 })).status).toBe(400);
    expect((await request(app).post(`${base}/search`).send({ product: 'x', country: 'AR', maxResults: 0 })).status).toBe(400);
  });

  it('GET /api/search/:id non-terminal omits optional result/error keys (V10)', async () => {
    const job = jobStore.create({ product: 'perfume', country: 'AR', maxDepth: 2, maxResults: 10 });
    const res = await request(app).get(`${base}/search/${job.searchId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('queued');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'error')).toBe(false);
  });

  it('GET /api/search/:id → 404 for unknown ids', async () => {
    const res = await request(app).get(`${base}/search/not-a-real-id`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('GET /api/calendar/:country returns events for AR, MX, ES; 400 otherwise', async () => {
    for (const cc of ['AR', 'MX', 'ES']) {
      const res = await request(app).get(`${base}/calendar/${cc}`);
      expect(res.status).toBe(200);
      expect(res.body.country).toBe(cc);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeGreaterThan(0);
      expect(res.body.nextEvents).toHaveLength(3);
    }
    expect((await request(app).get(`${base}/calendar/BR`)).status).toBe(400);
  });

  it('returns JSON errors for unknown routes', async () => {
    const res = await request(app).get(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});