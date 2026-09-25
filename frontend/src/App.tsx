import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Github, Loader2, Moon, Sun } from 'lucide-react';
import { useSearch } from './hooks/useSearch';
import { useTheme } from './hooks/useTheme';
import type { SearchParams } from '../../shared/contract';
import SearchBar from './components/SearchBar';
import SortBar from './components/SortBar';
import type { SortMode } from './components/SortBar';
import { EMPTY_FILTERS, filterAndSort, hasActiveFilters } from './lib/filterResults';
import type { Filters } from './lib/filterResults';
import { DEFAULT_RESULT_CAP, nextResultCap } from './lib/result-caps';
import ResultsGrid from './components/ResultsGrid';
import EmptyState from './components/EmptyState';
import ErrorState from './components/ErrorState';
import LoadingState from './components/LoadingState';
import EventBanner from './components/EventBanner';

const POPULAR_SEARCHES = ['iPhone 16', 'Notebook', 'PS5', 'Perfume', 'Zapatillas'];
const DEFAULT_DOCUMENT_TITLE = 'AhorrAR - Comparador de precios en Argentina';
const GITHUB_REPO_URL = 'https://github.com/YukaC/AhorrAR';

export default function App() {
  const { state, run, retry, cancel, goHome } = useSearch();
  const { theme, toggleTheme } = useTheme();
  const [sort, setSort] = useState<SortMode>('price-asc');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [product, setProduct] = useState('');
  const [resultCap, setResultCap] = useState<number>(DEFAULT_RESULT_CAP);

  function handleGoHome() {
    setSort('price-asc');
    setFilters(EMPTY_FILTERS);
    setProduct('');
    setResultCap(DEFAULT_RESULT_CAP);
    goHome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const busy = state.status === 'running';

  // Keep the search input in sync with the active/restored query (chips, resume, retry).
  useEffect(() => {
    const activeProduct = state.params?.product ?? state.response?.query.product;
    if (activeProduct) setProduct(activeProduct);
  }, [state.params?.product, state.response?.query.product]);

  useEffect(() => {
    const activeCap = state.params?.maxResults ?? state.response?.query.maxResults;
    if (typeof activeCap === 'number' && activeCap > 0) setResultCap(activeCap);
  }, [state.params?.maxResults, state.response?.query.maxResults]);

  useEffect(() => {
    const titleProduct = state.params?.product ?? state.response?.query.product;
    if (titleProduct && (state.status === 'running' || state.status === 'done')) {
      document.title = `${titleProduct} - precios en AhorrAR`;
      return;
    }
    document.title = DEFAULT_DOCUMENT_TITLE;
  }, [state.status, state.params?.product, state.response?.query.product]);

  function handleSearch(params: SearchParams) {
    const cap = params.maxResults ?? DEFAULT_RESULT_CAP;
    setProduct(params.product);
    setResultCap(cap);
    setSort('price-asc');
    setFilters(EMPTY_FILTERS);
    run({ ...params, country: 'AR', maxDepth: params.maxDepth ?? 2, maxResults: cap });
  }

  function handleShowMore() {
    const next = nextResultCap(resultCap);
    const base = state.params ?? state.response?.query;
    if (!next || !base) return;
    handleSearch({ ...base, maxResults: next });
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
  const moreCap = state.status === 'done' ? nextResultCap(resultCap) : null;
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
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Saltar al contenido principal
      </a>

      <header className="sticky top-0 z-10 border-b border-border/80 bg-card/80 backdrop-blur-md reduced-transparency:bg-card reduced-transparency:backdrop-filter-none">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:h-[4.25rem] sm:px-6">
          <button
            type="button"
            onClick={handleGoHome}
            aria-label="Ir al inicio de AhorrAR"
            className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl text-left transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <img
              src="/icon.png"
              alt=""
              width={40}
              height={40}
              className="size-10 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-border"
            />
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                Ahorr<span className="text-brand">AR</span>
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                Precios reales en tiendas de Argentina
              </p>
            </div>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              aria-pressed={theme === 'dark'}
              className="inline-flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-[border-color,color,transform] hover:border-accent-400 hover:text-foreground active:scale-[0.97]"
            >
              <span className="relative block size-[18px]" aria-hidden="true">
                <Sun
                  size={18}
                  className={`absolute inset-0 transition-[transform,opacity] duration-300 ${
                    theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
                  }`}
                />
                <Moon
                  size={18}
                  className={`absolute inset-0 transition-[transform,opacity] duration-300 ${
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
              title="GitHub YukaC/AhorrAR"
              className="inline-flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-[border-color,color,transform] hover:border-accent-400 hover:text-foreground active:scale-[0.97]"
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
        <SearchBar
          busy={busy}
          product={product}
          onProductChange={setProduct}
          maxResults={DEFAULT_RESULT_CAP}
          onSearch={(params) => handleSearch({ ...params, maxResults: DEFAULT_RESULT_CAP })}
        />

        {state.status === 'running' && state.params ? (
          <>
            {liveResults.length > 0 ? (
              <section className="animate-view-in flex flex-col gap-5" aria-labelledby="live-results-heading">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    id="live-results-heading"
                    className="text-base font-semibold text-foreground"
                  >
                    {resultsHeading}{' '}
                    <span className="font-medium text-muted-foreground">
                      ({state.progress?.results?.length ?? liveResults.length})
                    </span>
                  </h2>
                  <Loader2
                    aria-hidden="true"
                    size={18}
                    className="shrink-0 animate-spin text-brand"
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

              {moreCap !== null && visibleResults.length > 0 ? (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={handleShowMore}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-card px-5 text-sm font-semibold text-foreground transition-[border-color,background-color,transform] hover:border-accent-500 hover:bg-primary-soft hover:text-primary-soft-foreground active:scale-[0.97]"
                  >
                    <ChevronDown aria-hidden="true" size={18} />
                    Mostrar más (hasta {moreCap})
                  </button>
                </div>
              ) : null}
            </div>

            <p className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5 text-sm text-muted-foreground">
              <span>
                {response.stats.source}, {response.stats.nodesVisited} nodos, {response.stats.elapsedMs}{' '}
                ms
              </span>
              <span>Generado {new Date(response.generatedAt).toLocaleTimeString('es-AR')}</span>
            </p>
          </section>
        ) : null}

        {state.status === 'idle' ? (
          <section
            className="animate-view-in mt-4 flex flex-col gap-6 sm:mt-6"
            aria-labelledby="idle-heading"
          >
            <div className="flex max-w-xl flex-col gap-2">
              <h2
                id="idle-heading"
                className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl"
              >
                ¿Qué querés ahorrar hoy?
              </h2>
              <p className="max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
                Escribí arriba o elegí una búsqueda popular. Ofertas reales, con envío confirmado.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2.5">
              {POPULAR_SEARCHES.map((query) => (
                <li key={query}>
                  <button
                    type="button"
                    onClick={() =>
                      handleSearch({
                        product: query,
                        country: 'AR',
                        maxDepth: 2,
                        maxResults: DEFAULT_RESULT_CAP,
                      })
                    }
                    className="inline-flex min-h-11 items-center rounded-xl border border-input bg-card/90 px-4 text-sm font-medium text-foreground shadow-sm transition-[border-color,background-color,color,transform] duration-150 hover:border-accent-500 hover:bg-primary-soft hover:text-primary-soft-foreground active:scale-[0.97]"
                  >
                    {query}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-border/80 py-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-1.5 px-4 text-sm leading-relaxed text-muted-foreground sm:px-6">
          <p>AhorrAR no está afiliado a las tiendas listadas. Los precios y la disponibilidad pueden variar.</p>
          <p>© 2026 AhorrAR - Comparador de precios en Argentina</p>
        </div>
      </footer>
    </div>
  );
}
