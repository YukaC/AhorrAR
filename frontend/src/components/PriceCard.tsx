import { ArrowUpRight, Crown, Globe, PackageCheck, Store } from 'lucide-react';
import type { ProductResult } from '../../../shared/contract';
import { countryLocale, displayName, formatPrice, storeHost, storeInitials } from '../lib/format';

interface PriceCardProps {
  result: ProductResult;
}

const badgeClass =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium';

export default function PriceCard({ result }: PriceCardProps) {
  const { rank, name, price, currency, store, url, image, shipping } = result;
  const priceLabel = formatPrice(price, currency, countryLocale(shipping.country));
  const isLocal = store.local;
  const isTop = rank === 1;
  const displayNameLabel = displayName(name);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex h-full flex-col gap-4 rounded-2xl border bg-white p-5 transition-[transform,box-shadow,border-color,background-color,color] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg active:translate-y-0 active:scale-[0.98] active:shadow-none focus-visible:ring-accent-500 sm:p-6 dark:bg-neutral-900 dark:hover:shadow-none ${
        isTop
          ? 'border-accent-500 shadow-lg ring-2 ring-accent-500/25 dark:border-accent-500'
          : 'border-neutral-200 shadow-card hover:border-accent-300 dark:border-neutral-700 dark:hover:border-accent-700'
      }`}
      aria-label={`Oferta ${rank}: ${displayNameLabel} por ${priceLabel} en ${store.name}. Abrir en una pestaña nueva`}
    >
      <div className="flex items-start justify-between gap-3">
        {isTop ? (
          <span className={`${badgeClass} bg-accent-600 text-white dark:bg-accent-500 dark:text-white`}>
            <Crown aria-hidden="true" size={12} />
            Mejor precio
          </span>
        ) : (
          <span className="text-sm font-semibold text-accent-800 dark:text-accent-300">#{rank}</span>
        )}
        <span
          className={`${badgeClass} ${
            isLocal
              ? 'bg-accent-100 text-accent-900 dark:bg-accent-500/20 dark:text-accent-200'
              : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
          }`}
        >
          {isLocal ? (
            <Store aria-hidden="true" size={12} />
          ) : (
            <Globe aria-hidden="true" size={12} />
          )}
          {isLocal ? 'Local' : 'Internacional'}
        </span>
      </div>

      <p className="text-3xl font-extrabold tracking-tight text-accent-800 tabular-nums dark:text-accent-300">
        {priceLabel}
      </p>

      <div className="flex items-start gap-3.5">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-xl border border-neutral-200 object-cover dark:border-neutral-700"
          />
        ) : null}
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-neutral-900 dark:text-neutral-100">
          {displayNameLabel}
        </h3>
      </div>

      <div className="mt-auto flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-900 dark:bg-accent-500/25 dark:text-accent-200"
        >
          {storeInitials(store.name)}
        </span>
        <span className="truncate text-sm text-neutral-700 dark:text-neutral-200">{store.name}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badgeClass} bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200`}>
          <PackageCheck aria-hidden="true" size={12} />
          Envío confirmado
        </span>
        {shipping.free ? (
          <span className={`${badgeClass} bg-accent-100 text-accent-900 dark:bg-accent-500/20 dark:text-accent-200`}>
            Envío gratis
          </span>
        ) : null}
        {result.installments?.interestFree ? (
          <span
            className={`${badgeClass} bg-accent-100 text-accent-900 dark:bg-accent-500/20 dark:text-accent-200`}
            aria-label={`${result.installments.count} cuotas sin interés`}
          >
            {result.installments.count} cuotas sin interés
          </span>
        ) : null}
        {shipping.eta ? (
          <span className="text-xs text-neutral-600 dark:text-neutral-300">{shipping.eta}</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-700">
        <span className="text-xs text-neutral-600 dark:text-neutral-300">vía {storeHost(store.siteUrl)}</span>
        <span className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-accent-800 group-hover:gap-1.5 dark:text-accent-300">
          Comprar
          <ArrowUpRight aria-hidden="true" size={16} />
        </span>
      </div>
    </a>
  );
}
