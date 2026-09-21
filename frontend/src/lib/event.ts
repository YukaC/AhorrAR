import type { EventInfo } from '../../../shared/contract';
import { formatDaysLeft } from './format';

export interface BannerCopy {
  kind: 'active' | 'upcoming';
  title: string;
  description?: string;
  dateRange: string;
  daysLeft?: number;
}

function formatDayMonth(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(d);
}

export function formatDateRange(start: string, end?: string): string {
  if (!end) return formatDayMonth(start);
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** Copia para el banner según si el evento está activo hoy o es próximo. */
export function eventBannerCopy(event: EventInfo): BannerCopy {
  if (event.activeToday && event.eventToday) {
    const { name, date, endDate, description } = event.eventToday;
    return {
      kind: 'active',
      title: name,
      description,
      dateRange: formatDateRange(date, endDate),
    };
  }
  const { name, date, daysLeft } = event.nextEvent;
  return {
    kind: 'upcoming',
    title: name,
    dateRange: formatDateRange(date, undefined),
    daysLeft,
  };
}

export { formatDaysLeft };