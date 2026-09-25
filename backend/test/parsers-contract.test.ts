import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVtexCatalogApi } from '../src/search/parsers/vtex-api.ts';
import { buildSeedUrls } from '../src/search/seeds.ts';
import type { RawItem } from '../src/search/types.ts';

/**
 * Contrato de parsers VTEX (Fase 4, §V18/§V19).
 * Mismo fixture (`shared/fixtures/vtex-contract-fixture.json`) para ambos
 * motores: el parser Node legacy y `parse_vtex_catalog` (Python/Scrapling).
 * Garantiza que un producto con la misma forma de datos produce los mismos
 * makers (name, price, url) sin importar qué motor lo procesa.
 */

const FIXTURE_PATH = join(process.cwd(), '..', 'shared/fixtures/vtex-contract-fixture.json');
const SCRAPER_CWD = join(process.cwd(), '..', 'scraper');
const FIXTURE_URL = 'https://www.fravega.com/api/catalog_system/pub/products/search/?ft=sunset&_from=0&_to=11';
const VENEX_FIXTURE = join(process.cwd(), '..', 'shared/fixtures/venex-enhanced-click-fixture.html');
const VENEX_URL = 'https://www.venex.com.ar/resultado-busqueda.htm?keywords=rx9070xt';

interface ContractHit {
  name: string;
  price: number;
  url: string;
  installments: { count: number; interestFree: boolean } | null;
}

const { products } = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  products: Array<{ productName: string; linkText: string; items: Array<{ images: Array<{ imageUrl?: string }>; sellers: Array<{ commertialOffer?: Record<string, unknown> }> }> }>;
};

/** Motor Node (legacy). */
function nodeParse(): ContractHit[] {
  const out = parseVtexCatalogApi(FIXTURE_URL, JSON.stringify(products), { product: 'sunset', country: 'AR' });
  return out.results.map((r: RawItem) => ({
    name: r.name,
    price: Number(r.priceRaw),
    url: r.url,
    installments: null,
  }));
}

/** Motor Python (Scrapling primario). */
function pythonParse(): ContractHit[] {
  const script = `
import json, sys
sys.path.insert(0, 'src')
from ahorrar_scraper.parsers import parse_vtex_catalog
url = sys.argv[1]
body = json.dumps(json.load(open(sys.argv[2]))["products"])
rows = parse_vtex_catalog(url, body)
for r in rows:
    if isinstance(r.get("installments"), dict):
        inst = {"count": r["installments"]["count"], "interestFree": r["installments"]["interestFree"]}
    else:
        inst = None
    print(json.dumps({"name": r["name"], "price": float(r["price"]), "url": r["url"], "installments": inst}))
`;
  const out = execFileSync('uv', ['run', 'python', '-c', script, FIXTURE_URL, FIXTURE_PATH], {
    cwd: SCRAPER_CWD,
    encoding: 'utf8',
  });
  return out
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ContractHit);
}

function sortHits(hits: ContractHit[]): ContractHit[] {
  return hits.sort((a, b) => a.url.localeCompare(b.url));
}

