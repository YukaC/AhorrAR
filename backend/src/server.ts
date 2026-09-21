/**
 * AhorrAR backend — Express 5 API.
 *
 * - POST /api/search                    → 202 + job execution (live)
 * - GET  /api/search/:id                → job snapshot
 * - GET  /api/search/:id/events         → SSE progress stream
 * - GET  /api/calendar/:country         → country trade calendar
 * - GET  /api/health                    → ok / mode / uptime
 *
 * Errors are always JSON `{error}`; never stack traces to the client.
 */

import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { COUNTRY_CODES, type CountryCode, type SearchParams } from '../../shared/contract.ts';
import { buildEventInfo, describeCountryEvents, upcomingEvents } from './calendar/events.ts';
import { getCountry, getAllCountries } from './calendar/countries.ts';
import { config } from './config.ts';
import { executeJob, isLiveRunner, jobStore, toErrorMessage } from './jobs.ts';
import { browserAvailable } from './search/fetcher.ts';
import { logger } from './utils/logger.ts';

export const app = express();
app.use(cors());
app.use(express.json());

/* ------------------------------------------------------------------------ */
/* Validation                                                               */
/* ------------------------------------------------------------------------ */

interface Validated {
  params: SearchParams;
}

function validateSearchBody(body: unknown): Validated | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Body debe ser un objeto JSON.' };
  const b = body as Record<string, unknown>;

  const product = typeof b.product === 'string' ? b.product.trim() : '';
  if (product.length < 1) return { error: 'product es obligatorio.' };
  if (product.length > 120) return { error: 'product no puede superar los 120 caracteres.' };

  const country = b.country;
  // Live search is AR-only (§G / §C). Calendar still serves MX/ES.
  if (country !== undefined && country !== 'AR') {
    return { error: 'Por ahora solo se admiten búsquedas en Argentina (country: AR).' };
  }

  let maxDepth: number | undefined;
  if (b.maxDepth !== undefined) {
    if (typeof b.maxDepth !== 'number' || !Number.isInteger(b.maxDepth) || b.maxDepth < 0 || b.maxDepth > 4) {
      return { error: 'maxDepth debe ser un entero entre 0 y 4.' };
    }
    maxDepth = b.maxDepth;
  }

  let maxResults: number | undefined;
  if (b.maxResults !== undefined) {
    if (typeof b.maxResults !== 'number' || !Number.isInteger(b.maxResults) || b.maxResults < 1 || b.maxResults > 30) {
      return { error: 'maxResults debe ser un entero entre 1 y 30.' };
    }
    maxResults = b.maxResults;
  }

  return {
    params: {
      product,
      country: 'AR',
      maxDepth: maxDepth ?? config.maxDepth,
      maxResults: maxResults ?? config.maxResults,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Search routes                                                            */
/* ------------------------------------------------------------------------ */

app.post('/api/search', async (req, res) => {
  const validated = validateSearchBody(req.body);
  if ('error' in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { params } = validated;

  // Live: Scrapling primary (no Playwright required) or legacy Node BFS.
  if (isLiveRunner()) {
    const needsBrowser = config.crawler === 'legacy';
    if (needsBrowser && !(await browserAvailable())) {
      res.status(503).json({
        error: 'No hay browser de Playwright disponible para el modo legacy.',
        hint: 'Instalá: cd backend && npx playwright install chromium — o arrancá Scrapling (CRAWLER=auto).',
      });
      return;
    }
  }

  const job = jobStore.create(params);
  logger.info(`job creado ${job.searchId}`, { product: params.product, country: params.country, mode: 'live' });

  setImmediate(() => {
    void execute(job.searchId);
  });
  res.status(202).json({ searchId: job.searchId, status: job.status, params });
});

async function execute(searchId: string): Promise<void> {
  try {
    await executeJob(searchId, config);
  } catch (err) {
    const message = toErrorMessage(err);
    logger.error(`job ${searchId} falló`, message);
    jobStore.fail(searchId, message);
  }
}

app.get('/api/search/:id', (req, res) => {
  const job = jobStore.get(req.params.id ?? '');
  if (job === undefined) {
    res.status(404).json({ error: 'Búsqueda no encontrada o expirada.' });
    return;
  }
  const body: Record<string, unknown> = {
    searchId: job.searchId,
    status: job.status,
    params: job.params,
    createdAt: job.createdAt,
    progress: job.progress,
  };
  if (job.result !== undefined) body.result = job.result;
  if (job.error !== undefined && job.error !== null) body.error = job.error;
  res.json(body);
});

const TERMINAL: ReadonlySet<string> = new Set(['done', 'error']);

app.get('/api/search/:id/events', (req, res) => {
  const job = jobStore.get(req.params.id ?? '');
  if (job === undefined) {
    res.status(404).json({ error: 'Búsqueda no encontrada o expirada.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let finished = false;
  let heartbeat: NodeJS.Timeout | null = null;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (heartbeat !== null) clearInterval(heartbeat);
    stop();
    res.write('event: done\ndata: {}\n\n');
    res.end();
  };

  const emit = (progress: { status: string }): void => {
    if (finished) return;
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
    if (TERMINAL.has(progress.status)) finish();
  };

  const stop = jobStore.onProgress(job.searchId, (p) => emit(p));

  // Current snapshot first (job may have progressed / finished before we subscribed).
  emit(job.progress);

  heartbeat = setInterval(() => {
    if (!finished) res.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref();

  req.on('close', () => {
    if (!finished) {
      clearInterval(heartbeat);
      finished = true;
      stop();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Calendar + health                                                        */
/* ------------------------------------------------------------------------ */

app.get('/api/calendar/:country', (req, res) => {
  const code = req.params.country;
  if (typeof code !== 'string' || !(COUNTRY_CODES as readonly string[]).includes(code)) {
    res.status(400).json({ error: `country debe ser uno de: ${COUNTRY_CODES.join(', ')}.` });
    return;
  }
  const cc = code as CountryCode;
  const country = getCountry(cc);
  const today = new Date();
  res.json({
    country: cc,
    flag: country.flag,
    name: country.name,
    activeNow: buildEventInfo(today, cc),
    events: describeCountryEvents(cc, today.getFullYear()),
    nextEvents: upcomingEvents(cc, today, 3),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: 'live',
    crawler: config.crawler,
    scraplingUrl: config.scraplingUrl,
    uptime: Math.round(process.uptime()),
  });
});

app.get('/api/countries', (_req, res) => {
  res.json({ countries: getAllCountries() });
});

/* ------------------------------------------------------------------------ */
/* Error handling                                                           */
/* ------------------------------------------------------------------------ */

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number((err as { status?: unknown }).status);
  const statusCode = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const message = err instanceof Error ? err.message : 'Error interno del servidor.';
  logger.error(`HTTP ${statusCode}`, message);
  if (statusCode >= 500) {
    res.status(statusCode).json({ error: 'Error interno del servidor.' });
    return;
  }
  res.status(statusCode).json({ error: message });
};
app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

/* ------------------------------------------------------------------------ */
/* Entry point                                                              */
/* ------------------------------------------------------------------------ */

export function startServer(): void {
  const server = app.listen(config.port, () => {
    logger.info(`AhorrAR backend en http://localhost:${config.port} (live)`);
  });
  server.on('close', () => jobStore.dispose());
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) startServer();