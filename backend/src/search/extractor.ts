/**
 * Per-site parser dispatch. RAW extraction (name, price text, shipping hints,
 * links) — normalization, shipping and scoring always run downstream in the
 * shared pipeline (DRY, §C).
 */

import type { SearchParams } from '../../../shared/contract.ts';
import { parsePage as parseAmazon } from './parsers/amazon.ts';
import { parsePage as parseGeneric } from './parsers/generic.ts';
import { parsePage as parseMercadoLibre } from './parsers/mercadolibre.ts';
import { isMercadoLibreApiUrl, parseMercadoLibreApi } from './parsers/mercadolibre-api.ts';
import { isVtexCatalogApiUrl, parseVtexCatalogApi } from './parsers/vtex-api.ts';
import { isChallengePage, looksLikeVtex, parsePage as parseVtex } from './parsers/vtex.ts';
import type { ExtractResult } from './types.ts';

export function extractPage(url: string, html: string, params: SearchParams): ExtractResult {
  if (isChallengePage(html)) return { results: [], links: [] };

  if (isVtexCatalogApiUrl(url)) return parseVtexCatalogApi(url, html, params);
  if (isMercadoLibreApiUrl(url)) return parseMercadoLibreApi(url, html, params);

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return { results: [], links: [] };
  }
  if (/mercadolibre/i.test(host)) return parseMercadoLibre(url, html, params);
  if (/amazon\./i.test(host)) return parseAmazon(url, html, params);
  if (looksLikeVtex(host, html)) return parseVtex(url, html, params);
  return parseGeneric(url, html, params);
}
