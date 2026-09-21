import type { Filters, SortMode } from '../lib/filterResults';

interface SortBarProps {
  total: number;
  shown: number;
  source: 'live';
  sort: SortMode;
  filters: Filters;
  onSortChange: (sort: SortMode) => void;
  onFiltersChange: (filters: Filters) => void;
}

const pillBase =
  'inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium ' +
  'transition-colors hover:border-accent-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-accent-500 ' +
  'sm:flex-none sm:justify-start';

function pillPressed(pressed: boolean): string {
  return pressed
    ? 'border-accent-500 bg-accent-50 text-accent-800 dark:bg-accent-500/15 dark:text-accent-300'
    : '';
}

const inputClass =
  'h-10 w-full min-w-0 border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 ' +
  'focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 ' +
  'dark:placeholder:text-neutral-500';

export default function SortBar({ total, shown, source: _source, sort, filters, onSortChange, onFiltersChange }: SortBarProps) {
  void _source;
  const priceLabel = sort === 'price-asc' ? 'Precio ↑' : 'Precio ↓';

  function setPrice(kind: 'priceMin' | 'priceMax', raw: string) {
    const parsed = raw.trim() === '' ? null : Number(raw);
    onFiltersChange({ ...filters, [kind]: parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null });
  }

  return (
    <div className="flex flex-wrap items-end gap-3" aria-label="Filtrar y ordenar resultados">
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500 dark:text-neutral-400" aria-live="polite">
          {shown} de {total} ofertas
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-800 dark:bg-accent-500/15 dark:text-accent-300">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-600" />
          live
        </span>
      </div>

      <label className="block w-1/2 min-w-0 flex-1 sm:w-auto">
        <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Precio mín (ARS)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Sin mínimo"
          aria-label="Precio mínimo en pesos"
          value={filters.priceMin === null ? '' : String(filters.priceMin)}
          onChange={(e) => setPrice('priceMin', e.target.value)}
          className={`${inputClass} rounded-xl`}
        />
      </label>

      <label className="block w-1/2 min-w-0 flex-1 sm:w-auto">
        <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Precio máx (ARS)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Sin máximo"
          aria-label="Precio máximo en pesos"
          value={filters.priceMax === null ? '' : String(filters.priceMax)}
          onChange={(e) => setPrice('priceMax', e.target.value)}
          className={`${inputClass} rounded-xl`}
        />
      </label>

      <button
        type="button"
        aria-pressed={sort === 'price-asc'}
        onClick={() => onSortChange(sort === 'price-asc' ? 'price-desc' : 'price-asc')}
        className={pillBase}
      >
        {priceLabel}
      </button>

      <button
        type="button"
        aria-pressed={filters.soloLocal}
        onClick={() => onFiltersChange({ ...filters, soloLocal: !filters.soloLocal })}
        className={`${pillBase} ${pillPressed(filters.soloLocal)}`}
      >
        Solo local
      </button>

      <button
        type="button"
        aria-pressed={filters.freeShipping}
        onClick={() => onFiltersChange({ ...filters, freeShipping: !filters.freeShipping })}
        className={`${pillBase} ${pillPressed(filters.freeShipping)}`}
      >
        Envío gratis
      </button>
    </div>
  );
}

export type { SortMode } from '../lib/filterResults';