/**
 * Per-country commercial calendar engine. All dates are computed from
 * recurrence RULES for any year — nothing is hardcoded to a specific year
 * (§V7: never invent dates; everything derives from the static rule table).
 *
 * All functions accept an injected reference `Date`, interpreted in UTC, so
 * tests are deterministic on any machine/timezone.
 */

import type { CountryCode, EventInfo, EventPeriod } from '../../../shared/contract.ts';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nth'; month: number; weekday: Weekday; nth: number }
  | { kind: 'onOrBefore'; month: number; day: number; weekday: Weekday }
  | { kind: 'nextWeekday'; after: DateRule; weekday: Weekday };

export interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

export interface RecurringEvent {
  name: string;
  description: string;
  country: CountryCode;
  startRule: DateRule;
  durationDays: number;
  seasonWindow?: { beforeDays: number; afterDays: number };
  seasonName?: string;
}

export interface EventOccurrence {
  name: string;
  description: string;
  country: CountryCode;
  start: Ymd;
  end: Ymd;
  season?: EventPeriod;
}

export interface NextEvent {
  name: string;
  date: string;
  daysLeft: number;
}

const DAY_MS = 86_400_000;

const DAYS: Record<Weekday, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

/** IANA TZ for commercial “hoy” — §V7 must match local calendar of the country. */
const COUNTRY_TZ: Record<CountryCode, string> = {
  AR: 'America/Argentina/Buenos_Aires',
  MX: 'America/Mexico_City',
  ES: 'Europe/Madrid',
};

export function weekdayName(w: Weekday): string {
  return DAYS[w];
}

/* ------------------------------------------------------------------------ */
/* Pure date helpers (UTC-based rules; “hoy” en TZ del país)                 */
/* ------------------------------------------------------------------------ */

function ymdFromDate(date: Date): Ymd {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Calendar day of `date` in the country's timezone (not UTC). */
export function ymdInCountry(date: Date, country: CountryCode): Ymd {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: COUNTRY_TZ[country],
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: num('year'), m: num('month'), d: num('day') };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDate(ymd: Ymd): string {
  return `${ymd.y}-${pad2(ymd.m)}-${pad2(ymd.d)}`;
}

export function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
}

