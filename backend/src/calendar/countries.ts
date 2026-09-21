/**
 * Country configuration table (AR, MX, ES). MUST match the contract's
 * CountryConfig shape exactly — runtime source for normalize, shipping and scoring.
 */

import type { CountryCode, CountryConfig } from '../../../shared/contract.ts';

const COUNTRIES: Record<CountryCode, CountryConfig> = {
  AR: {
    code: 'AR',
    name: 'Argentina',
    flag: '🇦🇷',
    currency: 'ARS',
    locale: 'es-AR',
    ccTLD: 'ar',
    domains: [
      'mercadolibre.com.ar',
      'garbarino.com',
      'compragamer.com',
      'fravega.com',
      'musimundo.com',
      'cetrogar.com.ar',
    ],
    marketplaces: ['mercadolibre.com.ar'],
    description: 'Mercado robusto de e-commerce; Hot Sale, Cyber Monday, Beauty Week y ofertas bancarias todo el año.',
  },
  MX: {
    code: 'MX',
    name: 'México',
    flag: '🇲🇽',
    currency: 'MXN',
    locale: 'es-MX',
    ccTLD: 'mx',
    domains: [
      'mercadolibre.com.mx',
      'amazon.com.mx',
      'liverpool.com.mx',
      'coppel.com',
      'walmart.com.mx',
    ],
    marketplaces: ['mercadolibre.com.mx', 'amazon.com.mx'],
    description: 'El Buen Fin y Hot Sale dominan las temporadas de descuentos mexicanas.',
  },
  ES: {
    code: 'ES',
    name: 'España',
    flag: '🇪🇸',
    currency: 'EUR',
    locale: 'es-ES',
    ccTLD: 'es',
    domains: [
      'amazon.es',
      'elcorteingles.es',
      'pccomponentes.com',
      'mediamarkt.es',
      'carrefour.es',
    ],
    marketplaces: ['amazon.es', 'elcorteingles.es'],
    description: 'Black Friday, rebajas de temporada y ofertas de marketplace europeo.',
  },
};

export function getCountry(code: CountryCode): CountryConfig {
  return COUNTRIES[code];
}

export function getAllCountries(): CountryConfig[] {
  return [COUNTRIES.AR, COUNTRIES.MX, COUNTRIES.ES];
}