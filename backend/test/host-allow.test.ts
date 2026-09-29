import { describe, expect, it } from 'vitest';
import { isDiscoverableHostShape } from '../src/search/host-allow.ts';

describe('host-allow §V32', () => {
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
});
