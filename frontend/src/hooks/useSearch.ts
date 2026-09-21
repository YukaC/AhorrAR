import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchParams, SearchProgress, SearchResponse } from '../../../shared/contract';
import { ApiError, createSearch, getJob, subscribeToEvents } from '../api/client';
import type { EventsSub } from '../api/client';

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
    const params: SearchParams = { ...rawParams, maxDepth: 2, maxResults: 10 };
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
        const created = await createSearch(params, signal);
        if (signal.aborted) return;

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

  useEffect(() => () => {
    abortRef.current?.abort();
    cleanupRef.current?.close();
  }, []);

  return { state, run, retry, cancel };
}