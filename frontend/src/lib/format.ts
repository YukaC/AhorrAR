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

/** Casing correcto de marcas/tokens que el title-case ingenuo rompería. */
const BRAND_CASING: Record<string, string> = {
  iphone: 'iPhone', ipad: 'iPad', imac: 'iMac', macbook: 'MacBook', mac: 'Mac',
  airpods: 'AirPods', applewatch: 'Apple Watch', apple: 'Apple',
  playstation: 'PlayStation', ps5: 'PS5', ps4: 'PS4', xbox: 'Xbox', nintendo: 'Nintendo', switch: 'Switch',
  ryzen: 'Ryzen', core: 'Core', intel: 'Intel', amd: 'AMD', nvidia: 'NVIDIA', geforce: 'GeForce',
  rtx: 'RTX', gtx: 'GTX', oled: 'OLED', led: 'LED', lcd: 'LCD',
  wifi: 'WiFi', bluetooth: 'Bluetooth', usb: 'USB', hdmi: 'HDMI', ssd: 'SSD', hdd: 'HDD', ram: 'RAM', cpu: 'CPU', gpu: 'GPU',
  lg: 'LG', hp: 'HP', msi: 'MSI', asus: 'ASUS', acer: 'Acer', dell: 'Dell', lenovo: 'Lenovo',
  logitech: 'Logitech', samsung: 'Samsung', galaxy: 'Galaxy', xiaomi: 'Xiaomi', redmi: 'Redmi',
  huawei: 'Huawei', motorola: 'Motorola', nokia: 'Nokia', sony: 'Sony', gigabyte: 'Gigabyte',
  hyperx: 'HyperX', razer: 'Razer', corsair: 'Corsair', kingston: 'Kingston', seagate: 'Seagate',
  wd: 'WD', 'tp-link': 'TP-Link', epson: 'Epson', canon: 'Canon', nikon: 'Nikon', gopro: 'GoPro',
  android: 'Android', ios: 'iOS', windows: 'Windows', google: 'Google', youtube: 'YouTube',
  mercadolibre: 'MercadoLibre', fravega: 'Frávega', garbarino: 'Garbarino', musimundo: 'Musimundo',
};

/**
 * Nombre de producto legible: deja intactos los nombres ya mixtos (marcas como
 * "iPhone 16") y normaliza los que llegan TODO EN MAYÚSCULAS a title-case
 * preservando el casing de marcas conocidas.
 */
export function displayName(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => BRAND_CASING[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

/** Cuenta regresiva compacta: "2d 14h 03m 12s" (o "hoy" si ya llegó). */
export function formatCountdown(parts: CountdownParts): string {
  if (parts.total <= 0) return 'hoy';
  const hh = String(parts.hours).padStart(2, '0');
  const mm = String(parts.minutes).padStart(2, '0');
  const ss = String(parts.seconds).padStart(2, '0');
  return parts.days > 0 ? `${parts.days}d ${hh}h ${mm}m ${ss}s` : `${hh}h ${mm}m ${ss}s`;
}

const COUNTRY_TO_LOCALE: Record<CountryCode, string> = {
  AR: 'es-AR',
  MX: 'es-MX',
  ES: 'es-ES',
};

export function countryLocale(code: CountryCode): string {
  return COUNTRY_TO_LOCALE[code];
}