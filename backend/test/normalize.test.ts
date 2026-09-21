import { describe, expect, it } from 'vitest';
import { getCountry } from '../src/calendar/countries.ts';
import { normalizePrice } from '../src/normalize/price.ts';

const AR = getCountry('AR');
const MX = getCountry('MX');
const ES = getCountry('ES');

describe('normalizePrice', () => {
  it('parses AR dotted thousands with comma decimals', () => {
    expect(normalizePrice('1.249.999,00', AR)).toBe(1_249_999);
    expect(normalizePrice('$1.249.999,00', AR)).toBe(1_249_999);
  });

  it('parses US-style comma thousands with dot decimals', () => {
    expect(normalizePrice('1,249,999.00', AR)).toBe(1_249_999);
    expect(normalizePrice('1,099.99', ES)).toBe(1_099.99);
  });

  it('parses thousands-only values (no decimals)', () => {
    expect(normalizePrice('$1.249.999', AR)).toBe(1_249_999);
    expect(normalizePrice('1,999', MX)).toBe(1_999);
    expect(normalizePrice('12999', AR)).toBe(12_999);
  });

  it('handles "desde" and ranges by taking the lower bound', () => {
    expect(normalizePrice('Desde $1.000.000', AR)).toBe(1_000_000);
    expect(normalizePrice('Desde 999', MX)).toBe(999);
    expect(normalizePrice('500.000 - 750.000', AR)).toBe(500_000);
  });

  it('parses per-country conventions', () => {
    expect(normalizePrice('$18.999,50 MXN', MX)).toBe(18_999.5);
    expect(normalizePrice('1.999,00 €', ES)).toBe(1_999);
    expect(normalizePrice('€ 0,99', ES)).toBe(0.99);
    expect(normalizePrice('US$ 899', AR)).toBe(899);
  });

  it('handles trailing ".00" as decimals', () => {
    expect(normalizePrice('99.00', AR)).toBe(99);
  });

  it('returns null for unparseable / zero / non-positive garbage', () => {
    expect(normalizePrice('', AR)).toBeNull();
    expect(normalizePrice('GRATIS', AR)).toBeNull();
    expect(normalizePrice('sin precio', MX)).toBeNull();
    expect(normalizePrice('abc', AR)).toBeNull();
    expect(normalizePrice('0', AR)).toBeNull();
    expect(normalizePrice('$ 0', ES)).toBeNull();
  });
});