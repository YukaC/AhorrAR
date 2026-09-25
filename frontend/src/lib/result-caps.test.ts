import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESULT_CAP,
  FREE_HOST_RESULT_CAPS,
  hostResultCaps,
  nextResultCap,
  RESULT_CAPS,
} from './result-caps';

describe('result-caps', () => {
  it('defaults to 25', () => {
    expect(DEFAULT_RESULT_CAP).toBe(25);
    expect(RESULT_CAPS).toEqual([25, 50, 100]);
  });

  it('steps 25 → 50 → 100 → null', () => {
    expect(nextResultCap(25)).toBe(50);
    expect(nextResultCap(50)).toBe(100);
    expect(nextResultCap(100)).toBeNull();
  });

  it('jumps from legacy caps to the next allowed tier', () => {
    expect(nextResultCap(10)).toBe(25);
    expect(nextResultCap(20)).toBe(25);
    expect(nextResultCap(40)).toBe(50);
  });

  it('free host caps stop at 50', () => {
    expect(hostResultCaps(true)).toEqual(FREE_HOST_RESULT_CAPS);
    expect(nextResultCap(25, FREE_HOST_RESULT_CAPS)).toBe(50);
    expect(nextResultCap(50, FREE_HOST_RESULT_CAPS)).toBeNull();
  });
});
