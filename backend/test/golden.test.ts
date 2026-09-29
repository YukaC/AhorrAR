import { describe, expect, it } from 'vitest';
import {
  HOLDOUT_DIR,
  TUNING_DIR,
  loadGoldenQueries,
  metricsForQuery,
  summarizeGolden,
} from '../src/golden/metrics.ts';

/** Floor from plan success criteria — must not regress on merge. */
const GOLDEN_P10_FLOOR = 0.877;

describe('golden set T58', () => {
  it('loads tuning fixtures (8–12)', () => {
    const qs = loadGoldenQueries(TUNING_DIR);
    expect(qs.length).toBeGreaterThanOrEqual(8);
    expect(qs.length).toBeLessThanOrEqual(12);
  });

  it('loads sealed holdout fixtures (5–12) — do not tune against these', () => {
    const qs = loadGoldenQueries(HOLDOUT_DIR);
    expect(qs.length).toBeGreaterThanOrEqual(5);
    expect(qs.length).toBeLessThanOrEqual(12);
  });

  it('computes precision@10 and recall for every tuning query', () => {
    const summary = summarizeGolden(loadGoldenQueries(TUNING_DIR), 'tuning');
    expect(summary.queries.length).toBeGreaterThanOrEqual(8);
    for (const row of summary.queries) {
      expect(row.precisionAt10).toBeGreaterThanOrEqual(0);
      expect(row.precisionAt10).toBeLessThanOrEqual(1);
      expect(row.recallAt10).toBeGreaterThanOrEqual(0);
      expect(row.recallAt10).toBeLessThanOrEqual(1);
      expect(row.recallPublished).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(summary.meanPrecisionAt10)).toBe(true);
    expect(Number.isFinite(summary.meanRecallAt10)).toBe(true);
  });

  it(`tuning mean P@10 ≥ ${GOLDEN_P10_FLOOR}`, () => {
    const summary = summarizeGolden(loadGoldenQueries(TUNING_DIR), 'tuning');
    expect(summary.meanPrecisionAt10).toBeGreaterThanOrEqual(GOLDEN_P10_FLOOR);
  });

  it('funda iphone 15 treats cases as product (accessory-intent query)', () => {
    const funda = loadGoldenQueries(TUNING_DIR).find((q) => q.query === 'funda iphone 15');
    expect(funda).toBeDefined();
    const m = metricsForQuery(funda!);
    expect(m.publishedCount).toBeGreaterThan(0);
    expect(m.top10Labels.includes('product')).toBe(true);
  });

  it('zapatillas nike has labeled products and measurable R@10', () => {
    const z = loadGoldenQueries(TUNING_DIR).find((q) => q.query === 'zapatillas nike');
    expect(z).toBeDefined();
    const m = metricsForQuery(z!);
    expect(m.productLabeled).toBeGreaterThan(0);
    // Baseline on main gate (pre–frase núcleo) is high; residual R@10=0.60 is #22 / Fase 4.
    expect(m.recallAt10).toBeGreaterThanOrEqual(0.6);
  });
});
