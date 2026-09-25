import { MapPin, RotateCcw, SearchX } from 'lucide-react';
import type { SearchParams } from '../../../shared/contract';
import { countryName } from '../lib/countries';

interface EmptyStateProps {
  params: SearchParams;
  filtered: boolean;
  onRetry: () => void;
}

export default function EmptyState({ params, filtered, onRetry }: EmptyStateProps) {
  return (
    <div className="animate-view-in flex flex-col items-center gap-4 rounded-2xl border border-border bg-card/90 p-8 text-center sm:p-10">
      <SearchX aria-hidden="true" size={36} className="text-muted-foreground" />
      <h2 className="text-lg font-bold text-foreground">
        {filtered ? 'No quedan resultados con el filtro' : 'Sin ofertas para esta búsqueda'}
      </h2>
      {filtered ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Ajustá precio mín/máx o probá con otro término.
        </p>
      ) : (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          No encontramos ofertas con envío confirmado para “
          <span className="font-medium text-foreground">{params.product}</span>” en{' '}
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" size={14} className="shrink-0" />
            {countryName(params.country)}
          </span>
          .
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-input bg-card px-4 text-sm font-medium text-foreground transition-[border-color,transform] hover:border-accent-400 active:scale-[0.97]"
      >
        <RotateCcw aria-hidden="true" size={16} />
        Reintentar
      </button>
    </div>
  );
}
