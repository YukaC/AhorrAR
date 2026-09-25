import type { ProductResult } from '../../../shared/contract';
import PriceCard from './PriceCard';

interface ResultsGridProps {
  results: ProductResult[];
}

export default function ResultsGrid({ results }: ResultsGridProps) {
  return (
    <ul
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Resultados de la búsqueda"
    >
      {results.map((result, index) => (
        <li
          key={`${result.url}-${result.rank}`}
          className="animate-card-in"
          style={{ animationDelay: `${index * 35}ms` }}
        >
          <PriceCard result={result} />
        </li>
      ))}
    </ul>
  );
}