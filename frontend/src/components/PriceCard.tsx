import { ArrowUpRight, Crown, Globe, PackageCheck, Store } from 'lucide-react';
import type { ProductResult } from '../../../shared/contract';
import { countryLocale, displayName, formatPrice, storeHost, storeInitials } from '../lib/format';

interface PriceCardProps {
  result: ProductResult;
}

const badgeClass = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium';

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
      className={`group flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 text-card-foreground transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg active:translate-y-0 active:scale-[0.98] active:shadow-none focus-visible:ring-ring sm:p-6 ${
        isTop
          ? 'border-accent-500 shadow-lg ring-2 ring-accent-500/25'
          : 'border-border shadow-card hover:border-accent-300'
      }`}
      aria-label={`Oferta ${rank}: ${displayNameLabel} por ${priceLabel} en ${store.name}. Abrir en una pestaña nueva`}
    >
      <div className="flex items-start justify-between gap-3">
        {isTop ? (
          <span className={`${badgeClass} bg-primary text-primary-foreground`}>
            <Crown aria-hidden="true" size={12} />
            Mejor precio
          </span>
        ) : (
          <span className="text-sm font-semibold text-brand">#{rank}</span>
        )}
        <span
          className={`${badgeClass} ${
            isLocal
              ? 'bg-primary-soft text-primary-soft-foreground'
              : 'bg-muted text-muted-foreground'
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

      <p className="text-3xl font-extrabold tracking-tight text-brand tabular-nums">{priceLabel}</p>

      <div className="flex items-start gap-3.5">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : null}
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-foreground">
          {displayNameLabel}
        </h3>
      </div>

      <div className="mt-auto flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground"
        >
          {storeInitials(store.name)}
        </span>
        <span className="truncate text-sm text-muted-foreground">{store.name}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badgeClass} bg-primary-soft text-primary-soft-foreground`}>
          <PackageCheck aria-hidden="true" size={12} />
          Envío confirmado
        </span>
        {shipping.free ? (
          <span className={`${badgeClass} bg-primary-soft text-primary-soft-foreground`}>
            Envío gratis
          </span>
        ) : null}
        {result.installments?.interestFree ? (
          <span
            className={`${badgeClass} bg-primary-soft text-primary-soft-foreground`}
            aria-label={`${result.installments.count} cuotas sin interés`}
          >
            {result.installments.count} cuotas sin interés
          </span>
        ) : null}
        {shipping.eta ? (
          <span className="text-xs text-muted-foreground">{shipping.eta}</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">vía {storeHost(store.siteUrl)}</span>
        <span className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-brand group-hover:gap-1.5">
          Comprar
          <ArrowUpRight aria-hidden="true" size={16} />
        </span>
      </div>
    </a>
  );
}
