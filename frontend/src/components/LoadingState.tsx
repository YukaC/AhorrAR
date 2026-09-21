import { Loader2, X } from 'lucide-react';
import type { SearchParams, SearchProgress } from '../../../shared/contract';
import { COUNTRIES, countryName } from '../lib/countries';

interface LoadingStateProps {
  params: SearchParams;
  progress: SearchProgress | null;
  onCancel: () => void;
}

function SkeletonCard() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <div className="h-4 w-8 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="h-8 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mt-auto h-4 w-28 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

export default function LoadingState({ params, progress, onCancel }: LoadingStateProps) {
  const country = COUNTRIES[params.country];
  const depth = progress?.depth ?? 0;
  const nodes = progress?.nodesVisited ?? 0;
  const results = progress?.resultsFound ?? 0;

  return (
    <div aria-live="polite" className="animate-view-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent-200 bg-accent-50 p-4 dark:border-accent-800/50 dark:bg-accent-500/10">
        <Loader2 aria-hidden="true" size={20} className="shrink-0 animate-spin text-accent-700 motion-reduce:hidden dark:text-accent-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
            Buscando “{params.product}” en {country.flag} {countryName(params.country)}
          </p>
          <p className="text-sm text-accent-800 dark:text-accent-300">
            Explorando… profundidad {depth} · {nodes} nodos · {results} ofertas
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-accent-500"
        >
          <X aria-hidden="true" size={16} />
          Cancelar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}