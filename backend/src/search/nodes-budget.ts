/**
 * Crawl node budget scales with requested result cap (§V17 tiers 25/50/100).
 * Hard cap matches scraper CrawlRequest.maxNodes (le=400).
 */
export function nodesBudgetFor(maxResults: number, cfgMaxNodes: number, hardCap = 400): number {
  const needed = Math.max(24, maxResults * 4 + 20);
  return Math.min(hardCap, Math.max(cfgMaxNodes, needed));
}
