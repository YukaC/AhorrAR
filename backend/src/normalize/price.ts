/**
 * Price normalization from localized, human-formatted strings.
 *
 * Handles both separator conventions (dot/comma for thousands vs decimals),
 * "desde" prefixes, ranges (takes the lower bound), currency symbols/tokens,
 * and trailing ".00". Currency is ALWAYS forced to the destination country
 * elsewhere (currency-force rule, §V2) — this function only returns the
 * numeric value. Never returns NaN/0/negative: `null` when unparseable.
 */

import type { CountryConfig } from '../../../shared/contract.ts';

const CURRENCY_TOKENS =
  /\b(?:ars|mxn|eur|usd|u?s?\$|pesos|pesos mexicanos|dólares|dolares|euros|centavos|cents?)\b/gi;

function stripCurrency(raw: string): string {
  return raw
    .replace(CURRENCY_TOKENS, ' ')
    .replace(/[$€£¥\u20AC\u00A2]/g, ' ');
}

function extractNumeric(body: string): string | null {
  // First contiguous run of digits with separators (., space).
  const match = /([\d][\d\s.,]*\d)/.exec(body);
  return match === null ? null : match[1]!.replace(/\s+/g, '');
}

/**
 * Interpret a digit string using the destinations' separator conventions.
 * Returns a positive finite number or null.
 */
function parseDigits(digits: string): number | null {
  if (!/^\d[0-9.,]*$/.test(digits)) return null;

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');

  let integerPart: string;
  let fraction = '';

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the rightmost separator is the decimal marker.
    const decimalIdx = Math.max(lastDot, lastComma);
    const thousandsSep = decimalIdx === lastDot ? ',' : '.';
    integerPart = digits.slice(0, decimalIdx).split(thousandsSep).join('');
    fraction = digits.slice(decimalIdx + 1);
  } else if (lastDot !== -1) {
    const runs = digits.split('.');
    if (runs.length === 2 && runs[1]!.length <= 2) {
      // Single dot with ≤2 trailing digits → decimal (e.g. 1299.99 US-style).
      integerPart = runs[0]!;
      fraction = runs[1]!;
    } else {
      // Dots as grouping: 1.249.999 (AR convention), or single dot + 3 digits.
      integerPart = runs.join('');
    }
  } else if (lastComma !== -1) {
    const runs = digits.split(',');
    if (runs.length === 2 && runs[1]!.length <= 2) {
      integerPart = runs[0]!;
      fraction = runs[1]!;
    } else {
      integerPart = runs.join('');
    }
  } else {
    integerPart = digits;
  }

  if (!/^\d+$/.test(integerPart)) return null;
  if (fraction !== '' && !/^\d+$/.test(fraction)) return null;

  const fracValue = fraction === '' ? 0 : Number(fraction) / 10 ** fraction.length;
  const price = Number(integerPart) + fracValue;
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price * 100) / 100;
}

export function normalizePrice(rawLocalized: string, _country: CountryConfig): number | null {
  if (typeof rawLocalized !== 'string') return null;
  let text = rawLocalized.trim();
  if (text === '') return null;

  text = stripCurrency(text);

  // Ranges: "desde X", "X - Y", "entre X y Y" → take the LOWER bound.
  const rangeMatch = /(?:desde|hasta|entre|por|precio|oferta|solo)\s+([\d][\d\s.,]*\d)\s*(?:[-–—]|\ba\b|\by\b)?\s*([\d][\d\s.,]*\d)?/i.exec(text);
  const candidate = rangeMatch !== null && rangeMatch[1] !== undefined ? rangeMatch[1] : extractNumeric(text);
  if (candidate === null) return null;
  const price = parseDigits(candidate);
  if (price !== null) return price;
  // Fall back to a plain first-usable numeric run.
  const fallback = extractNumeric(text);
  if (fallback === null) return null;
  return parseDigits(fallback);
}