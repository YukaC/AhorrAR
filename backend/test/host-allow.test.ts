import { describe, expect, it, beforeEach } from 'vitest';
import {
  assertFetchAllowed,
  isDiscoverableHostShape,
  isPrivateIp,
  isSafeCrawlUrlShape,
  looksLikeIpLiteral,
  pinnedAddresses,
  resetHostAllowDnsCacheForTests,
  setDnsResolverForTests,
} from '../src/search/host-allow.ts';

describe('host-allow §V32', () => {
  beforeEach(() => {
    resetHostAllowDnsCacheForTests();
  });

  it('accepts .ar and bootstrap retail', () => {
    expect(isDiscoverableHostShape('tienda-nueva.com.ar')).toBe(true);
    expect(isDiscoverableHostShape('www.fravega.com')).toBe(true);
  });

  it('rejects localhost, bare IP, private-looking suffixes', () => {
    expect(isDiscoverableHostShape('localhost')).toBe(false);
    expect(isDiscoverableHostShape('127.0.0.1')).toBe(false);
    expect(isDiscoverableHostShape('10.0.0.5')).toBe(false);
    expect(isDiscoverableHostShape('evil.local')).toBe(false);
    expect(isDiscoverableHostShape('metadata.google.internal')).toBe(false);
  });

  it('rejects path injection', () => {
    expect(isDiscoverableHostShape('evil.com/path')).toBe(false);
    expect(isDiscoverableHostShape('evil.com:8080')).toBe(false);
  });

  it('flags private IP ranges incl. metadata and mapped v6', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true); // OCI/AWS metadata
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12:3456::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('rejects decimal/octal/hex IP host literals', () => {
    expect(looksLikeIpLiteral('2130706433')).toBe(true);
    expect(looksLikeIpLiteral('0x7f000001')).toBe(true);
    expect(looksLikeIpLiteral('0x7f.1')).toBe(true);
    expect(looksLikeIpLiteral('0177.0.0.1')).toBe(true);
    expect(looksLikeIpLiteral('127.0.0.1')).toBe(true);
    expect(isDiscoverableHostShape('2130706433')).toBe(false);
    expect(isDiscoverableHostShape('0x7f.1')).toBe(false);
  });

  it('rejects URL tricks: userinfo, non-http schemes', () => {
    expect(isSafeCrawlUrlShape('http://tienda.com@evil.com/')).toBe(false);
    expect(isSafeCrawlUrlShape('https://user:pass@fravega.com/')).toBe(false);
    expect(isSafeCrawlUrlShape('file:///etc/passwd')).toBe(false);
    expect(isSafeCrawlUrlShape('ftp://fravega.com/')).toBe(false);
    expect(isSafeCrawlUrlShape('https://www.fravega.com/search?q=x')).toBe(true);
    // Weird port still OK if host shape passes (host gate ≠ port gate)
    expect(isSafeCrawlUrlShape('https://www.fravega.com:8443/')).toBe(true);
  });

  it('assertFetchAllowed rejects DNS→private (mocked)', async () => {
    let calls = 0;
    setDnsResolverForTests(async () => {
      calls += 1;
      return ['169.254.169.254'];
    });
    try {
      expect(await assertFetchAllowed('https://metadata-trap.com.ar/')).toBe(false);
      expect(pinnedAddresses('metadata-trap.com.ar')).toEqual([]);
      expect(calls).toBe(1);
    } finally {
      setDnsResolverForTests(undefined);
      resetHostAllowDnsCacheForTests();
    }
  });

  it('assertFetchAllowed pins public DNS for rebinding-safe connect', async () => {
    let calls = 0;
    setDnsResolverForTests(async () => {
      calls += 1;
      return ['1.1.1.1'];
    });
    try {
      expect(await assertFetchAllowed('https://shop-ok.com.ar/p')).toBe(true);
      expect(pinnedAddresses('shop-ok.com.ar').map((a) => a.address)).toEqual(['1.1.1.1']);
      expect(await assertFetchAllowed('https://shop-ok.com.ar/p2')).toBe(true);
      expect(calls).toBe(1); // second hop hits cache
    } finally {
      setDnsResolverForTests(undefined);
      resetHostAllowDnsCacheForTests();
    }
  });
});
