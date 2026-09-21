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
      className="animate-view-in flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900/60 dark:bg-rose-500/10"
    >
      <AlertTriangle aria-hidden="true" size={36} className="text-rose-400 dark:text-rose-500" />
      <h2 className="text-lg font-bold text-rose-800 dark:text-rose-300">
        {codeClass ?? 'Algo salió mal'}
        {code !== null ? <span className="ml-2 text-sm font-normal">({code})</span> : null}
      </h2>
      <p className="max-w-md text-sm text-rose-700 dark:text-rose-200/90">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-700"
      >
        <RotateCcw aria-hidden="true" size={16} />
        Reintentar
      </button>
    </div>
  );
}