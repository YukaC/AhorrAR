/**
 * Tiny structured logger: `[ISO] LEVEL message`. No colors, no deps.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: LogLevel = process.env.LOG_LEVEL === undefined ? 'info' : (process.env.LOG_LEVEL as LogLevel);

function write(level: LogLevel, message: string, meta?: unknown): void {
  if (ORDER[level] < ORDER[MIN_LEVEL] || !(level in ORDER)) return;
  const ts = new Date().toISOString();
  const suffix = meta === undefined ? '' : ` ${safeMeta(meta)}`;
  console.log(`[${ts}] ${level.toUpperCase()} ${message}${suffix}`);
}

function safeMeta(meta: unknown): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};