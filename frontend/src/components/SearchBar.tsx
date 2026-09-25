import { useId } from 'react';
import type { FormEvent } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import type { SearchParams } from '../../../shared/contract';

interface SearchBarProps {
  busy: boolean;
  product: string;
  onProductChange: (product: string) => void;
  maxResults: number;
  onSearch: (params: SearchParams) => void;
}

const inputBase =
  'min-h-11 w-full rounded-xl border border-input bg-card text-foreground shadow-sm ' +
  'placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-200 disabled:cursor-not-allowed disabled:bg-muted ' +
  'hover:border-accent-400 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20';

export default function SearchBar({
  busy,
  product,
  onProductChange,
  maxResults,
  onSearch,
}: SearchBarProps) {
  const productId = useId();
  const countryId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = product.trim();
    if (!trimmed || busy) return;
    onSearch({ product: trimmed, country: 'AR', maxDepth: 2, maxResults });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      role="search"
      aria-label="Buscar producto"
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor={productId} className="mb-1.5 block text-xs font-semibold text-foreground">
          Producto
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
            size={18}
          />
          <input
            id={productId}
            type="search"
            name="product"
            autoFocus
            required
            maxLength={120}
            value={product}
            onChange={(e) => onProductChange(e.target.value)}
            autoComplete="off"
            placeholder="Ej: bensimon, iPhone 16, placa de video…"
            className={`${inputBase} pl-11 pr-4`}
          />
        </div>
      </div>

      <div className="w-full sm:w-40 sm:shrink-0">
        <span id={countryId} className="mb-1.5 block text-xs font-semibold text-foreground">
          País
        </span>
        <span
          className={`${inputBase} inline-flex w-full items-center justify-center gap-2 px-3`}
          aria-labelledby={countryId}
          title="Búsqueda solo en Argentina"
        >
          <MapPin aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
          Argentina
        </span>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:mb-0"
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="animate-spin motion-reduce:hidden" size={18} />
        ) : (
          <Search aria-hidden="true" size={18} />
        )}
        {busy ? 'Buscando…' : 'Buscar'}
      </button>
    </form>
  );
}
