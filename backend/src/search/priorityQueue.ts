/**
 * Tiny generic min-heap priority queue. No dependencies.
 * Equal priorities come out FIFO (stable), which keeps BFS order deterministic.
 */

export class PriorityQueue<T> {
  private readonly toPriority: (value: T) => number;
  private heap: Array<{ prio: number; seq: number; value: T }> = [];
  private seq = 0;

  constructor(toPriority: (value: T) => number) {
    this.toPriority = toPriority;
  }

  get size(): number {
    return this.heap.length;
  }

  push(value: T): void {
    const item = { prio: this.toPriority(value), seq: this.seq++, value };
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): T | undefined {
    return this.heap[0]?.value;
  }

  pop(): T | undefined {
    const top = this.heap[0];
    if (top === undefined) return undefined;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.value;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.less(idx, parent)) {
        this.swap(idx, parent);
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    for (;;) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < this.heap.length && this.less(left, smallest)) smallest = left;
      if (right < this.heap.length && this.less(right, smallest)) smallest = right;
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private less(i: number, j: number): boolean {
    const a = this.heap[i]!;
    const b = this.heap[j]!;
    if (a.prio !== b.prio) return a.prio < b.prio;
    return a.seq < b.seq;
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = tmp;
  }
}