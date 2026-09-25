import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diffTo, parseEventDate, useCountdown } from './useCountdown';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseEventDate', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const d = parseEventDate('2026-11-27');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10); // noviembre (0-indexed)
    expect(d.getDate()).toBe(27);
    expect(d.getHours()).toBe(0);
  });
});

describe('diffTo', () => {
  it('decomposes the remaining time', () => {
    const parts = diffTo(new Date('2026-09-26T02:03:12'));
    expect(parts).toEqual({
      days: 1,
      hours: 14,
      minutes: 3,
      seconds: 12,
      total: 86_400_000 + 14 * 3_600_000 + 3 * 60_000 + 12_000,
    });
  });

  it('clamps to zero for past targets', () => {
    const parts = diffTo(new Date('2026-09-24T11:59:59'));
    expect(parts.total).toBe(0);
    expect(parts.days).toBe(0);
  });

  it('returns zeros for invalid dates', () => {
    expect(diffTo(new Date('not-a-date'))).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total: 0,
    });
  });
});

describe('useCountdown', () => {
  it('ticks every second and stops at zero', () => {
    vi.setSystemTime(new Date('2026-09-24T23:59:58'));
    const { result } = renderHook(() => useCountdown('2026-09-25'));

    expect(result.current.seconds).toBe(2);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.seconds).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.total).toBe(0);

    // No sigue tickeando después de llegar a cero.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.total).toBe(0);
  });
});