function daysInMonth(y: number, m: number): number {
  // Day 0 of month index `m` (0-based) = last day of month `m`.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekday(y: number, m: number, d: number): Weekday {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

function addDays(ymd: Ymd, delta: number): Ymd {
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d) + delta * DAY_MS;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

export function toYmdLocal(date: Date): Ymd {
  return ymdFromDate(date);
}

/* ------------------------------------------------------------------------ */
/* Rule resolution                                                          */
/* ------------------------------------------------------------------------ */

export function resolveRule(rule: DateRule, year: number): Ymd | null {
  switch (rule.kind) {
    case 'fixed': {
      if (rule.month < 1 || rule.month > 12) return null;
      if (rule.day < 1 || rule.day > daysInMonth(year, rule.month)) return null;
      return { y: year, m: rule.month, d: rule.day };
    }
    case 'onOrBefore': {
      if (rule.month < 1 || rule.month > 12) return null;
      const cap = Math.min(rule.day, daysInMonth(year, rule.month));
      if (cap < 1) return null;
      const wd = weekday(year, rule.month, cap);
      const back = (wd - rule.weekday + 7) % 7;
      const d = cap - back;
      if (d < 1) return null;
      return { y: year, m: rule.month, d };
    }
    case 'nth': {
      if (rule.month < 1 || rule.month > 12) return null;
      const dim = daysInMonth(year, rule.month);
      if (rule.nth >= 1) {
        const firstWd = weekday(year, rule.month, 1);
        const first = 1 + ((rule.weekday - firstWd + 7) % 7);
        const d = first + (rule.nth - 1) * 7;
        if (d > dim) return null; // "fourth Friday" may not exist in a given year
        return { y: year, m: rule.month, d };
      }
      if (rule.nth === -1) {
        const lastWd = weekday(year, rule.month, dim);
        const back = (lastWd - rule.weekday + 7) % 7;
        return { y: year, m: rule.month, d: dim - back };
      }
      return null;
    }
    case 'nextWeekday': {
      const base = resolveRule(rule.after, year);
      if (base === null) return null;
      const wd = weekday(base.y, base.m, base.d);
      const fwd = (rule.weekday - wd + 7) % 7;
      return addDays(base, fwd);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Event table (recurrence rules per country)                               */
/* ------------------------------------------------------------------------ */

export const EVENTS: RecurringEvent[] = [
  // -- AR (primary) -------------------------------------------------------
  {
    name: 'Hot Sale AR',
    country: 'AR',
    description: 'Tres días de descuentos del e-commerce argentino.',
    startRule: { kind: 'nth', month: 5, weekday: 1, nth: 1 },
    durationDays: 3,
  },
  {
    name: 'Cyber Monday AR',
    country: 'AR',
    description: 'Fin de semana largo de ofertas online organizado por la CACE.',
    startRule: { kind: 'nth', month: 11, weekday: 1, nth: 1 },
    durationDays: 3,
    seasonWindow: { beforeDays: 3, afterDays: 3 },
    seasonName: 'Cyber Week',
  },
  {
    name: 'Black Friday AR',
    country: 'AR',
    description: 'Descuentos al estilo estadounidense durante el fin de noviembre.',
    startRule: { kind: 'nth', month: 11, weekday: 5, nth: 4 },
    durationDays: 1,
  },
  {
    name: 'Mes del Niño',
    country: 'AR',
    description: 'Mes de regalos infantiles (Día del Niño en agosto).',
    startRule: { kind: 'fixed', month: 8, day: 1 },
    durationDays: 31,
    seasonName: 'Mes del Niño',
  },
  {
    name: 'Beauty Week AR',
    country: 'AR',
    description: 'Semana de descuentos en cosmética, perfumería e higiene (CAPA).',
    // 2026: 14–20 sep = 2º lunes de septiembre, 7 días.
    startRule: { kind: 'nth', month: 9, weekday: 1, nth: 2 },
    durationDays: 7,
    seasonWindow: { beforeDays: 7, afterDays: 0 },
    seasonName: 'Beauty Week',
  },
  // -- MX ------------------------------------------------------------------
  {
    name: 'El Buen Fin',
    country: 'MX',
    description: 'El fin de semana con mayores descuentos del año.',
    startRule: { kind: 'onOrBefore', month: 11, day: 20, weekday: 5 },
    durationDays: 4,
    seasonWindow: { beforeDays: 31, afterDays: 0 },
    seasonName: 'El Mes del Buen Fin',
  },
  {
    name: 'Hot Sale MX',
    country: 'MX',
    description: 'La temporada de descuentos online mexicana.',
    startRule: { kind: 'nth', month: 6, weekday: 1, nth: 1 },
    durationDays: 3,
  },
  {
    name: 'Cyber Monday MX',
    country: 'MX',
    description: 'Long weekend de ofertas en línea en noviembre.',
    startRule: { kind: 'nth', month: 11, weekday: 5, nth: 4 },
    durationDays: 4,
  },
  // -- ES ------------------------------------------------------------------
  {
    name: 'Black Friday ES',
    country: 'ES',
    description: 'El viernes negro, previo a la campaña navideña.',
    startRule: { kind: 'nth', month: 11, weekday: 5, nth: 4 },
    durationDays: 1,
  },
  {
    name: 'Cyber Monday ES',
    country: 'ES',
    description: 'El lunes de ofertas online posterior al Black Friday.',
    startRule: { kind: 'nextWeekday', after: { kind: 'nth', month: 11, weekday: 5, nth: 4 }, weekday: 1 },
    durationDays: 1,
  },
  {
    name: 'Rebajas de verano',
    country: 'ES',
    description: 'Rebajas de temporada de verano.',
    startRule: { kind: 'fixed', month: 7, day: 1 },
    durationDays: 31,
  },
  {
    name: 'Rebajas de invierno',
    country: 'ES',
    description: 'Rebajas de temporada de invierno.',
    startRule: { kind: 'fixed', month: 1, day: 7 },
    durationDays: 31,
  },
  {
    name: 'Vuelta al cole',
    country: 'ES',
    description: 'Ofertas de vuelta al cole y material escolar.',
    startRule: { kind: 'nth', month: 9, weekday: 1, nth: 1 },
    durationDays: 14,
    seasonWindow: { beforeDays: 7, afterDays: 7 },
  },
];

export function resolveEvent(ev: RecurringEvent, year: number): EventOccurrence | null {
  const start = resolveRule(ev.startRule, year);
  if (start === null) return null;
  const end = addDays(start, ev.durationDays - 1);
  let season: EventPeriod | undefined;
  if (ev.seasonWindow !== undefined) {
    const seasonStart = addDays(start, -ev.seasonWindow.beforeDays);
    const seasonEnd = addDays(end, ev.seasonWindow.afterDays);
    season = { name: ev.seasonName ?? ev.name, start: isoDate(seasonStart), end: isoDate(seasonEnd) };
  }
  return { name: ev.name, description: ev.description, country: ev.country, start, end, season };
}

/* ------------------------------------------------------------------------ */
/* Public queries                                                           */
/* ------------------------------------------------------------------------ */

function inRange(ymd: Ymd, start: Ymd, end: Ymd): boolean {
  return daysBetween(start, ymd) >= 0 && daysBetween(ymd, end) >= 0;
}

export interface ActiveEvent {
  name: string;
  date: string;
  endDate?: string;
  description?: string;
}

/** All events active on `when` (inclusive), for a country. */
export function eventsOn(when: Date, country: CountryCode): ActiveEvent[] {
  const ymd = ymdInCountry(when, country);
  const active: ActiveEvent[] = [];
  for (const ev of EVENTS) {
    if (ev.country !== country) continue;
    const occ = resolveEvent(ev, ymd.y);
    if (occ !== null && inRange(ymd, occ.start, occ.end)) {
      active.push({
        name: occ.name,
        date: isoDate(occ.start),
        endDate: isoDate(occ.end),
        description: occ.description,
      });
    }
  }
  return active;
}

/** Season/period active on `when` (e.g. Cyber Week), or null. */
export function activeSeason(when: Date, country: CountryCode): EventPeriod | null {
  const ymd = ymdInCountry(when, country);
  for (const ev of EVENTS) {
    if (ev.country !== country || ev.seasonWindow === undefined) continue;
    const occ = resolveEvent(ev, ymd.y);
    if (occ?.season === undefined) continue;
    const [sy, sm, sd] = occ.season.start.split('-').map(Number);
    const [ey, em, ed] = occ.season.end.split('-').map(Number);
    const s: Ymd = { y: sy ?? 0, m: sm ?? 1, d: sd ?? 1 };
    const e: Ymd = { y: ey ?? 0, m: em ?? 1, d: ed ?? 1 };
    if (inRange(ymd, s, e)) return occ.season;
  }
  return null;
}

/** First upcoming event strictly after `after` (annual recurrence). */
export function nextEvent(after: Date, country: CountryCode): NextEvent {
  const afterYmd = ymdInCountry(after, country);
  let best: { date: Ymd; name: string } | null = null;
  for (const year of [afterYmd.y, afterYmd.y + 1]) {
    for (const ev of EVENTS) {
      if (ev.country !== country) continue;
      const occ = resolveEvent(ev, year);
      if (occ === null) continue;
      if (daysBetween(afterYmd, occ.start) > 0 && (best === null || daysBetween(afterYmd, occ.start) < daysBetween(afterYmd, best.date))) {
        best = { date: occ.start, name: occ.name };
      }
    }
    if (best !== null) break;
  }
  if (best === null) {
    // Defensive: yearly recurrence guarantees at least one event exists (AR has ≥4).
    return { name: 'Hot Sale AR', date: isoDate(afterYmd), daysLeft: 0 };
  }
  return { name: best.name, date: isoDate(best.date), daysLeft: daysBetween(afterYmd, best.date) };
}

/** Next `limit` upcoming events; used by the calendar endpoint. */
export function upcomingEvents(country: CountryCode, after: Date, limit = 3): NextEvent[] {
  const out: NextEvent[] = [];
  let cursor = after;
  while (out.length < limit) {
    const n = nextEvent(cursor, country);
    if (n.daysLeft === 0 && n.name === 'Hot Sale AR' && out.length === 0) break; // sentinel, defensive
    out.push(n);
    // Noon UTC keeps the same calendar day in AR/MX/ES; nextEvent skips starts ≤ that day.
    const [y, m, d] = n.date.split('-').map(Number);
    cursor = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
  }
  return out;
}

/** One EventInfo object, ready for the contract. */
export function buildEventInfo(when: Date, country: CountryCode): EventInfo {
  const on = eventsOn(when, country);
  const season = activeSeason(when, country);
  const nxt = nextEvent(when, country);
  const result: EventInfo = {
    activeToday: on.length > 0 || season !== null,
    nextEvent: nxt,
  };
  if (on.length > 0) {
    const first = on[0]!;
    result.eventToday = {
      name: first.name,
      date: first.date,
      endDate: first.endDate,
      description: first.description,
    };
  }
  if (season !== null) result.season = season;
  return result;
}

/** Flat event list for a full year (calendar endpoint). */
export function describeCountryEvents(country: CountryCode, year: number): Array<{ name: string; description: string; start: string; end: string }> {
  const out: Array<{ name: string; description: string; start: string; end: string }> = [];
  for (const ev of EVENTS) {
    if (ev.country !== country) continue;
    const occ = resolveEvent(ev, year);
    if (occ === null) continue;
    out.push({ name: occ.name, description: occ.description, start: isoDate(occ.start), end: isoDate(occ.end) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}