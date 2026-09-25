import { describe, expect, it } from 'vitest';
import { nodesBudgetFor } from '../src/search/nodes-budget.ts';

describe('nodesBudgetFor', () => {
  it('scales with result cap under a high ceiling', () => {
    expect(nodesBudgetFor(25, 400)).toBe(120); // 25*4+20
    expect(nodesBudgetFor(50, 400)).toBe(220);
    expect(nodesBudgetFor(100, 400)).toBe(400); // min(400, 420)
  });

  it('respects MAX_NODES as hard ceiling (Render Free)', () => {
    expect(nodesBudgetFor(25, 80)).toBe(80);
    expect(nodesBudgetFor(100, 80)).toBe(80);
  });

  it('never goes below 24 when ceiling allows', () => {
    expect(nodesBudgetFor(1, 400)).toBe(24);
  });
});
