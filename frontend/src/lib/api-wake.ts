/**
 * Render Free spins down after ~15m idle (~1m cold start).
 * Browser-side wake + session keep-warm (JS) so the first search does not
 * rely on SSE alone during boot. Keep-warm only while the tab is visible —
 * spun-down hours do not burn the 750 Free instance-hours quota.
 */

import { apiUrl } from '../api/client';

/** Under Render's 15m idle threshold. */
export const KEEP_WARM_INTERVAL_MS = 12 * 60 * 1000;

/** Cold start can take ~60–90s; allow headroom. */
export const WAKE_BUDGET_MS = 120_000;

const WAKE_RETRY_MS = 2_500;

export type WakePhase = 'idle' | 'waking' | 'ready' | 'failed';

export interface WakeProgress {
  phase: WakePhase;
  elapsedMs: number;
  attempts: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Single health probe — true when API JSON says ok. */
export async function pingApiHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return false;
    const body: unknown = await res.json().catch(() => null);
    if (typeof body !== 'object' || body === null) return false;
    return (body as { ok?: unknown }).ok === true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return false;
  }
}

/**
 * Poll /api/health until ready or budget exhausted.
 * Triggers Render spin-up on the first request.
 */
export async function wakeApi(
  signal?: AbortSignal,
  onProgress?: (p: WakeProgress) => void,
): Promise<boolean> {
  const started = Date.now();
  let attempts = 0;

  const report = (phase: WakePhase) => {
    onProgress?.({
      phase,
      elapsedMs: Date.now() - started,
      attempts,
    });
  };

  report('waking');

  while (Date.now() - started < WAKE_BUDGET_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    attempts += 1;
    report('waking');

    const attemptCtl = new AbortController();
    const onParentAbort = () => attemptCtl.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });
    const attemptTimer = window.setTimeout(() => attemptCtl.abort(), 12_000);

    let ok = false;
    try {
      ok = await pingApiHealth(attemptCtl.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError' && signal?.aborted) {
        throw err;
      }
      ok = false;
    } finally {
      window.clearTimeout(attemptTimer);
      signal?.removeEventListener('abort', onParentAbort);
    }

    if (ok) {
      report('ready');
      return true;
    }

    const remaining = WAKE_BUDGET_MS - (Date.now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(WAKE_RETRY_MS, remaining), signal);
  }

  report('failed');
  return false;
}

/**
 * While the document is visible, ping health every KEEP_WARM_INTERVAL_MS
 * so Render does not spin down mid-session. Returns a disposer.
 */
export function startApiKeepWarm(): () => void {
  let stopped = false;
  let timer: number | null = null;

  const clear = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const tick = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    void pingApiHealth().catch(() => undefined);
  };

  const arm = () => {
    clear();
    if (stopped || document.visibilityState !== 'visible') return;
    void pingApiHealth().catch(() => undefined);
    timer = window.setInterval(tick, KEEP_WARM_INTERVAL_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') arm();
    else clear();
  };

  document.addEventListener('visibilitychange', onVisibility);
  arm();

  return () => {
    stopped = true;
    clear();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
