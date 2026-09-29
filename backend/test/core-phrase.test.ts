import { describe, expect, it } from 'vitest';
import {
  corePhraseTokens,
  normalizeText,
  queryInCorePhrase,
  queryTokens,
  isRelevantResult,
} from '../src/search/relevance.ts';

describe('core phrase §V31', () => {
  it('cuts core at connectors (enrollador de cable)', () => {
    const hay = normalizeText('Enrollador de cable auriculares');
    expect(corePhraseTokens(hay)).toEqual(['enrollador']);
    expect(queryInCorePhrase(hay, queryTokens('cable'))).toBe(false);
  });

  it('keeps cable in core for real cable products', () => {
    const hay = normalizeText('Cable USB-C a USB-C 1m carga rápida');
    expect(queryInCorePhrase(hay, queryTokens('cable'))).toBe(true);
    expect(isRelevantResult('Cable USB-C a USB-C 1m carga rápida', 'cable')).toBe(true);
  });

  it('rejects compatible-without-con motherboard for ryzen query', () => {
    expect(
      isRelevantResult('Motherboard AM4 compatible Ryzen 5 5600', 'ryzen 5 5600'),
    ).toBe(false);
  });

  it('rejects brand-only when query has noun+brand', () => {
    expect(isRelevantResult('Medias deportivas Nike', 'zapatillas nike')).toBe(false);
  });

  it('rejects CPU/mouse that only share PC-chip tokens with notebook', () => {
    expect(isRelevantResult('Procesador AMD Ryzen 5 5600GE 3.40GHz AM4 DDR4', 'notebook')).toBe(
      false,
    );
    expect(isRelevantResult('TEC+MOUSE WIRELESS DELL KM526 LATINO', 'notebook')).toBe(false);
  });

  it('strips parenthetical negation for heladera', () => {
    expect(isRelevantResult('Freezer horizontal 200L (no heladera)', 'heladera')).toBe(false);
  });

  it('rejects accessory after repuesto connector for mouse query', () => {
    expect(isRelevantResult('Pies repuesto mouse Logitech', 'mouse')).toBe(false);
  });

  it('soft-penalizes query after two non-noise prior tokens (vidrio templado)', () => {
    expect(isRelevantResult('Vidrio templado iPhone 15', 'iphone 15')).toBe(false);
  });
});
