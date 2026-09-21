import { ArrowUpRight, PackageCheck } from 'lucide-react';
import type { ProductResult } from '../../../shared/contract';
import { countryLocale, formatPrice, storeHost, storeInitials } from '../lib/format';

interface PriceCardProps {
  result: ProductResult;
}

const badgeClass =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';

export default function PriceCard({ result }: PriceCardProps) {
  const { rank, name, price, currency, store, url, image, shipping } = result;
  const priceLabel = formatPrice(price, currency, countryLocale(shipping.country));
  const isLocal = store.local;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-lg focus-visible:ring-accent-500 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700 dark:hover:shadow-none"
      aria-label={`Oferta ${rank}: ${name} por ${priceLabel}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-accent-700 dark:text-accent-400">#{rank}</span>
        <span
          className={`${badgeClass} ${
            isLocal
              ? 'bg-accent-100 text-accent-800 dark:bg-accent-500/15 dark:text-accent-300'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
          }`}
          aria-label={isLocal ? 'Tienda local' : 'Tienda internacional'}
        >
          <span aria-hidden="true">{isLocal ? '🇱' : '🌍'}</span>
          {isLocal ? 'Local' : 'Internacional'}
        </span>
      </div>

      <p className="text-3xl font-extrabold tracking-tight text-accent-700 tabular-nums dark:text-accent-400">
        {priceLabel}
      </p>

      <div className="flex items-center gap-3">
        {image ? (
          <img
            src={image}
            alt={`Imagen del producto ${name}`}
            loading="lazy"
            className="size-12 shrink-0 rounded-lg border border-neutral-100 object-cover dark:border-neutral-700"
          />
        ) : null}
        <h3 className="line-clamp-2 text-sm leading-snug font-medium text-neutral-800 dark:text-neutral-200">
          {name}
        </h3>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-800 dark:bg-accent-500/20 dark:text-accent-300"
        >
          {storeInitials(store.name)}
        </span>
        <span className="truncate text-sm text-neutral-600 dark:text-neutral-300">{store.name}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badgeClass} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`}>
          <PackageCheck aria-hidden="true" size={12} />
          Envío confirmado
        </span>
        {shipping.free ? (
          <span className={`${badgeClass} bg-accent-100 text-accent-800 dark:bg-accent-500/15 dark:text-accent-300`}>
            Envío gratis
          </span>
        ) : null}
        {shipping.eta ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{shipping.eta}</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">vía {storeHost(store.siteUrl)}</span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-accent-700 group-hover:gap-1.5 dark:text-accent-400">
          Comprar
          <ArrowUpRight aria-hidden="true" size={16} />
        </span>
      </div>
    </a>
  );
}