# AhorrAR Scrapling crawler (PRIMARY live path)

Python service powered by [Scrapling](https://github.com/d4vinci/Scrapling).
Node/Express keeps the public API + ranking/shipping; this service does the crawl.

## Run

```bash
cd scraper
uv sync
uv run playwright install chromium   # optional, for StealthyFetcher later
uv run ahorrar-scraper               # http://127.0.0.1:4100
```

Env: `SCRAPER_HOST`, `SCRAPER_PORT` (default 4100).

## API

- `GET /health` → `{ ok, engine: scrapling }`
- `POST /crawl` `{ product, maxResults?, maxNodes?, maxDepth?, includeMl? }`
  → `{ results[], stats, mlBlocked }`

## Notes

- MercadoLibre: **API OAuth only** when `MELI_ACCESS_TOKEN` is set (see [`docs/ML.md`](../docs/ML.md)).
  No HTML listado scrape. Octoparse / random GitHub scrapers are rejected.
- VTEX catalog JSON + SERP discovery cover non-ML AR retail.
- In production this service runs inside the same Fly Docker image as the API
  (`ahorrar-api.fly.dev`); see [`docs/DEPLOY.md`](../docs/DEPLOY.md).
