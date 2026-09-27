import { describe, expect, it } from 'vitest';
import { isCategoryOnlyQuery, specificityHintFor } from './query-specificity';

describe('isCategoryOnlyQuery', () => {
  it('detects bare category tokens', () => {
    expect(isCategoryOnlyQuery('perfume')).toBe(true);
    expect(isCategoryOnlyQuery('  Notebook  ')).toBe(true);
    expect(isCategoryOnlyQuery('zapatillas')).toBe(true);
  });

  it('rejects brand/model specificity', () => {
    expect(isCategoryOnlyQuery('perfume dior')).toBe(false);
    expect(isCategoryOnlyQuery('iphone 16')).toBe(false);
    expect(isCategoryOnlyQuery('lenovo ideapad')).toBe(false);
    expect(isCategoryOnlyQuery('')).toBe(false);
  });
});

describe('specificityHintFor', () => {
  it('returns tip only for category-only queries', () => {
    expect(specificityHintFor('perfume')).toMatch(/marca o modelo/i);
    expect(specificityHintFor('perfume')).toMatch(/Dior/i);
    expect(specificityHintFor('perfume dior')).toBeNull();
  });
});
