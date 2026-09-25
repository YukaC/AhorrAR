import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EventInfo } from '../../../shared/contract';
import EventBanner from './EventBanner';

const upcoming: EventInfo = {
  activeToday: false,
  nextEvent: { name: 'Black Friday', date: '2026-11-27', daysLeft: 68 },
};

const active: EventInfo = {
  activeToday: true,
  eventToday: {
    name: 'Cyber Monday AR',
    date: '2026-09-20',
    endDate: '2026-09-22',
    description: 'Descuentos en tecnología',
  },
  nextEvent: { name: 'Black Friday', date: '2026-11-27', daysLeft: 68 },
};

describe('EventBanner', () => {
  it('announces the next event with a live countdown', () => {
    render(<EventBanner event={upcoming} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Black Friday')).toBeInTheDocument();
    expect(screen.getByLabelText('Cuenta regresiva para Black Friday')).toBeInTheDocument();
  });

  it('announces an active event with description', () => {
    render(<EventBanner event={active} />);
    expect(screen.getByText('Cyber Monday AR')).toBeInTheDocument();
    expect(screen.getByText('Descuentos en tecnología')).toBeInTheDocument();
    expect(screen.getByText('Hoy')).toBeInTheDocument();
  });
});