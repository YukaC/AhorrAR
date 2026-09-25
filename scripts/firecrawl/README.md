# Firecrawl recorder

Herramienta de dev para **estudiar e imitar** cómo trabaja Firecrawl sin quemar
créditos. Patrón VCR: se graban respuestas reales de la API (plan free) como
fixtures y un mock server local las reproduce con la misma forma de API.

## Cómo funciona Firecrawl (resumen)

Firecrawl es un servicio SaaS de scraping (open source, self-hostable). Su
pipeline por página es:

1. **Fetch** con navegador headless (Playwright) → renderiza JS, resuelve
   anti-bot, espera red/animaciones (`waitFor`).
2. **Content extraction**: detecta el contenido principal (boilerplate removal,
   `onlyMainContent`) y lo convierte a **markdown limpio**.
3. **Metadata + links**: título, descripción, language, statusCode, scrapeId, y
   todos los links de la página.

### API (v2, la que usa el SDK `firecrawl` v4)

| Endpoint | Body | Respuesta |
|---|---|---|
| `POST /v2/scrape` | `{ url, formats: ["markdown","links"], onlyMainContent }` | `{ success, data: { markdown, links, metadata: { title, description, language, sourceURL, statusCode, scrapeId } } }` — `metadata` viene por defecto, no es un format |
| `POST /v2/map` | `{ url, limit }` | `{ success, id, links: [{ url, title, description }] }` (descubrimiento de URLs: sitemap + crawleo ligero) |
| `POST /v2/search` | `{ query, limit }` | `{ success, data: { web: [{ url, title, description, position }] } }` (buscador; sin markdown en v2) |
| `POST /v2/crawl` | `{ url, limit, maxDepth, scrapeOptions }` | async: `{ success, id }` → poll `GET /v2/crawl/{id}` |

Auth: `Authorization: Bearer <key>`. El CLI (`firecrawl-cli`) envuelve esto; sin
key usa el tier keyless (`/v2/scrape` sin header, rate-limited por IP).

## Uso

### 1. Grabar fixtures (gasta ~3-5 créditos del plan free)

```bash
node scripts/firecrawl/record.mjs
```

Lee la key de `FIRECRAWL_API_KEY` o de `~/.config/firecrawl-cli/credentials.json`
(la que deja `firecrawl config`). Guarda en `scripts/firecrawl/fixtures/`:

- `scrape-fravega-home.json` — markdown + links + metadata de una homepage retail JS-heavy.
- `map-fravega.json` — descubrimiento de URLs del sitio.
- `search-iphone16-ar.json` — resultados de búsqueda.
- `manifest.json` — índice (request → fixture) que usa el mock.

### 2. Replay local (0 créditos)

```bash
node scripts/firecrawl/mock-server.mjs   # :4101, o PORT=xxxx
```

Implementa `POST /v2/scrape`, `/v2/map` y `/v2/search` sirviendo los fixtures.
Match por URL/query (no requiere el body exacto). URL sin fixture → 404 con
`{ success: false, error }`.

Probar:

```bash
curl -s localhost:4101/v2/scrape -H 'Content-Type: application/json' \
  -d '{"url":"https://www.fravega.com","formats":["markdown"]}' | head -c 300
```

## Qué imitar en nuestro scraper (Python/Scrapling)

Estudiando los fixtures se puede replicar el valor de Firecrawl sin el SaaS:

1. **Markdown extraction**: nuestro parser HTML ya extrae precio/nombre; el
   fixture de scrape muestra qué contenido "limpio" produce Firecrawl (títulos,
   breadcrumbs, precios en texto) → guía para mejorar `scraper/` parsers.
2. **Map / URL discovery**: el fixture de map lista las URLs que Firecrawl
   descubre (sitemap + links) → comparar con nuestro BFS de seeds
   (`shared/ar-shops.json`) para detectar páginas de producto que no estamos
   alcanzando.
3. **Search**: el fixture de search muestra cómo Firecrawl combina buscador +
   scrape → útil si algún día queremos descubrimiento por query en vez de por
   índice curado.

> Nota: Firecrawl **no** expone `installments` de MercadoLibre ni datos que la
> API de ML no dé (ver `docs/ML.md` y §V18). El recorder es para estudiar
> técnica de scraping, no para reemplazar fuentes de datos.

## Créditos

El plan free de Firecrawl da ~1.000 créditos/ciclo. `record.mjs` usa 3-5 por
ejecución. Correrlo solo cuando se quiera re-grabar (los fixtures ya commiteados
sirven para el mock sin gastar nada).