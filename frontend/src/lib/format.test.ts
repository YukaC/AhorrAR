import { describe, expect, it } from 'vitest';
import { formatDaysLeft, formatPrice, storeHost, storeInitials } from './format';

// Intl.NumberFormat inserta NBSP/espacios finos según ICU: los asserts
// validan símbolo + agrupación, no la cadena exacta con espacio.

describe('formatPrice', () => {
  it('formatea pesos argentinos (ARS, es-AR)', () => {
    expect(formatPrice(1249999, 'ARS', 'es-AR')).toMatch(/\$/);
    expect(formatPrice(1249999, 'ARS', 'es-AR')).toMatch(/1\.249\.999/);
    expect(formatPrice(1249999, 'ARS', 'es-AR')).toMatch(/,00/);
  });

  it('formatea pesos mexicanos (MXN, es-MX)', () => {
    const out = formatPrice(12999, 'MXN', 'es-MX');
    expect(out).toMatch(/\$/);
    expect(out).toMatch(/12,999/);
  });

  it('formatea euros (EUR, es-ES)', () => {
    const out = formatPrice(899, 'EUR', 'es-ES');
    expect(out).toMatch(/€/);
    expect(out).toMatch(/899/);
  });

  it('soporta valores no finitos', () => {
    expect(formatPrice(Number.NaN, 'ARS', 'es-AR')).toBe('—');
  });
});

describe('formatDaysLeft', () => {
  it('hoy', () => {
    expect(formatDaysLeft(0)).toBe('hoy');
  });
  it('mañana', () => {
    expect(formatDaysLeft(1)).toBe('mañana');
  });
  it('varios días', () => {
    expect(formatDaysLeft(68)).toBe('en 68 días');
  });
});

describe('storeInitials', () => {
  it('dos palabras', () => {
    expect(storeInitials('Mercado Libre')).toBe('ML');
  });
  it('una palabra larga', () => {
    expect(storeInitials('Amazon')).toBe('AM');
  });
  it('vacío', () => {
    expect(storeInitials('   ')).toBe('🏪');
  });
});

describe('storeHost', () => {
  it('quita el www', () => {
    expect(storeHost('https://www.mercadolibre.com.ar/')).toBe('mercadolibre.com.ar');
  });
  it('URL inválida', () => {
    expect(storeHost('no-es-url')).toBe('no-es-url');
  });
});