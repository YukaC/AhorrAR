import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchParams, SearchProgress, SearchResponse } from '../../../shared/contract';
import { ApiError, createSearch, getJob, subscribeToEvents } from '../api/client';
import type { EventsSub } from '../api/client';
import { wakeApi } from '../lib/api-wake';

export type SearchStatus = 'idle' | 'running' | 'done' | 'error';

export interface SearchState {
  status: SearchStatus;
  params: SearchParams | null;
  progress: SearchProgress | null;
  response: SearchResponse | null;
  error: string | null;
  errorCode: number | null;
}

const IDLE_STATE: SearchState = {
  status: 'idle',
  params: null,
  progress: null,
  response: null,
  error: null,
  errorCode: null,
};

const POLL_MS = 1000;

const LAST_SEARCH_KEY = 'ahorrar:lastSearchId';

function rememberSearch(searchId: string): void {
  try {
    localStorage.setItem(LAST_SEARCH_KEY, searchId);
  } catch {
    /* private mode / quota — best-effort */
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Máquina de estados idle → running → done/error.
 * Un run nuevo cancela el anterior (EventSource cerrado + poll abortado).
 */
export function useSearch() {
  const [state, setState] = useState<SearchState>(IDLE_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const cleanupRef = useRef<EventsSub | null>(null);
  const lastParamsRef = useRef<SearchParams | null>(null);

  const run = useCallback((rawParams: SearchParams) => {
    abortRef.current?.abort();
    cleanupRef.current?.close();
    const params: SearchParams = {
      ...rawParams,
      maxDepth: rawParams.maxDepth ?? 2,
      maxResults: rawParams.maxResults ?? 25,
    };
    lastParamsRef.current = params;
    setState({
      status: 'running',
      params,
      progress: null,
      response: null,
      error: null,
      errorCode: null,
    });

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const teardown = () => {
      cleanupRef.current?.close();
      cleanupRef.current = null;
      if (abortRef.current === controller) abortRef.current = null;
    };

    void (async () => {
      try {
        // Render Free cold start (~1m): wake via /api/health before POST/SSE.
        setState((s) =>
          s.status === 'running'
            ? {
                ...s,
                progress: {
                  searchId: 'waking',
                  status: 'running',
                  depth: 0,
                  nodesVisited: 0,
                  resultsFound: 0,
                  message: 'Despertando el servidor (free tier)…',
                },
              }
            : s,
        );

        const awake = await wakeApi(signal, (p) => {
          if (signal.aborted || p.phase === 'ready') return;
          const secs = Math.max(1, Math.round(p.elapsedMs / 1000));
          setState((s) =>
            s.status === 'running'
              ? {
                  ...s,
                  progress: {
                    searchId: 'waking',
                    status: 'running',
                    depth: 0,
                    nodesVisited: 0,
                    resultsFound: 0,
                    message:
                      p.phase === 'failed'
                        ? 'No se pudo despertar el servidor.'
                        : `Despertando el servidor… ${secs}s (cold start free)`,
                  },
                }
              : s,
          );
        });
        if (signal.aborted) return;
        if (!awake) {
          teardown();
          setState((s) =>
            s.status === 'running'
              ? {
                  status: 'error',
                  params: s.params,
                  progress: s.progress,
                  response: null,
                  error:
                    'El servidor free está dormido o caído. Esperá ~1 minuto y reintentá.',
                  errorCode: 0,
                }
              : s,
          );
          return;
        }

        setState((s) =>
          s.status === 'running'
            ? {
                ...s,
                progress: {
                  searchId: 'waking',
                  status: 'running',
                  depth: 0,
                  nodesVisited: 0,
                  resultsFound: 0,
                  message: 'Servidor listo — buscando…',
                },
              }
            : s,
        );

        const created = await createSearch(params, signal);
        if (signal.aborted) return;
        rememberSearch(created.searchId);

        cleanupRef.current = subscribeToEvents(created.searchId, (progress) => {
          if (signal.aborted) return;
          setState((s) =>
            s.status === 'running' ? { ...s, progress } : s,
          );
        });

        const job = await getJobPolled(created.searchId, signal);
        if (signal.aborted || job === null) return;

        teardown();
        if (job.status === 'done' && job.result) {
          const result = job.result;
          setState((s) => ({
            status: 'done',
            params: s.params,
            progress: job.progress,
            response: result,
            error: null,
            errorCode: null,
          }));
        } else {
          setState((s) => ({
            status: 'error',
            params: s.params,
            progress: job.progress,
            response: null,
            error: job.error ?? 'La búsqueda falló en el servidor.',
            errorCode: null,
          }));
        }
      } catch (err) {
        if (isAbortError(err)) return;
        teardown();
        const code = err instanceof ApiError ? err.status : null;
        const message = err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
        setState((s) => (s.status === 'running' ? {
          status: 'error',
          params: s.params,
          progress: s.progress,
          response: null,
          error: message,
          errorCode: code,
        } : s));
      }
    })();
  }, []);

  const getJobPolled = useCallback(
    async (searchId: string, signal: AbortSignal) => {
      for (;;) {
        const job = await getJob(searchId, signal);
        if (job.status === 'done' || job.status === 'error') return job;
        await sleep(POLL_MS, signal);
        if (signal.aborted) return null;
      }
    },
    [],
  );

  const retry = useCallback(() => {
    const params = lastParamsRef.current;
    if (params) run(params);
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    cleanupRef.current?.close();
    cleanupRef.current = null;
    abortRef.current = null;
    setState((s) => (s.status === 'running' ? { ...s, status: 'idle', progress: null } : s));
  }, []);

  /** Volver al idle (logo home): corta job en vuelo y limpia resultado/error. */
  const goHome = useCallback(() => {
    abortRef.current?.abort();
    cleanupRef.current?.close();
    cleanupRef.current = null;
    abortRef.current = null;
    lastParamsRef.current = null;
    try {
      localStorage.removeItem(LAST_SEARCH_KEY);
    } catch {
      /* private mode / quota */
    }
    setState(IDLE_STATE);
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    cleanupRef.current?.close();
  }, []);

  // Re-conexión (§V20): si el backend persistió el último job (SQLite), el
  // frontend lo retoma sin esperar una búsqueda nueva al recargar la página.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_SEARCH_KEY);
      } catch {
        return;
      }
      if (last === null) return;
      try {
        const job = await getJob(last, controller.signal);
        if (cancelled) return;
        if (job.status === 'done' && job.result) {
          setState({
            status: 'done',
            params: job.params,
            progress: job.progress,
            response: job.result,
            error: null,
            errorCode: null,
          });
        }
      } catch (err) {
        if (isAbortError(err)) return;
        try {
          localStorage.removeItem(LAST_SEARCH_KEY);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { state, run, retry, cancel, goHome };
}