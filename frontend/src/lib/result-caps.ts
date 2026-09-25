/** Allowed result caps for live search UI (§V17). */
export const RESULT_CAPS = [25, 50, 100] as const;
export type ResultCap = (typeof RESULT_CAPS)[number];
export const DEFAULT_RESULT_CAP: ResultCap = 25;

/** Render Free 512MB: keep 25→50, drop 100 (too heavy). */
export const FREE_HOST_RESULT_CAPS = [25, 50] as const satisfies readonly ResultCap[];

export function hostResultCaps(isFreeHost: boolean): readonly ResultCap[] {
  return isFreeHost ? FREE_HOST_RESULT_CAPS : RESULT_CAPS;
}

export function nextResultCap(
  current: number,
  caps: readonly ResultCap[] = RESULT_CAPS,
): ResultCap | null {
  const higher = caps.find((cap) => cap > current);
  return higher ?? null;
}
