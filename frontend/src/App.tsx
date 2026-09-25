import { useEffect, useMemo, useState } from 'react';
import { Github, Loader2, Moon, Sun } from 'lucide-react';
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

const POPULAR_SEARCHES = ['iPhone 16', 'Notebook', 'PS5', 'Perfume', 'Zapatillas'];
const DEFAULT_DOCUMENT_TITLE = 'AhorrAR — Comparador de precios en Argentina';
const GITHUB_REPO_URL = 'https://github.com/YukaC/AhorrAR';

export default function App() {
  const { state, run, retry, cancel, goHome } = useSearch();
  const { theme, toggleTheme } = useTheme();
  const [sort, setSort] = useState<SortMode>('price-asc');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  function handleGoHome() {
    setSort('price-asc');
    setFilters(EMPTY_FILTERS);
    goHome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const busy = state.status === 'running';

  useEffect(() => {
    const product = state.params?.product ?? state.response?.query.product;
    if (product && (state.status === 'running' || state.status === 'done')) {
      document.title = `${product} — precios en AhorrAR`;
      return;
    }
    document.title = DEFAULT_DOCUMENT_TITLE;
  }, [state.status, state.params?.product, state.response?.query.product]);

  function handleSearch(params: SearchParams) {
    setSort('price-asc');
    setFilters(EMPTY_FILTERS);
    run(params);
  }

  const visibleResults = useMemo(() => {
    if (!state.response) return [];
    return filterAndSort(state.response.results, filters, sort);
  }, [state.response, filters, sort]);

  /** Live SSE parciales: mismo filtro/orden que el resultado final (§V12). */
  const liveResults = useMemo(() => {
    const partial = state.progress?.results;
    if (!partial || partial.length === 0) return [];
    return filterAndSort(partial, filters, sort);
  }, [state.progress?.results, filters, sort]);

  const response = state.response;
  const resultsHeading =
    state.status === 'running'
      ? 'Ofertas encontradas hasta ahora'
      : state.status === 'done'
        ? `Resultados para ${response?.query.product ?? 'tu búsqueda'}`
        : 'Resultados de la búsqueda';

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-accent-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-warm-50 dark:focus:ring-offset-neutral-950"
      >
        Saltar al contenido principal
      </a>

      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/85 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-5 sm:px-6">
          <button
            type="button"
            onClick={handleGoHome}
            aria-label="Ir al inicio de AhorrAR"
            className="flex min-w-0 cursor-pointer items-center gap-4 rounded-2xl text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950"
          >
            <img
              src="/icon.png"
              alt=""
              width={64}
              height={64}
              className="size-14 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-neutral-200 sm:size-16 dark:ring-neutral-700"
            />
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50">
                Ahorr<span className="text-accent-600">AR</span>
              </h1>
              <p className="truncate text-sm text-neutral-600 dark:text-neutral-300">
                Buscá tu producto, al mejor precio
              </p>
            </div>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              aria-pressed={theme === 'dark'}
              className="inline-flex size-11 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 transition-colors hover:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-accent-500"
            >
              <span className="relative block size-[18px]" aria-hidden="true">
                <Sun
                  size={18}
                  className={`absolute inset-0 transition-all duration-300 ${
                    theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
                  }`}
                />
                <Moon
                  size={18}
                  className={`absolute inset-0 transition-all duration-300 ${
                    theme === 'dark' ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
                  }`}
                />
              </span>
            </button>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Repositorio de AhorrAR en GitHub"
              title="GitHub · YukaC/AhorrAR"
              className="inline-flex size-11 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 transition-colors hover:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-accent-500"
            >
              <Github aria-hidden="true" size={18} />
            </a>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 outline-none"
      >
        <SearchBar busy={busy} onSearch={handleSearch} />

        {state.status === 'running' && state.params ? (
          <>
            {liveResults.length > 0 ? (
              <section className="animate-view-in flex flex-col gap-5" aria-labelledby="live-results-heading">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    id="live-results-heading"
                    className="text-base font-semibold text-neutral-800 dark:text-neutral-100"
                  >
                    {resultsHeading}{' '}
                    <span className="font-medium text-neutral-600 dark:text-neutral-300">
                      ({state.progress?.results?.length ?? liveResults.length})
                    </span>
                  </h2>
                  <Loader2
                    aria-hidden="true"
                    size={18}
                    className="shrink-0 animate-spin text-accent-700 dark:text-accent-300"
                  />
                </div>
                <SortBar
                  total={state.progress?.results?.length ?? liveResults.length}
                  shown={liveResults.length}
                  source="live"
                  sort={sort}
                  filters={filters}
                  onSortChange={setSort}
                  onFiltersChange={setFilters}
                />
                <ResultsGrid results={liveResults} />
              </section>
            ) : null}
            <section className="flex flex-col gap-4" aria-live="polite">
              <LoadingState params={state.params} progress={state.progress} onCancel={cancel} />
            </section>
          </>
        ) : null}

        {state.status === 'error' && state.params ? (
          <ErrorState message={state.error ?? 'Error desconocido'} code={state.errorCode} onRetry={retry} />
        ) : null}

        {state.status === 'done' && response ? (
          <section className="animate-view-in flex flex-col gap-6" aria-labelledby="results-heading">
            <EventBanner event={response.event} />

            <div className="flex flex-col gap-5">
              <h2 id="results-heading" className="sr-only">
                {resultsHeading}
              </h2>
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
            </div>

            <p className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-5 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
              <span>
                {response.stats.source} · {response.stats.nodesVisited} nodos · {response.stats.elapsedMs}{' '}
                ms
              </span>
              <span>Generado {new Date(response.generatedAt).toLocaleTimeString('es-AR')}</span>
            </p>
          </section>
        ) : null}

        {state.status === 'idle' ? (
          <section
            className="animate-view-in mt-2 flex flex-col items-center gap-5 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center sm:p-10 dark:border-neutral-700 dark:bg-neutral-900"
            aria-labelledby="idle-heading"
          >
            <h2 id="idle-heading" className="text-lg font-bold text-neutral-800 dark:text-neutral-50">
              ¿Qué querés ahorrar hoy?
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              Ingresá un producto o probá una búsqueda popular:
            </p>
            <div className="flex flex-wrap justify-center gap-2.5" role="list">
              {POPULAR_SEARCHES.map((query) => (
                <button
                  key={query}
                  type="button"
                  role="listitem"
                  onClick={() => handleSearch({ product: query, country: 'AR', maxDepth: 1, maxResults: 10 })}
                  className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors duration-150 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-accent-500 dark:hover:bg-accent-500/10 dark:hover:text-accent-300"
                >
                  {query}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-neutral-200 py-8 dark:border-neutral-800">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 px-4 text-center text-sm leading-relaxed text-neutral-600 sm:px-6 dark:text-neutral-300">
          <p>AhorrAR no está afiliado a las tiendas listadas. Los precios y la disponibilidad pueden variar.</p>
          <p>© 2026 AhorrAR · Comparador de precios en Argentina</p>
        </div>
      </footer>
    </div>
  );
}
