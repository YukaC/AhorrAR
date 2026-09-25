/**
 * Crawl node budget scales with requested result cap (§V17 tiers 25/50/100).
 * `cfgMaxNodes` (env MAX_NODES) is a **hard ceiling** — critical on Render Free 512MB.
 * Hard cap matches scraper CrawlRequest.maxNodes (le=400).
 */
export function nodesBudgetFor(maxResults: number, cfgMaxNodes: number, hardCap = 400): number {
  const needed = Math.max(24, maxResults * 4 + 20);
  const ceiling = Math.max(1, Math.min(hardCap, cfgMaxNodes));
  return Math.min(ceiling, needed);
}
