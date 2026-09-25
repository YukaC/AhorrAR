import { describe, expect, it } from 'vitest';
import { queryTokens, titleMatchesQuery } from '../src/search/relevance.ts';

describe('titleMatchesQuery', () => {
  it('filtra TVs fuera de pulgadas y acepta match de modelo', () => {
    expect(titleMatchesQuery('Procesador AMD Ryzen 5 5600 6/12', 'ryzen 5 5600')).toBe(true);
    expect(titleMatchesQuery('Procesador AMD Ryzen 5 5600GT', 'ryzen 5 5600')).toBe(true);
    expect(titleMatchesQuery('TV BGH HD 32" Android TV', 'smart tv 55')).toBe(false);
    expect(titleMatchesQuery('Smart TV 55" Samsung Crystal 4K', 'smart tv 55')).toBe(true);
  });

  it('no deja que un dígito suelto matchee dentro de otro número', () => {
    expect(titleMatchesQuery('AMD Ryzen 5600', 'ryzen 5 5600')).toBe(false);
    expect(titleMatchesQuery('AMD Ryzen 5 5600', 'ryzen 5 5600')).toBe(true);
  });

  it('categoría sola no bloquea; marca específica sí', () => {
    expect(queryTokens('perfume de bensimon')).toEqual(['perfume', 'bensimon']);
    expect(titleMatchesQuery('EDT Agua Fresca x 120 ml', 'perfume')).toBe(true);
    expect(titleMatchesQuery('Bensimon Sunset Edp 100ml', 'perfume bensimon')).toBe(true);
    expect(titleMatchesQuery('EDT Agua Fresca x 120 ml', 'perfume bensimon')).toBe(false);
  });

  it('marca/modelo solo exige substring; irrelevantes fuera', () => {
    expect(titleMatchesQuery('Iphone 16 128gb', 'iphone')).toBe(true);
    expect(titleMatchesQuery('Apple iPhone 17 256 GB', 'iphone')).toBe(true);
    expect(titleMatchesQuery('Bafle Philips TAX2706 77', 'iphone')).toBe(false);
    expect(titleMatchesQuery('Samsung Galaxy S24', 'iphone')).toBe(false);
    expect(titleMatchesQuery('Bafle Philips TAX2706 77', 'iphone 16')).toBe(false);
  });
});
