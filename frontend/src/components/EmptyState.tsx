import { RotateCcw, SearchX } from 'lucide-react';
import type { SearchParams } from '../../../shared/contract';
import { COUNTRIES, countryName } from '../lib/countries';

interface EmptyStateProps {
  params: SearchParams;
  filtered: boolean;
  onRetry: () => void;
}

export default function EmptyState({ params, filtered, onRetry }: EmptyStateProps) {
  const country = COUNTRIES[params.country];
  return (
    <div className="animate-view-in flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <SearchX aria-hidden="true" size={36} className="text-neutral-300 dark:text-neutral-600" />
      <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">
        {filtered ? 'No quedan resultados con el filtro' : 'Sin ofertas para esta búsqueda'}
      </h2>
      {filtered ? (
        <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          Quitá el filtro “Solo tiendas locales” o probá con otro término.
        </p>
      ) : (
        <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          No encontramos ofertas con envío confirmado para “
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{params.product}</span>” en{' '}
          {country.flag} {countryName(params.country)}.
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-accent-500"
      >
        <RotateCcw aria-hidden="true" size={16} />
        Reintentar
      </button>
    </div>
  );
}