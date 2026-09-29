import { describe, expect, it } from 'vitest';
import { isRelevantResult, titleMatchesQuery } from '../src/search/relevance.ts';

describe('notebook evidence (NOTEBOOK_STRONG)', () => {
  it('keeps real laptops', () => {
    expect(titleMatchesQuery('Notebook Lenovo IdeaPad 15 Intel i5', 'notebook')).toBe(true);
    expect(titleMatchesQuery('Laptop HP Pavilion 14 Ryzen 5', 'notebook')).toBe(true);
    expect(isRelevantResult('Notebook Lenovo IdeaPad 15 Intel i5', 'notebook')).toBe(true);
  });

  it('rejects CPU/mouse that only share PC-chip brand tokens', () => {
    expect(
      isRelevantResult('Procesador AMD Ryzen 5 5600GE 3.40GHz AM4 DDR4', 'notebook'),
    ).toBe(false);
    expect(isRelevantResult('TEC+MOUSE WIRELESS DELL KM526 LATINO', 'notebook')).toBe(false);
  });
});
