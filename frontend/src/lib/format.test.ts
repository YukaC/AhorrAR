import { describe, expect, it } from 'vitest';
import {
  displayName,
  formatCountdown,
  formatDaysLeft,
  formatPrice,
  storeHost,
  storeInitials,
} from './format';

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
    expect(formatPrice(Number.NaN, 'ARS', 'es-AR')).toBe('N/D');
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
    expect(storeInitials('   ')).toBe('?');
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

describe('displayName', () => {
  it('deja intactos los nombres ya mixtos (marcas)', () => {
    expect(displayName('Apple iPhone 16 128GB Negro')).toBe('Apple iPhone 16 128GB Negro');
  });
  it('normaliza TODO MAYÚSCULAS a title-case', () => {
    expect(displayName('NOTEBOOK LENOVO IDEAPAD 15 RYZEN 5')).toBe(
      'Notebook Lenovo Ideapad 15 Ryzen 5',
    );
  });
  it('preserva el casing de marcas conocidas', () => {
    expect(displayName('PLAYSTATION 5')).toBe('PlayStation 5');
    expect(displayName('RTX 4060')).toBe('RTX 4060');
    expect(displayName('FRÁVEGA')).toBe('Frávega');
  });
  it('maneja tokens cortos y numéricos', () => {
    expect(displayName('X')).toBe('X');
    expect(displayName('G203')).toBe('G203');
  });
});

describe('formatCountdown', () => {
  it('formatea días, horas, minutos y segundos', () => {
    expect(formatCountdown({ days: 2, hours: 14, minutes: 3, seconds: 12, total: 1 })).toBe(
      '2d 14h 03m 12s',
    );
  });
  it('omite los días cuando no quedan', () => {
    expect(formatCountdown({ days: 0, hours: 5, minutes: 0, seconds: 9, total: 1 })).toBe(
      '05h 00m 09s',
    );
  });
  it('dice "hoy" cuando ya llegó', () => {
    expect(formatCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 })).toBe('hoy');
  });
});