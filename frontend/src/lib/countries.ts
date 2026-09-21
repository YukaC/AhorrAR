import type { CountryCode } from '../../../shared/contract';

export interface CountryMeta {
  code: CountryCode;
  name: string;
  flag: string;
  locale: string;
  currency: string;
}

export const COUNTRIES: Record<CountryCode, CountryMeta> = {
  AR: { code: 'AR', name: 'Argentina', flag: '🇦🇷', locale: 'es-AR', currency: 'ARS' },
  MX: { code: 'MX', name: 'México', flag: '🇲🇽', locale: 'es-MX', currency: 'MXN' },
  ES: { code: 'ES', name: 'España', flag: '🇪🇸', locale: 'es-ES', currency: 'EUR' },
};

export const COUNTRY_OPTIONS: CountryCode[] = ['AR', 'MX', 'ES'];

export function countryName(code: CountryCode): string {
  return COUNTRIES[code].name;
}