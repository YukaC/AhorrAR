import { describe, expect, it } from 'vitest';
import { PriorityQueue } from '../src/search/priorityQueue.ts';

describe('PriorityQueue (min-heap)', () => {
  it('pops in ascending priority order', () => {
    const q = new PriorityQueue<number>((n) => n);
    for (const n of [5, 1, 4, 2, 3]) q.push(n);
    expect(q.size).toBe(5);
    expect(q.peek()).toBe(1);
    const out: number[] = [];
    while (q.size > 0) out.push(q.pop()!);
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('is FIFO for equal priorities (stable order)', () => {
    const q = new PriorityQueue<{ k: number; tag: string }>((i) => i.k);
    q.push({ k: 1, tag: 'a' });
    q.push({ k: 0, tag: 'early' });
    q.push({ k: 1, tag: 'b' });
    q.push({ k: 1, tag: 'c' });
    expect(q.pop()!.tag).toBe('early');
    const rest: string[] = [];
    while (q.size > 0) rest.push(q.pop()!.tag);
    expect(rest).toEqual(['a', 'b', 'c']);
  });

  it('works with object priorities via custom key', () => {
    const q = new PriorityQueue<{ depth: number; id: string }>((i) => i.depth);
    q.push({ depth: 2, id: 'x' });
    q.push({ depth: 1, id: 'y' });
    expect(q.peek()!.id).toBe('y');
  });

  it('returns undefined when empty', () => {
    const q = new PriorityQueue<number>((n) => n);
    expect(q.pop()).toBeUndefined();
    expect(q.peek()).toBeUndefined();
    expect(q.size).toBe(0);
  });
});