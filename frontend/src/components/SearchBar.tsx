import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import type { SearchParams } from '../../../shared/contract';

interface SearchBarProps {
  busy: boolean;
  onSearch: (params: SearchParams) => void;
}

const inputBase =
  'min-h-11 w-full rounded-xl border border-neutral-300 bg-white text-neutral-900 shadow-sm ' +
  'placeholder:text-neutral-500 transition-[border-color,box-shadow] duration-200 disabled:cursor-not-allowed disabled:bg-neutral-100 ' +
  'hover:border-accent-400 focus-visible:border-accent-500 focus-visible:ring-4 focus-visible:ring-accent-500/20 ' +
  'dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400 ' +
  'dark:disabled:bg-neutral-800 dark:hover:border-accent-500';

export default function SearchBar({ busy, onSearch }: SearchBarProps) {
  const [product, setProduct] = useState('');
  const productId = useId();
  const countryId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = product.trim();
    if (!trimmed || busy) return;
    // AR-only live search — shallow crawl, fast.
    onSearch({ product: trimmed, country: 'AR', maxDepth: 1, maxResults: 10 });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      role="search"
      aria-label="Buscar producto"
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor={productId} className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-200">
          Producto
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400"
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
            onChange={(e) => setProduct(e.target.value)}
            autoComplete="off"
            placeholder="Ej: bensimon, iPhone 16, placa de video…"
            className={`${inputBase} pl-11 pr-4`}
          />
        </div>
      </div>

      <div className="w-full sm:w-40 sm:shrink-0">
        <span
          id={countryId}
          className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-200"
        >
          País
        </span>
        <span
          className={`${inputBase} inline-flex w-full items-center justify-center gap-2 px-3`}
          aria-labelledby={countryId}
          title="Búsqueda solo en Argentina"
        >
          <MapPin aria-hidden="true" size={16} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
          Argentina
        </span>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:mb-0"
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
