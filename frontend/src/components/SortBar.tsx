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
  'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-medium text-foreground ' +
  'transition-[border-color,transform] duration-150 hover:border-accent-400 active:scale-[0.97] ' +
  'sm:flex-none sm:justify-start';

function pillPressed(pressed: boolean): string {
  return pressed
    ? 'border-primary bg-primary-soft text-primary-soft-foreground shadow-sm'
    : '';
}

const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground ' +
  'focus:border-ring focus:outline-none';

export default function SortBar({
  total,
  shown,
  source: _source,
  sort,
  filters,
  onSortChange,
  onFiltersChange,
}: SortBarProps) {
  void _source;
  const priceLabel = sort === 'price-asc' ? 'Precio ↑' : 'Precio ↓';

  function setPrice(kind: 'priceMin' | 'priceMax', raw: string) {
    const parsed = raw.trim() === '' ? null : Number(raw);
    onFiltersChange({
      ...filters,
      [kind]: parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
    });
  }

  return (
    <div className="flex flex-col gap-4" role="group" aria-labelledby="filters-heading">
      <p
        id="filters-heading"
        className="text-sm font-medium text-foreground"
        aria-live="polite"
      >
        {shown} de {total} ofertas
      </p>

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/80 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
        <label className="block min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <span className="mb-1.5 block text-xs font-semibold text-foreground">Precio mín (ARS)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Sin mínimo"
            aria-label="Precio mínimo en pesos"
            value={filters.priceMin === null ? '' : String(filters.priceMin)}
            onChange={(e) => setPrice('priceMin', e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <span className="mb-1.5 block text-xs font-semibold text-foreground">Precio máx (ARS)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Sin máximo"
            aria-label="Precio máximo en pesos"
            value={filters.priceMax === null ? '' : String(filters.priceMax)}
            onChange={(e) => setPrice('priceMax', e.target.value)}
            className={inputClass}
          />
        </label>

        <div className="flex w-full flex-wrap gap-2.5 sm:w-auto sm:flex-1 sm:justify-end">
          <button
            type="button"
            aria-pressed={filters.freeShipping}
            aria-label={
              filters.freeShipping
                ? 'Filtrar por envío gratis: activo. Desactivar'
                : 'Filtrar por envío gratis: inactivo. Activar'
            }
            onClick={() => onFiltersChange({ ...filters, freeShipping: !filters.freeShipping })}
            className={`${pillBase} ${pillPressed(filters.freeShipping)}`}
          >
            Envío gratis
          </button>
          <button
            type="button"
            aria-pressed={sort === 'price-asc'}
            aria-label={
              sort === 'price-asc'
                ? 'Ordenar por precio: menor a mayor. Activar mayor a menor'
                : 'Ordenar por precio: mayor a menor. Activar menor a mayor'
            }
            onClick={() => onSortChange(sort === 'price-asc' ? 'price-desc' : 'price-asc')}
            className={pillBase}
          >
            {priceLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { SortMode } from '../lib/filterResults';
