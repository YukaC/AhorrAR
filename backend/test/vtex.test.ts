import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/search/parsers/vtex.ts';
import { finalizeRawItem } from '../src/search/pipeline.ts';
import { getCountry } from '../src/calendar/countries.ts';

const AR = { product: 'perfume', country: 'AR' as const };
const country = getCountry('AR');

describe('VTEX parser (live AR stores)', () => {
  it('extrae productName + lowPrice + linkText del JSON embebido', () => {
    const html = `<html><body>
      <script>"productName":"EDT Agua Fresca x 120 ml","lowPrice":31450,"linkText":"eau-de-toilette-agua-fresca","imageUrl":"https://cdn.com/a.jpg"</script>
      <script>"productName":"EDP Nude Musk x 60 ml","lowPrice":31000,"linkText":"edp-nude-musk","imageUrl":"https://cdn.com/b.jpg"</script>
      Envío a domicilio
    </body></html>`;
    const out = parsePage('https://www.farmacity.com/perfume?_q=perfume&map=ft', html, AR);
    expect(out.results.length).toBe(2);
    expect(out.results[0]!.name).toMatch(/Agua Fresca/);
    expect(out.results[0]!.url).toContain('/eau-de-toilette-agua-fresca/p');
    const done = finalizeRawItem(out.results[0]!, AR, country);
    expect(done).not.toBeNull();
    expect(done!.price).toBe(31450);
    expect(done!.shipping.confirmed).toBe(true);
  });

  it('extrae shelf Frávega (title + BestPrice + /p)', () => {
    const html = `<ul><li>
      <a title="Bensimon Sunset Edp 100ml" href="https://www.fravega.com/bensimon-sunset-edp-100ml-990419518/p">
        <img src="https://fravega.vteximg.com.br/arquivos/ids/1.jpg" width="280">
      </a>
      <span class="prodPrice"><em class="ListPrice">$ 39.989</em><em class="BestPrice">$ 31.991</em></span>
    </li></ul>`;
    const out = parsePage('https://www.fravega.com/bensimon?_q=bensimon&map=ft', html, AR);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.name).toMatch(/Bensimon Sunset/);
    expect(out.results[0]!.priceRaw).toMatch(/31/);
    const done = finalizeRawItem(out.results[0]!, AR, country);
    expect(done?.price).toBe(31991);
    expect(done?.shipping.confirmed).toBe(true);
  });
});