describe('contrato de parsers VTEX · Node vs Python (Fase 4)', () => {
  it('ambos motores extraen el mismo set de productos (name/price/url) del mismo fixture', () => {
    const node = sortHits(nodeParse());
    const py = sortHits(pythonParse());

    expect(py).toHaveLength(2); // agotado (AvailableQuantity=0) se descarta en ambos
    expect(node).toHaveLength(2);
    expect(node.map((h) => h.name)).toEqual(py.map((h) => h.name));
    expect(node.map((h) => h.price)).toEqual(py.map((h) => h.price));
    expect(node.map((h) => h.url)).toEqual(py.map((h) => h.url));
    // Frávega: /p/{slug}-{itemId}/ — never legacy /{linkText}/p with productId
    expect(node.map((h) => h.url)).toEqual([
      'https://www.fravega.com/p/bensimon-bold-deodorant-150ml-778900/',
      'https://www.fravega.com/p/bensimon-sunset-edp-100ml-778899/',
    ]);
    for (const h of node) {
      expect(h.url).not.toMatch(/\/p$/);
    }
  });

  it('Node no inventa installments; Python los expone solo si la API los trae (§V18)', () => {
    const py = pythonParse();
    for (const row of py) {
      expect(row.installments).not.toBeNull();
      expect(row.installments!.count).toBeGreaterThanOrEqual(8);
      expect(row.installments!.interestFree).toBe(true);
    }
    const node = nodeParse();
    for (const row of node) {
      expect(row.installments).toBeNull(); // el parser Node JSON no los expone — gap conocido §V18
    }
  });

  it('el fixture cubre el caso agotado (disponibilidad cero se filtra)', () => {
    expect(products).toHaveLength(3);
    const py = pythonParse();
    expect(py.some((h) => /agotado/i.test(h.name))).toBe(false);
  });

  it('parse_page extrae el formato enhancedClick de Venex (resultado-busqueda) y descarta sin precio válido', () => {
    const script = `
import json, sys
sys.path.insert(0, 'src')
from ahorrar_scraper.parsers import parse_page
body = open(sys.argv[1], encoding="utf-8").read()
rows = parse_page(sys.argv[2], body)
for r in rows:
    print(json.dumps({"name": r["name"], "price": float(r["price"]), "url": r["url"], "image": r.get("image")}))
`;
    const out = execFileSync('uv', ['run', 'python', '-c', script, VENEX_FIXTURE, VENEX_URL], {
      cwd: SCRAPER_CWD,
      encoding: 'utf8',
    });
    const hits = out
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as ContractHit & { image: string | null });

    expect(hits).toHaveLength(2); // RTX 5090 queda fuera: precio "XXXX" no parseable
    const vga = hits.find((h) => /RX 9070 XT/i.test(h.name));
    expect(vga?.price).toBe(1_499_999);
    expect(vga?.url).toMatch(/reaper-16gb-gddr6\.html/);
    expect(vga?.url).not.toMatch(/[?&]keywords=/); // listing leftovers stripped
    expect(vga?.image).toMatch(/^https:\/\/www\.venex\.com\.ar\/products_images\/thumb\//);
    expect(hits.some((h) => /Camara IP/i.test(h.name))).toBe(true);
    expect(hits.every((h) => typeof h.image === 'string' && h.image.startsWith('https://'))).toBe(true);
  });
  it('parse_page extrae Woo Store API y Shopify suggest (sin inventar installments)', () => {
    const script = `
import json, sys
sys.path.insert(0, 'src')
from ahorrar_scraper.parsers import parse_page

woo_url = "https://www.ejemplo-woo.com.ar/wp-json/wc/store/v1/products?search=notebook&per_page=12"
woo_body = open(sys.argv[1], encoding="utf-8").read()
woo = parse_page(woo_url, woo_body)
print("WOO", json.dumps([{"name": r["name"], "price": r["price"], "url": r["url"], "shippingHint": r["shippingHint"], "installments": r.get("installments")} for r in woo]))

shop_url = "https://www.ejemplo-shop.com.ar/search/suggest.json?q=notebook&resources[type]=product"
shop_body = open(sys.argv[2], encoding="utf-8").read()
shop = parse_page(shop_url, shop_body)
print("SHOP", json.dumps([{"name": r["name"], "price": r["price"], "url": r["url"], "shippingHint": r["shippingHint"]} for r in shop]))
`;
    const wooFixture = join(process.cwd(), '..', 'shared/fixtures/woo-store-api-fixture.json');
    const shopFixture = join(process.cwd(), '..', 'shared/fixtures/shopify-suggest-fixture.json');
    const out = execFileSync('uv', ['run', 'python', '-c', script, wooFixture, shopFixture], {
      cwd: SCRAPER_CWD,
      encoding: 'utf8',
    });
    const lines = out.trim().split('\n');
    const wooLine = lines.find((l) => l.startsWith('WOO '));
    const shopLine = lines.find((l) => l.startsWith('SHOP '));
    expect(wooLine).toBeDefined();
    expect(shopLine).toBeDefined();
    const woo = JSON.parse(wooLine!.slice(4)) as Array<{
      name: string;
      price: number;
      url: string;
      shippingHint: string;
      installments?: unknown;
    }>;
    const shop = JSON.parse(shopLine!.slice(5)) as Array<{
      name: string;
      price: number;
      url: string;
      shippingHint: string;
    }>;

    expect(woo).toHaveLength(2); // "X" descartado por nombre corto
    expect(woo[0]!.price).toBe(899_990);
    expect(woo[0]!.shippingHint).toBe('Envío a domicilio');
    expect(woo.every((r) => r.installments === undefined || r.installments === null)).toBe(true);

    expect(shop).toHaveLength(1); // solo Dell notebook (filtro por tokens de q=)
    expect(shop[0]!.name).toMatch(/Dell/i);
    expect(shop[0]!.price).toBe(1_250_999);
    expect(shop[0]!.url).toMatch(/\/products\/notebook-dell/);
    expect(shop[0]!.shippingHint).toBe('Envío a domicilio');
  });
});

describe('contrato de seeds Node↔Python (§V19)', () => {
  /** Motor Python: build_seed_urls imprime una URL JSON por línea. */
  function pySeeds(product: string): string[] {
    const script = `
import json, sys
sys.path.insert(0, 'src')
from ahorrar_scraper.seeds import build_seed_urls
for u in build_seed_urls(sys.argv[1]):
    print(json.dumps(u))
`;
    const out = execFileSync('uv', ['run', 'python', '-c', script, product], {
      cwd: SCRAPER_CWD,
      encoding: 'utf8',
    });
    return out
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as string);
  }

  it('query gaming → mismos hubs + 20 curados en el mismo orden; gaming primero', () => {
    const node = buildSeedUrls({ product: 'rx 9060 xt', country: 'AR', maxResults: 5 }).slice(0, 24);
    const py = pySeeds('rx 9060 xt');
    expect(py).toHaveLength(24);
    expect(node).toEqual(py); // 4 hubs + 20 curados, idénticos y en el mismo orden
    // categoría-prioridad: la entrada VTEX de compragamer (gaming) va primera
    expect(node[4]).toMatch(/compragamer\.com\/api\/catalog_system/);
  });

  it('query perfumería → mismos seeds; perfumería primero', () => {
    const node = buildSeedUrls({ product: 'perfume bensimon', country: 'AR', maxResults: 5 }).slice(0, 24);
    const py = pySeeds('perfume bensimon');
    expect(node).toEqual(py);
    expect(node.slice(4, 10).join(' ')).toMatch(/farmacity\.com/);
  });
});