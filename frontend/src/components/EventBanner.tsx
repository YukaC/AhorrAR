import { CalendarClock, Flame } from 'lucide-react';
import type { EventInfo } from '../../../shared/contract';
import { eventBannerCopy, formatDaysLeft } from '../lib/event';

interface EventBannerProps {
  event: EventInfo;
}

export default function EventBanner({ event }: EventBannerProps) {
  const copy = eventBannerCopy(event);

  if (copy.kind === 'active') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 rounded-2xl bg-gradient-to-r from-rose-600 to-orange-500 p-4 text-white"
      >
        <Flame aria-hidden="true" size={22} className="mt-0.5 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-semibold tracking-wide uppercase opacity-90">
            Evento activo hoy
          </p>
          <p className="text-lg leading-tight font-bold">{copy.title}</p>
          {copy.description ? (
            <p className="text-sm leading-snug opacity-95">{copy.description}</p>
          ) : null}
          <p className="text-sm font-medium opacity-90">🗓️ {copy.dateRange}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-2xl bg-gradient-to-r from-accent-700 to-teal-600 p-4 text-white"
    >
      <CalendarClock aria-hidden="true" size={22} className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold tracking-wide uppercase opacity-90">
          Próximo evento {copy.daysLeft !== undefined ? `· ${formatDaysLeft(copy.daysLeft)}` : ''}
        </p>
        <p className="text-lg leading-tight font-bold">{copy.title}</p>
        <p className="text-sm font-medium opacity-90">🗓️ {copy.dateRange}</p>
      </div>
    </div>
  );
}