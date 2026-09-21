import { useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { SearchParams } from '../../../shared/contract';

interface SearchBarProps {
  busy: boolean;
  onSearch: (params: SearchParams) => void;
}

const inputBase =
  'h-11 w-full rounded-xl border border-neutral-300 bg-white text-neutral-900 ' +
  'placeholder:text-neutral-400 transition-colors disabled:cursor-not-allowed disabled:bg-neutral-100 ' +
  'hover:border-accent-400 focus-visible:border-accent-500 ' +
  'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 ' +
  'dark:disabled:bg-neutral-800 dark:hover:border-accent-500';

export default function SearchBar({ busy, onSearch }: SearchBarProps) {
  const [product, setProduct] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = product.trim();
    if (!trimmed || busy) return;
    // AR-only live search — shallow crawl, fast.
    onSearch({ product: trimmed, country: 'AR', maxDepth: 1, maxResults: 10 });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row" role="search">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-neutral-400"
          size={18}
        />
        <input
          type="text"
          autoFocus
          required
          maxLength={120}
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          aria-label="Producto a buscar"
          placeholder="Ej: bensimon, iPhone 16, placa de video…"
          className={`${inputBase} pl-11 pr-4`}
        />
      </div>

      <span
        className={`${inputBase} inline-flex w-full items-center justify-center gap-2 px-3 sm:w-40 sm:shrink-0`}
        aria-label="País fijo Argentina"
        title="Búsqueda solo en Argentina"
      >
        🇦🇷 Argentina
      </span>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
