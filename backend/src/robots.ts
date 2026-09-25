/**
 * Política de robots.txt — helper compartido del crawler Node (§V6).
 *
 * Decisión documentada en SPEC §C: el path legacy (LiveFetcher/Playwright)
 * CONSULTA robots.txt vía esta clase; el primario Scrapling (Python) NO lo
 * consulta por política explícita (VTEX API pública + índice curado). La misma
 * fuente de verdad vive en scraper/docs como nota de arquitectura.
 */

import { RobotsFile } from 'crawlee';

interface RobotsApi {
  load(url: string, proxyUrl?: string, options?: { useragent?: string }): Promise<{ isAllowed(url: string, userAgent?: string): boolean }>;
}

type RobotsDoc = { isAllowed(url: string, userAgent?: string): boolean } | 'open';

export interface RobotsOptions {
  userAgent: string;
  /** Hosts/URLs que se saltan robots (SERP hubs, API auth — político, no técnico). */
  bypass?: (url: string) => boolean;
}

export class RobotsResolver {
  private readonly files = new Map<string, RobotsDoc>();
  private readonly userAgent: string;
  private readonly bypass: (url: string) => boolean;

  constructor(opts: RobotsOptions) {
    this.userAgent = opts.userAgent;
    this.bypass = opts.bypass ?? (() => false);
  }

  async allow(url: string): Promise<boolean> {
    if (this.bypass(url)) return true;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    const cached = this.files.get(host);
    if (cached === 'open') return true;
    if (cached !== undefined) return cached.isAllowed(url, this.userAgent);
    try {
      const loader = (RobotsFile as unknown as RobotsApi).load;
      const robots = await loader(`https://${host}/robots.txt`, undefined, { useragent: this.userAgent });
      this.files.set(host, robots);
      return robots.isAllowed(url, this.userAgent);
    } catch {
      this.files.set(host, 'open'); // Sin robots.txt o error I/O → abierto (fail-open).
      return true;
    }
  }
}