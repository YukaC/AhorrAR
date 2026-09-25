import { MapPin, RotateCcw, SearchX } from 'lucide-react';
import type { SearchParams } from '../../../shared/contract';
import { countryName } from '../lib/countries';

interface EmptyStateProps {
  params: SearchParams;
  filtered: boolean;
  onRetry: () => void;
}

export default function EmptyState({ params, filtered, onRetry }: EmptyStateProps) {
  return (
    <div className="animate-view-in flex flex-col items-center gap-4 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center sm:p-10 dark:border-neutral-700 dark:bg-neutral-900">
      <SearchX aria-hidden="true" size={36} className="text-neutral-400 dark:text-neutral-500" />
      <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-50">
        {filtered ? 'No quedan resultados con el filtro' : 'Sin ofertas para esta búsqueda'}
      </h2>
      {filtered ? (
        <p className="max-w-md text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          Ajustá precio mín/máx o probá con otro término.
        </p>
      ) : (
        <p className="max-w-md text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          No encontramos ofertas con envío confirmado para “
          <span className="font-medium text-neutral-800 dark:text-neutral-100">{params.product}</span>” en{' '}
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" size={14} className="shrink-0" />
            {countryName(params.country)}
          </span>
          .
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:border-accent-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-accent-500"
      >
        <RotateCcw aria-hidden="true" size={16} />
        Reintentar
      </button>
    </div>
  );
}