/**
 * Shipping validation — the NON-NEGOTIABLE filter (§V1).
 *
 * STRICT: only confirms shipping when the raw page/seller text makes it
 * provable that the destination country is served. Anything ambiguous or
 * absent → `confirmed: false`, and that result is discarded downstream.
 * Sources of truth: marketplace shipping widgets, seller ship-to lists and
 * observed per-country language hints.
 *
 * Input text has accents stripped and is lowercased before matching, so
 * "Envío" / "envio" both work.
 */

import type { CountryCode, CountryConfig, ShippingInfo } from '../../../shared/contract.ts';

interface CountryPatterns {
  confirmed: RegExp[];
  free: RegExp;
  eta: RegExp;
}

const AR: CountryPatterns = {
  confirmed: [
    /\benvio\s+a\s+todo\s+el\s+pais\b/,
    /\benvios\s+a\s+todo\s+el\s+pais\b/,
    /\benvio\s+a\s+todo\b/,
    /\benvio\s+a\s+domicilio\b/,
    /\benvios?\s+a\s+domicilio\b/,
    /\benvio\s+nacional\b/,
    /\benvios?\s+a\s+argentina\b/,
    /\benvio\s+garantizado\b/,
    /\bmercado\s+envios\b/,
    /\benvio\s+f(ull|lex)\b/,
    /\benvio\s+gratis\b/,
    /\benvio\s+sin\s+cargo\b/,
    /\benvio\s+en\s+24|48\s*hs?\b/,
    /\bfull\b/,
  ],
  free: /gratis|sin\s+cargo|sin\s+costo|free/,
  eta: /\b(\d{1,2})\s*(?:a|a\s*lo\s*sumo|[-–])?\s*(\d{1,2})?\s*dias?\s*(?:habiles)?\b|\b(24|48)\s*hs?\b/,
};

const MX: CountryPatterns = {
  confirmed: [
    /\benvio?\s+a\s+todo\s+mexico\b/,
    /\benvios?\s+a\s+todo\s+mexico\b/,
    /\benvios?\s+a\s+mexico\b/,
    /\benvio\s+nacional\b/,
    /\benvio\s+garantizado\b/,
    /\benvio\s+f(ull|\s?)\b/,
    /\benvio\s+gratis\b/,
    /\benvio\s+full\b/,
    /\benvio\s+sin\s+costo\b/,
    /\benvio\s+en\s+24|48\s*hs?\b/,
    /\bfull\b/,
  ],
  free: /gratis|en\s+pedidos\s+\+|sin\s+costo|free/,
  eta: /\b(\d{1,2})\s*(?:a\s*lo\s+sumo|a|[-–])?\s*(\d{1,2})?\s*dias?\s*(?:habiles)?\b|\b(24|48)\s*hs?\b/,
};

const ES: CountryPatterns = {
  confirmed: [
    /\benvio?\s+(?:gratis\s+)?(?:a\s+toda\s+espana)\b/,
    /\benvios?\s+(?:a\s+(?:toda\s+)?espana)\b/,
    /\benvio\s+nacional\b/,
    /\benvio\s+a\s+toda\s+la\s+peninsula\b/,
    /\benvio\s+en\s+24\s*(?:h|horas)?\b/,
    /\benvio\s+gratis\b/,
    /\benvio\s+gratuito\b/,
    /\bgastos\s+de\s+envio\s+incluidos\b/,
    /\benvio\s+a\s+(?:tu\s+)?domicilio\b/,
    /\bfree\s+shipping\b/,
  ],
  free: /gratis|gratuito|sin\s+gastos|incluidos|free/,
  eta: /\b(\d{1,2})\s*(?:a\s*lo\s+sumo|a|[-–])?\s*(\d{1,2})?\s*(?:dias?|horas?|h)\s*(?:habiles)?\b|\ben\s+24\s*h\b/,
};

const INTERNATIONAL: CountryPatterns = {
  confirmed: [
    /\bshipping\s+to\s+(argentina|mexico|spain|espana)\b/,
    /\benvios?\s+internacionales\b/,
    /\bdelivery\s+to\s+(argentina|mexico|spain)\b/,
    /\benvio\s+internacional\b/,
    /\bships\s+to\s+(argentina|mexico|spain)\b/,
  ],
  free: /free\s+shipping|gratis|sin\s+cargo/,
  eta: /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:business\s+)?days?|(\d{1,2})\s*[-–]\s*(\d{1,2})\s*dias?/,
};

const PATTERNS: Record<CountryCode, CountryPatterns> = { AR, MX, ES };

function deaccent(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function captureEta(text: string, p: CountryPatterns): string | undefined {
  const m = p.eta.exec(text);
  if (m === null) return undefined;
  const a = m[1];
  const b = m[2];
  if (a !== undefined && b !== undefined && a !== b) return `${a}-${b} días`;
  if (a !== undefined) return `${a} día${a === '1' ? '' : 's'}`;
  return undefined;
}

export function validateShipping(
  country: CountryConfig,
  raw: string | null | undefined,
  isLocal: boolean,
): ShippingInfo {
  const type = isLocal ? 'local' : 'international';
  const base: ShippingInfo = { confirmed: false, country: country.code, type };
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { ...base };
  }

  const text = deaccent(raw);
  const patterns = isLocal ? PATTERNS[country.code] : INTERNATIONAL;
  if (patterns === undefined) return { ...base };

  const confirmed = patterns.confirmed.some((re) => re.test(text));
  if (!confirmed) return { ...base };

  const free = patterns.free.test(text);
  const eta = captureEta(text, patterns);
  const note = isLocal ? 'Envío confirmado al país destino' : 'Envío internacional confirmado';

  return { confirmed: true, country: country.code, type, free, eta, note };
}