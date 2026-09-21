import { useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useSearch } from './hooks/useSearch';
import { useTheme } from './hooks/useTheme';
import type { SearchParams } from '../../shared/contract';
import SearchBar from './components/SearchBar';
import SortBar from './components/SortBar';
import type { SortMode } from './components/SortBar';
import { EMPTY_FILTERS, filterAndSort, hasActiveFilters } from './lib/filterResults';
import type { Filters } from './lib/filterResults';
import ResultsGrid from './components/ResultsGrid';
import EmptyState from './components/EmptyState';
import ErrorState from './components/ErrorState';
import LoadingState from './components/LoadingState';
import EventBanner from './components/EventBanner';

export default function App() {
  const { state, run, retry, cancel } = useSearch();
  const { theme, toggleTheme } = useTheme();
  const [sort, setSort] = useState<SortMode>('price-asc');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const busy = state.status === 'running';

  function handleSearch(params: SearchParams) {
    setSort('price-asc');
    setFilters(EMPTY_FILTERS);
    run(params);
  }

  const visibleResults = useMemo(() => {
    if (!state.response) return [];
    return filterAndSort(state.response.results, filters, sort);
  }, [state.response, filters, sort]);

  const response = state.response;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4">
          <img
            src="/icon.png"
            alt="AhorrAR"
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-neutral-200 dark:ring-neutral-700"
          />
          <div className="min-w-0">
            <p className="text-2xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-100">
              Ahorr<span className="text-accent-600">AR</span>
            </p>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">
              Buscá tu producto, al mejor precio
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-pressed={theme === 'dark'}
            className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 transition-colors hover:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-accent-500"
          >
            {theme === 'dark' ? (
              <Sun aria-hidden="true" size={18} />
            ) : (
              <Moon aria-hidden="true" size={18} />
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
        <SearchBar busy={busy} onSearch={handleSearch} />

        {state.status === 'running' && state.params ? (
          <LoadingState params={state.params} progress={state.progress} onCancel={cancel} />
        ) : null}

        {state.status === 'error' && state.params ? (
          <ErrorState message={state.error ?? 'Error desconocido'} code={state.errorCode} onRetry={retry} />
        ) : null}

        {state.status === 'done' && response ? (
          <section className="animate-view-in">
            <EventBanner event={response.event} />

            <SortBar
              total={response.results.length}
              shown={visibleResults.length}
              source={response.stats.source}
              sort={sort}
              filters={filters}
              onSortChange={setSort}
              onFiltersChange={setFilters}
            />

            {visibleResults.length > 0 ? (
              <ResultsGrid key={response.generatedAt} results={visibleResults} />
            ) : (
              <EmptyState params={response.query} filtered={hasActiveFilters(filters)} onRetry={retry} />
            )}

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
              <p>
                {response.stats.source} · {response.stats.nodesVisited} nodos ·{' '}
                {response.stats.elapsedMs} ms
              </p>
              <p>Generado {new Date(response.generatedAt).toLocaleTimeString('es')}</p>
            </footer>
          </section>
        ) : null}

        {state.status === 'idle' ? (
          <section className="animate-view-in mt-4 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
            <p className="text-lg font-bold text-neutral-800 dark:text-neutral-100">
              ¿Qué querés ahorrar hoy?
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
              Ingresá un producto y un país. Recorremos las ofertas, nos quedamos con las que
              tienen envío confirmado y las ordenamos por precio.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}