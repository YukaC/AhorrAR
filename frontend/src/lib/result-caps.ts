/** Allowed result caps for live search UI (§V17). */
export const RESULT_CAPS = [25, 50, 100] as const;
export type ResultCap = (typeof RESULT_CAPS)[number];
export const DEFAULT_RESULT_CAP: ResultCap = 25;

export function nextResultCap(current: number): ResultCap | null {
  const higher = RESULT_CAPS.find((cap) => cap > current);
  return higher ?? null;
}
