# Attributions & inspiration — AhorrAR

> Qué tomamos de proyectos de terceros, de dónde, bajo qué licencia, y por qué no
> hay conflicto legal. Actualizado cada vez que se incorpora una inspiración nueva.

## Firecrawl (inspiración de diseño, sin código copiado)

| Campo | Detalle |
|---|---|
| Proyecto | [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) — "The web data API to search, scrape, and interact at scale" |
| Autor | Sideguide Technologies Inc. (d/b/a Firecrawl) |
| Licencia | **AGPL-3.0** (core) + **MIT** (SDKs y algunos componentes UI) — ver `LICENSE` del repo upstream |
| Relación | **Inspiración de conceptos** + cliente de la **API SaaS** (plan free) para grabar fixtures de dev |

### Qué tomamos (conceptos, reimplementados desde cero)

| Concepto | Dónde vive en AhorrAR | Cómo se implementó |
|---|---|---|
| Caché de ofertas por host (index-cache) | `scraper/src/ahorrar_scraper/offer_cache.py` | Implementación propia en Python: TTL 10min, dedupe por URL, cap 30/host, 64 hosts, query-agnostic con filtro de relevancia al reutilizar |
| URL discovery vía sitemap | `scraper/src/ahorrar_scraper/seeds.py` (`sitemap_candidate_hosts` / `sitemap_product_urls`) | Implementación propia: hosts no-VTEX curados, regex `<loc>`, caché 24h, worker background |
| Probes en paralelo (pipeline 2 etapas) | `scraper/src/ahorrar_scraper/crawl.py` (`launch_batch` / `process_batch`) | Implementación propia sobre `ThreadPoolExecutor` + `FetcherSession` de Scrapling |
| Warm cache de búsquedas populares | `scraper/src/ahorrar_scraper/server.py` (`_warm_loop`, gated `WARM_CACHE=1`) | Implementación propia: 5 queries, 300s, presupuesto bajo |
| Recorder VCR + mock server (estudio de la API) | `scripts/firecrawl/` (`record.mjs`, `mock-server.mjs`, `fixtures/`) | Código **propio** que consume la API pública de Firecrawl (patrón VCR) — no es código de Firecrawl |

### Por qué no hay conflicto de licencia

1. **No copiamos código de Firecrawl.** Las obligaciones de AGPL-3.0 (copyleft, red)
   aplican a obras **derivadas** (código copiado/modificado). Nuestro scraper es
   código original en Python/Scrapling; los comentarios del código dicen
   "Firecrawl-style/inspired" para señalar la procedencia del **concepto**, no una
   derivación.
2. **Las ideas y algoritmos no son copyrightables** — solo su expresión concreta.
   Caché por host, sitemap discovery y warm cache son patrones conocidos de la
   industria; Firecrawl los popularizó en su producto, no los inventó como
   expresión protegida.
3. **El recorder usa la API SaaS** de Firecrawl (plan free, ~3-5 créditos por
   ejecución) bajo sus **ToS de servicio** — uso normal de un cliente de API, igual
   que usar la API de MercadoLibre. No redistribuimos el servicio ni su código.
4. **Los fixtures son dev-only**: contienen respuestas de la API (markdown de
   fravega.com, URLs, resultados de búsqueda) grabadas para estudio local. No se
   sirven en producción (no están en `Dockerfile` ni `vercel.json`) ni se
   redistribuyen comercialmente.

### Riesgo residual y mitigación

| Riesgo | Nivel | Mitigación |
|---|---|---|
| Que un reviewer confunda "inspirado en" con "derivado de" | Bajo | Este doc + comentarios "Firecrawl-style" en el código + NOTICE |
| ToS del SaaS Firecrawl cambien | Bajo | El recorder es opcional (dev); el scraper no depende de Firecrawl en runtime |
| Contenido de terceros en fixtures (fravega.com) | Bajo | Dev-only, no redistribuido; si se publica el repo, es material de estudio de una página pública |

## Otras dependencias

Ver `NOTICE` (raíz) para la lista de dependencias de terceros (Scrapling BSD-3-Clause,
Playwright Apache-2.0, npm/Python packages) y `LICENSE` (MIT) para la licencia del
proyecto.

## Cookies y privacidad

Ver `PRIVACY.md` (raíz). Resumen: el frontend **no** usa cookies de tracking,
analytics ni pixels; solo `localStorage` funcional (preferencia de tema + resume de
la última búsqueda tras refresh). El scraper no persiste cookies de terceros.