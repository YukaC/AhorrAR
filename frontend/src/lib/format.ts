import type { CountryCode } from '../../../shared/contract';

/**
 * Formatea un precio en la moneda/localidad dada (Intl.NumberFormat).
 * Ej: formatPrice(1249999, 'ARS', 'es-AR') → "$ 1.249.999,00".
 */
export function formatPrice(value: number, currency: string, locale: string): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale)}`;
  }
}

/** Días restantes hasta un evento, en texto corto en español. */
export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft === 0) return 'hoy';
  if (daysLeft === 1) return 'mañana';
  return `en ${daysLeft} días`;
}

/** Iniciales de la tienda, para el fallback de "logo" (avatar por iniciales). */
export function storeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '🏪';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Host de un URL de tienda, para mostrar "vía tienda.com". */
export function storeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const COUNTRY_TO_LOCALE: Record<CountryCode, string> = {
  AR: 'es-AR',
  MX: 'es-MX',
  ES: 'es-ES',
};

export function countryLocale(code: CountryCode): string {
  return COUNTRY_TO_LOCALE[code];
}