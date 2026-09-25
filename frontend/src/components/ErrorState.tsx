import { AlertTriangle, RotateCcw } from 'lucide-react';

const ERROR_NAME: Record<number, string> = {
  0: 'Servidor no disponible',
  400: 'Solicitud no válida',
  404: 'Búsqueda no encontrada',
  408: 'Tiempo de espera agotado',
  429: 'Demasiadas solicitudes',
  500: 'Error del servidor',
  502: 'Respuesta no válida',
  503: 'Servicio no disponible',
};

interface ErrorStateProps {
  message: string;
  code: number | null;
  onRetry: () => void;
}

export default function ErrorState({ message, code, onRetry }: ErrorStateProps) {
  const codeClass = code !== null ? ERROR_NAME[code] : undefined;
  return (
    <div
      role="alert"
      className="animate-view-in flex flex-col items-center gap-3 rounded-2xl border border-destructive-border bg-destructive-soft p-8 text-center"
    >
      <AlertTriangle aria-hidden="true" size={36} className="text-destructive" />
      <h2 className="text-lg font-bold text-destructive-soft-foreground">
        {codeClass ?? 'Algo salió mal'}
        {code !== null ? <span className="ml-2 text-sm font-normal">({code})</span> : null}
      </h2>
      <p className="max-w-md text-sm text-destructive-soft-foreground/90">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.97]"
      >
        <RotateCcw aria-hidden="true" size={16} />
        Reintentar
      </button>
    </div>
  );
}
