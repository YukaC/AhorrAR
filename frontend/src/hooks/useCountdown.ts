import { useEffect, useState } from 'react';
import type { CountdownParts } from '../lib/format';

/**
 * Parsea una fecha YYYY-MM-DD como medianoche LOCAL. El sufijo T00:00:00 es
 * deliberado: un date-only se interpretaría como UTC y correría la cuenta
 * según la zona horaria del navegador.
 */
export function parseEventDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

export function diffTo(target: Date): CountdownParts {
  const targetTime = target.getTime();
  if (Number.isNaN(targetTime)) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  const total = Math.max(0, targetTime - Date.now());
  const seconds = Math.floor(total / 1000);
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
    total,
  };
}

/**
 * Cuenta regresiva en vivo hasta una fecha YYYY-MM-DD (medianoche local).
 * Recibe el string (dep primitiva estable) en vez de un Date para no
 * recrear el interval en cada render.
 */
export function useCountdown(isoDate: string): CountdownParts {
  const [parts, setParts] = useState(() => diffTo(parseEventDate(isoDate)));

  useEffect(() => {
    const target = parseEventDate(isoDate);
    const refresh = () => {
      const next = diffTo(target);
      setParts(next);
      return next;
    };

    // Refresco inmediato si cambió isoDate (sin esperar el primer tick).
    const first = refresh();
    if (first.total <= 0) return;

    // Primer tick alineado al borde del segundo; luego cada 1s.
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(() => {
      const next = refresh();
      if (next.total <= 0) return;
      intervalId = setInterval(() => {
        const nextTick = refresh();
        if (nextTick.total <= 0) clearInterval(intervalId);
      }, 1_000);
    }, 1_000 - (Date.now() % 1_000));

    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  }, [isoDate]);

  return parts;
}