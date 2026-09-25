import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductResult } from '../../../shared/contract';
import PriceCard from './PriceCard';

const result: ProductResult = {
  rank: 1,
  name: 'Apple iPhone 16 128GB Negro',
  price: 1249999,
  currency: 'ARS',
  store: {
    name: 'Mercado Libre',
    logo: null,
    local: true,
    siteUrl: 'https://www.mercadolibre.com.ar',
  },
  url: 'https://producto.mercadolibre.com.ar/MLA-1',
  image: null,
  shipping: { confirmed: true, country: 'AR', type: 'local', free: true, eta: '2-5 días' },
  depth: 1,
  sourceUrl: 'https://listado.mercadolibre.com.ar/iphone-16',
};

describe('PriceCard', () => {
  it('renders the whole card as an external link', () => {
    render(<PriceCard result={result} />);
    const link = screen.getByRole('link', { name: /Oferta 1/ });
    expect(link).toHaveAttribute('href', result.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows price, best-price badge, store, shipping badges', () => {
    render(<PriceCard result={result} />);
    expect(screen.getAllByText(/1\.249\.999/).length).toBeGreaterThan(0);
    expect(screen.getByText('Mejor precio')).toBeInTheDocument();
    expect(screen.getByText('Mercado Libre')).toBeInTheDocument();
    expect(screen.getByText('Envío confirmado')).toBeInTheDocument();
    expect(screen.getByText('Envío gratis')).toBeInTheDocument();
    expect(screen.getByText('2-5 días')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('shows the rank number for non-top results', () => {
    render(<PriceCard result={{ ...result, rank: 3 }} />);
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.queryByText('Mejor precio')).not.toBeInTheDocument();
  });

  it('falls back to initials avatar when there is no logo', () => {
    render(<PriceCard result={result} />);
    expect(screen.getByText('ML')).toBeInTheDocument();
  });
});