/**
 * Discovery host validation (§V32) — anti-SSRF before persisting to ar-shops.json.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const BLOCKED_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'localdomain',
];

const AR_BOOTSTRAP = new Set([
  'fravega.com',
  'farmacity.com',
  'compragamer.com',
  'musimundo.com',
  'garbarino.com',
  'easy.com.ar',
  'mercadolibre.com.ar',
]);

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

/** Sync structural checks (no DNS). */
export function isDiscoverableHostShape(hostRaw: string): boolean {
  const host = hostRaw.replace(/^www\./, '').toLowerCase().trim();
  if (host.length < 4 || host.length > 253) return false;
  if (host.includes('/') || host.includes(':') || host.includes(' ')) return false;
  if (isIP(host) !== 0) return false; // bare IPs never
  for (const suf of BLOCKED_SUFFIXES) {
    if (host === suf || host.endsWith(`.${suf}`)) return false;
  }
  if (AR_BOOTSTRAP.has(host)) return true;
  if (host.endsWith('.ar')) return true;
  // Known retail .com AR brands already in bootstrap; allow other .com only if
  // they look like a real FQDN with a public TLD (not single-label).
  const parts = host.split('.');
  if (parts.length >= 2 && parts.every((p) => /^[a-z0-9-]+$/i.test(p))) {
    const tld = parts[parts.length - 1]!;
    if (['com', 'net', 'org', 'shop', 'store'].includes(tld)) return true;
  }
  return false;
}

/** Async: shape + DNS must not resolve to private ranges. */
export async function isPersistableDiscoveredHost(hostRaw: string): Promise<boolean> {
  const host = hostRaw.replace(/^www\./, '').toLowerCase().trim();
  if (!isDiscoverableHostShape(host)) return false;
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    if (addrs.length === 0) return false;
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return false;
    }
    return true;
  } catch {
    return false; // NXDOMAIN / timeout → do not persist
  }
}
