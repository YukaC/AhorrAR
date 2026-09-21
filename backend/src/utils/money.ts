/**
 * money helpers — formatting only, never parsing.
 */

const SYMBOLS: Record<string, string> = { ARS: '$AR', MXN: '$MXN', EUR: '€' };

export function formatPrice(value: number, currency: string, locale: string): string {
  const num = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  const symbol = SYMBOLS[currency] ?? currency;
  return `${num} ${symbol}`;
}