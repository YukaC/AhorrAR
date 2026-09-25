import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEP_WARM_INTERVAL_MS, pingApiHealth, startApiKeepWarm, wakeApi } from './api-wake';

describe('api-wake', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('pingApiHealth returns true on { ok: true }', async () => {
    await expect(pingApiHealth()).resolves.toBe(true);
  });

  it('pingApiHealth returns false on non-ok body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(pingApiHealth()).resolves.toBe(false);
  });

  it('wakeApi succeeds on first healthy ping', async () => {
    const phases: string[] = [];
    const ok = await wakeApi(undefined, (p) => phases.push(p.phase));
    expect(ok).toBe(true);
    expect(phases).toContain('waking');
    expect(phases.at(-1)).toBe('ready');
  });

  it('wakeApi retries until health ok', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls < 3) {
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const promise = wakeApi();
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(promise).resolves.toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('startApiKeepWarm schedules interval under 15m idle', () => {
    expect(KEEP_WARM_INTERVAL_MS).toBeLessThan(15 * 60 * 1000);
    const stop = startApiKeepWarm();
    stop();
  });
});
