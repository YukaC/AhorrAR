/**
 * Discovery + fetch host validation (§V32) — anti-SSRF.
 * Shape allowlist, private-IP DNS check, URL tricks, short-TTL DNS cache,
 * and pin-to-resolved-IP lookup for Node http(s) clients.
 */

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';

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

/** DNS cache TTL (ms). Short to bound stale allow; long enough to cut per-host churn. */
export const DNS_CACHE_TTL_MS = 30_000;

interface DnsCacheEntry {
  addresses: string[];
  expiresAt: number;
}

const dnsCache = new Map<string, DnsCacheEntry>();

/** Test-only: clear DNS pin/allow cache. */
export function resetHostAllowDnsCacheForTests(): void {
  dnsCache.clear();
}

/** True for RFC1918 / loopback / link-local / ULA / mapped private. Exported for tests. */
export function isPrivateIp(ipRaw: string): boolean {
  let ip = ipRaw.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);

  // IPv4-mapped IPv6 → check the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateIp(mapped[1]!);

  const kind = isIP(ip);
  if (kind === 4) {
    if (ip === '0.0.0.0') return true;
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true; // 127/8
    if (a === 10) return true; // 10/8
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 (OCI metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (kind === 6) {
    if (ip === '::1' || ip === '::') return true;
    // fe80::/10 link-local
    if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;
    // fc00::/7 ULA (fc00::/8 and fd00::/8)
    if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
    return false;
  }
  return true; // unparseable → deny
}

/** Decimal / octal / hex / dotted-weird host forms that bypass naive isIP. */
export function looksLikeIpLiteral(hostRaw: string): boolean {
  const host = hostRaw.trim().toLowerCase();
  if (host === '') return false;
  if (isIP(host) !== 0) return true;
  // Decimal IPv4 (e.g. 2130706433 → 127.0.0.1)
  if (/^\d{8,10}$/.test(host)) return true;
  // Hex IPv4 (0x7f000001) or hex-dotted (0x7f.1)
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^0x[0-9a-f]+(\.0x[0-9a-f]+)+$/i.test(host)) return true;
  if (/^0x[0-9a-f]+(\.\d+)+$/i.test(host)) return true;
  // Octal dotted (0177.0.0.1)
  if (/^0[0-7]+(\.[0-7]+){1,3}$/.test(host)) return true;
  // Mixed dotted with leading zeros that Node isIP rejects but browsers may accept
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}

/** Sync structural checks (no DNS). Host only — not a full URL. */
export function isDiscoverableHostShape(hostRaw: string): boolean {
  const host = hostRaw.replace(/^www\./, '').toLowerCase().trim();
  if (host.length < 4 || host.length > 253) return false;
  if (host.includes('/') || host.includes(':') || host.includes(' ') || host.includes('@')) return false;
  if (looksLikeIpLiteral(host)) return false;
  for (const suf of BLOCKED_SUFFIXES) {
    if (host === suf || host.endsWith(`.${suf}`)) return false;
  }
  if (AR_BOOTSTRAP.has(host)) return true;
  if (host.endsWith('.ar')) return true;
  const parts = host.split('.');
  if (parts.length >= 2 && parts.every((p) => /^[a-z0-9-]+$/i.test(p))) {
    const tld = parts[parts.length - 1]!;
    if (['com', 'net', 'org', 'shop', 'store'].includes(tld)) return true;
  }
  return false;
}

/**
 * Sync URL-shape SSRF checks: scheme, userinfo, host shape / IP literals.
 * Does NOT do DNS — call `assertFetchAllowed` before connecting.
 */
export function isSafeCrawlUrlShape(urlRaw: string): boolean {
  let u: URL;
  try {
    u = new URL(urlRaw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  // userinfo: http://tienda.com@evil.com → username=tienda.com, host=evil.com
  if (u.username !== '' || u.password !== '') return false;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === '') return false;
  if (looksLikeIpLiteral(host) || looksLikeIpLiteral(u.hostname)) return false;
  // Weird non-default ports still need a public host; shape gate is host-only here.
  return isDiscoverableHostShape(host);
}

/** Injectable for hermetic tests (ESM cannot spy on node:dns). */
export type DnsResolver = (host: string) => Promise<string[]>;

let dnsResolver: DnsResolver = async (host: string) => {
  const addrs = await dnsLookup(host, { all: true, verbatim: true });
  return addrs.map((a) => a.address);
};

/** Test-only: swap DNS resolver (restore with `undefined`). */
export function setDnsResolverForTests(resolver: DnsResolver | undefined): void {
  dnsResolver =
    resolver ??
    (async (host: string) => {
      const addrs = await dnsLookup(host, { all: true, verbatim: true });
      return addrs.map((a) => a.address);
    });
}

async function resolveAddresses(host: string): Promise<string[]> {
  const key = host.replace(/^www\./, '').toLowerCase();
  const now = Date.now();
  const cached = dnsCache.get(key);
  if (cached && cached.expiresAt > now) return cached.addresses;

  const addresses = await dnsResolver(key);
  // Only pin/cache when every address is public (§V32 — no private in cache).
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a))) {
    return addresses;
  }
  dnsCache.set(key, { addresses, expiresAt: now + DNS_CACHE_TTL_MS });
  return addresses;
}

/** Async: shape + DNS must not resolve to private ranges. */
export async function isPersistableDiscoveredHost(hostRaw: string): Promise<boolean> {
  const host = hostRaw.replace(/^www\./, '').toLowerCase().trim();
  if (!isDiscoverableHostShape(host)) return false;
  try {
    const addresses = await resolveAddresses(host);
    if (addresses.length === 0) return false;
    for (const a of addresses) {
      if (isPrivateIp(a)) return false;
    }
    return true;
  } catch {
    return false; // NXDOMAIN / timeout → do not persist
  }
}

/**
 * Fetch-time gate: URL shape + DNS public. Populates pin cache for `pinnedLookup`.
 * Call before every outbound hop (including redirects).
 */
export async function assertFetchAllowed(urlRaw: string): Promise<boolean> {
  if (!isSafeCrawlUrlShape(urlRaw)) return false;
  let host: string;
  try {
    host = new URL(urlRaw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }
  try {
    const addresses = await resolveAddresses(host);
    if (addresses.length === 0) return false;
    for (const a of addresses) {
      if (isPrivateIp(a)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * dns.lookup-compatible pin: reuse the same addresses validated by assertFetchAllowed.
 * Prevents DNS rebinding between resolve and connect.
 */
export function pinnedLookup(
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void;
export function pinnedLookup(
  hostname: string,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void;
export function pinnedLookup(
  hostname: string,
  optionsOrCb: unknown,
  maybeCb?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  const callback = (typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb) as (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void;
  const key = hostname.replace(/^www\./, '').toLowerCase();
  const cached = dnsCache.get(key);
  if (!cached || cached.addresses.length === 0 || cached.expiresAt <= Date.now()) {
    const err = Object.assign(new Error(`ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND',
      hostname,
    }) as NodeJS.ErrnoException;
    callback(err, '', 4);
    return;
  }
  const address = cached.addresses[0]!;
  const family = isIP(address) === 6 ? 6 : 4;
  callback(null, address, family);
}

/** All pinned addresses for a host (test / multi-A). */
export function pinnedAddresses(hostname: string): LookupAddress[] {
  const key = hostname.replace(/^www\./, '').toLowerCase();
  const cached = dnsCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) return [];
  return cached.addresses.map((address) => ({
    address,
    family: (isIP(address) === 6 ? 6 : 4) as 4 | 6,
  }));
}
