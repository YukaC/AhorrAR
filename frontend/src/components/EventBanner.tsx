import { CalendarClock, CalendarDays, Flame } from 'lucide-react';
import type { EventInfo } from '../../../shared/contract';
import { eventBannerCopy } from '../lib/event';
import { formatCountdown } from '../lib/format';
import { useCountdown } from '../hooks/useCountdown';

interface EventBannerProps {
  event: EventInfo;
}

function LiveDot() {
  return (
    <span className="relative flex size-1.5" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-white" />
    </span>
  );
}

export default function EventBanner({ event }: EventBannerProps) {
  const copy = eventBannerCopy(event);
  // Hook incondicional: el orden de hooks debe ser estable entre renders.
  const countdown = useCountdown(event.nextEvent.date);

  if (copy.kind === 'active') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3.5 rounded-2xl bg-gradient-to-r from-event-active-from to-event-active-to p-5 text-white"
      >
        <Flame aria-hidden="true" size={22} className="mt-0.5 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium opacity-90">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">
              <LiveDot />
              En curso
            </span>
            <span>Hoy</span>
          </p>
          <p className="text-lg leading-tight font-bold">{copy.title}</p>
          {copy.description ? (
            <p className="text-sm leading-snug opacity-95">{copy.description}</p>
          ) : null}
          <p className="inline-flex items-center gap-1.5 text-sm font-medium opacity-90">
            <CalendarDays aria-hidden="true" size={14} />
            {copy.dateRange}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3.5 rounded-2xl bg-gradient-to-r from-event-upcoming-from to-event-upcoming-to p-5 text-white"
    >
      <CalendarClock aria-hidden="true" size={22} className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium opacity-90">Próximo evento</p>
        <p className="text-lg leading-tight font-bold">{copy.title}</p>
        <p className="inline-flex items-center gap-1.5 text-sm font-medium opacity-90">
          <CalendarDays aria-hidden="true" size={14} />
          {copy.dateRange}
        </p>
        <p
          className="text-sm font-semibold tabular-nums"
          aria-label={`Cuenta regresiva para ${copy.title}`}
        >
          Comienza en {formatCountdown(countdown)}
        </p>
      </div>
    </div>
  );
}
