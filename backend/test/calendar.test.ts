import { describe, expect, it } from 'vitest';
import { getCountry } from '../src/calendar/countries.ts';
import {
  activeSeason,
  buildEventInfo,
  describeCountryEvents,
  eventsOn,
  nextEvent,
  upcomingEvents,
} from '../src/calendar/events.ts';

function dst(y: number, m: number, d: number): Date {
  // Noon UTC → still the same calendar day in AR/MX/ES (ymdInCountry).
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

const AR = 'AR';
const MX = 'MX';
const ES = 'ES';

describe('calendar — recurrence rules (UTC, fixed reference dates)', () => {
  it('Hot Sale AR = first Monday of May (2026 → 05-04)', () => {
    const on = eventsOn(dst(2026, 5, 4), AR);
    expect(on.some((e) => e.name === 'Hot Sale AR')).toBe(true);
    const ended = eventsOn(dst(2026, 5, 7), AR);
    expect(ended.some((e) => e.name === 'Hot Sale AR')).toBe(false);
  });

  it('Cyber Monday AR = first Monday of November, with a Cyber Week season', () => {
    const on = eventsOn(dst(2026, 11, 2), AR);
    expect(on.some((e) => e.name === 'Cyber Monday AR')).toBe(true);
    const season = activeSeason(dst(2026, 11, 5), AR);
    expect(season).not.toBeNull();
    expect(season!.name).toBe('Cyber Week');
    expect(season!.start).toBe('2026-10-30');
    expect(season!.end).toBe('2026-11-07');
    expect(activeSeason(dst(2026, 11, 20), AR)).toBeNull();
  });

  it('Beauty Week AR = 2º lunes de septiembre, 7 días (2026 → 09-14..09-20)', () => {
    expect(eventsOn(dst(2026, 9, 14), AR).some((e) => e.name === 'Beauty Week AR')).toBe(true);
    expect(eventsOn(dst(2026, 9, 20), AR).some((e) => e.name === 'Beauty Week AR')).toBe(true);
    expect(eventsOn(dst(2026, 9, 13), AR).some((e) => e.name === 'Beauty Week AR')).toBe(false);
    expect(eventsOn(dst(2026, 9, 21), AR).some((e) => e.name === 'Beauty Week AR')).toBe(false);
    // 23:30 ART del 20 = 02:30 UTC del 21 — sigue siendo 20 en Buenos Aires.
    expect(eventsOn(new Date('2026-09-21T02:30:00Z'), AR).some((e) => e.name === 'Beauty Week AR')).toBe(true);
    const season = activeSeason(dst(2026, 9, 10), AR);
    expect(season?.name).toBe('Beauty Week');
    expect(season?.start).toBe('2026-09-07');
    expect(season?.end).toBe('2026-09-20');
    const today = buildEventInfo(dst(2026, 9, 20), AR);
    expect(today.activeToday).toBe(true);
    expect(today.eventToday?.name).toBe('Beauty Week AR');
  });

  it('Black Friday AR = 4th Friday of November (2026 → 11-27); the event BEFORE it is Cyber Monday', () => {
    const on = eventsOn(dst(2026, 11, 27), AR);
    expect(on.some((e) => e.name === 'Black Friday AR')).toBe(true);
    const nxt = nextEvent(dst(2026, 9, 20), AR);
    expect(nxt).toMatchObject({ name: 'Cyber Monday AR', date: '2026-11-02', daysLeft: 43 });
    const up = upcomingEvents(AR, dst(2026, 9, 20), 3);
    expect(up[1]).toMatchObject({ name: 'Black Friday AR', date: '2026-11-27', daysLeft: 25 });
  });

  it('El Buen Fin MX = Friday on/before Nov 20 (2026 → 11-20, ends 11-23)', () => {
    const on = eventsOn(dst(2026, 11, 20), MX);
    expect(on.some((e) => e.name === 'El Buen Fin')).toBe(true);
    const last = eventsOn(dst(2026, 11, 23), MX);
    expect(last.some((e) => e.name === 'El Buen Fin')).toBe(true);
    expect(eventsOn(dst(2026, 11, 24), MX).some((e) => e.name === 'El Buen Fin')).toBe(false);
    const season = activeSeason(dst(2026, 10, 25), MX);
    expect(season?.name).toBe('El Mes del Buen Fin');
  });

  it('Cyber Monday MX coincides with the 4th-Friday (4 days) rule', () => {
    expect(eventsOn(dst(2026, 11, 27), MX).some((e) => e.name === 'Cyber Monday MX')).toBe(true);
    expect(eventsOn(dst(2026, 11, 30), MX).some((e) => e.name === 'Cyber Monday MX')).toBe(true);
  });

  it('ES events derive from a single 4th-Friday rule (BF 11-27, Cyber Monday 11-30)', () => {
    expect(eventsOn(dst(2026, 11, 27), ES).some((e) => e.name === 'Black Friday ES')).toBe(true);
    expect(eventsOn(dst(2026, 11, 30), ES).some((e) => e.name === 'Cyber Monday ES')).toBe(true);
    expect(eventsOn(dst(2026, 11, 29), ES).some((e) => e.name === 'Cyber Monday ES')).toBe(false);
  });

  it('month-long seasons: Rebajas and Mes del Niño boundaries', () => {
    expect(eventsOn(dst(2026, 7, 1), ES).some((e) => e.name === 'Rebajas de verano')).toBe(true);
    expect(eventsOn(dst(2026, 7, 31), ES).some((e) => e.name === 'Rebajas de verano')).toBe(true);
    expect(eventsOn(dst(2026, 8, 1), ES).some((e) => e.name === 'Rebajas de verano')).toBe(false);
    expect(eventsOn(dst(2026, 1, 7), ES).some((e) => e.name === 'Rebajas de invierno')).toBe(true);
    expect(eventsOn(dst(2026, 8, 1), AR).some((e) => e.name === 'Mes del Niño')).toBe(true);
    expect(eventsOn(dst(2026, 9, 1), AR).some((e) => e.name === 'Mes del Niño')).toBe(false);
  });

  it('buildEventInfo returns contract-shaped info for a quiet day (antes de Beauty Week)', () => {
    const info = buildEventInfo(dst(2026, 9, 1), AR);
    expect(info.activeToday).toBe(false);
    expect(info.nextEvent).toBeDefined();
    expect(info.nextEvent!.name).toBe('Beauty Week AR');
    expect(info.nextEvent!.date).toBe('2026-09-14');
    expect(info.nextEvent!.daysLeft).toBe(13);
  });

  it('upcomingEvents returns 3 events, all in the future', () => {
    const up = upcomingEvents(AR, dst(2026, 1, 1), 3);
    expect(up).toHaveLength(3);
    expect(up[0]).toMatchObject({ name: 'Hot Sale AR', date: '2026-05-04', daysLeft: 123 });
    for (const e of up) expect(e.daysLeft).toBeGreaterThan(0);
  });

  it('describeCountryEvents covers every country with sorted, valid ranges', () => {
    for (const cc of [AR, MX, ES] as const) {
      const list = describeCountryEvents(cc, 2026);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((e) => e.start <= e.end)).toBe(true);
    }
    const joined = [...describeCountryEvents(AR, 2026), ...describeCountryEvents(MX, 2026), ...describeCountryEvents(ES, 2026)];
    const unique = new Set(joined.map((e) => `${e.name}-${e.start}`));
    expect(unique.size).toBe(joined.length);
  });

  it('getCountry exposes the expected currency/flag (no invented data)', () => {
    expect(getCountry(AR).currency).toBe('ARS');
    expect(getCountry(MX).currency).toBe('MXN');
    expect(getCountry(ES).currency).toBe('EUR');
  });
});