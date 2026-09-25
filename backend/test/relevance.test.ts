import { describe, expect, it } from 'vitest';
import {
  isRelevantResult,
  queryTokens,
  titleMatchesQuery,
  titleRelevanceScore,
} from '../src/search/relevance.ts';

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

  it('perfume exige evidencia de fragancia; marca específica sí', () => {
    expect(queryTokens('perfume de bensimon')).toEqual(['perfume', 'bensimon']);
    expect(titleMatchesQuery('Bensimon Sunset Edp 100ml', 'perfume')).toBe(true);
    expect(titleMatchesQuery('Carolina Herrera 212 Men 100ml', 'perfume')).toBe(true);
    expect(titleMatchesQuery('Perfume Dior Sauvage EDP 100ml', 'perfume')).toBe(true);
    expect(titleMatchesQuery('Crema corporal hidratante 200ml', 'perfume')).toBe(false);
    expect(titleMatchesQuery('Jabon liquido aroma vainilla', 'perfume')).toBe(false);
    expect(
      titleMatchesQuery(
        'Protectores Diarios Always Xtra Diarios Extra Largos Con Perfume X 100 Unid',
        'perfume',
      ),
    ).toBe(false);
    expect(titleMatchesQuery("Toallas Húmedas Johnson's Baby Extra Cuidado X 96 Un", 'perfume')).toBe(
      false,
    );
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

  it('V27/V28: rechaza secundarios universales; acepta producto primario', () => {
    expect(titleMatchesQuery('Notebook Lenovo IdeaPad 15 Intel i5', 'notebook')).toBe(true);
    expect(titleMatchesQuery('Laptop HP Pavilion 14 Ryzen 5', 'notebook')).toBe(true);
    expect(titleMatchesQuery('Memoria RAM DDR4 8GB para Notebook', 'notebook')).toBe(false);
    expect(titleMatchesQuery('Funda Notebook 15.6 Neoprene', 'notebook')).toBe(false);
    expect(titleMatchesQuery('Soporte refrigerante para notebook', 'notebook')).toBe(false);
    expect(titleMatchesQuery('Memoria Kingston Fury 8GB', 'notebook')).toBe(false);
    expect(titleMatchesQuery('Funda Notebook 15.6 Neoprene', 'funda notebook')).toBe(true);
    expect(titleMatchesQuery('Memoria RAM DDR4 8GB Notebook', 'ram notebook')).toBe(true);
    expect(titleMatchesQuery('Muestra tester perfume 5ml', 'perfume')).toBe(false);
    expect(titleMatchesQuery('Crema hidratante Carolina Herrera', 'perfume')).toBe(false);
  });

  it('V29: conflicto cross-class (perfume ≠ notebook/zapatilla)', () => {
    expect(titleMatchesQuery('Notebook Lenovo IdeaPad 15', 'perfume')).toBe(false);
    expect(titleMatchesQuery('Zapatillas Nike Air Max 90', 'perfume')).toBe(false);
    expect(titleMatchesQuery('Perfume Dior Sauvage EDP 100ml', 'notebook')).toBe(false);
  });
});

describe('isRelevantResult', () => {
  it('publica solo matches fuertes (§V29)', () => {
    expect(isRelevantResult('Notebook Lenovo IdeaPad 15 Intel i5', 'notebook')).toBe(true);
    expect(isRelevantResult('Dior Sauvage EDP 100ml', 'perfume')).toBe(true);
    expect(isRelevantResult('Iphone 16 128gb', 'iphone')).toBe(true);
    expect(isRelevantResult('Cable HDMI 2m negro', 'notebook')).toBe(false);
    expect(isRelevantResult('Protectores Diarios Always Con Perfume', 'perfume')).toBe(false);
    expect(isRelevantResult('Zapatillas Nike Revolution', 'perfume')).toBe(false);
  });
});

describe('titleRelevanceScore', () => {
  it('prioriza lead primario sobre secundario débil', () => {
    const primary = titleRelevanceScore('Notebook Lenovo IdeaPad 15', 'notebook');
    const weak = titleRelevanceScore('Cable HDMI 2m negro', 'notebook');
    expect(primary).toBeGreaterThanOrEqual(0.55);
    expect(weak).toBeLessThan(0.55);
  });

  it('perfume real > beauty adjacent', () => {
    const frag = titleRelevanceScore('Dior Sauvage EDP 100ml', 'perfume');
    const cream = titleRelevanceScore('Crema corporal 200ml', 'perfume');
    expect(frag).toBeGreaterThan(cream);
    expect(frag).toBeGreaterThanOrEqual(0.55);
  });
});
