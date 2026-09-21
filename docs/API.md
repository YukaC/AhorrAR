# AhorrAR API

Single source of truth for types: [`shared/contract.ts`](../shared/contract.ts). All shapes below
must match it (checked at runtime by `isSearchResponse` and covered by unit tests).

Base URL (dev): `http://localhost:4000`

Live-only: toda búsqueda dispara el crawler real (Playwright). Tests herméticos
inyectan fixtures; no existe modo mock en runtime.

## POST /api/search

Start a search job. Returns `202` immediately; client then listens to SSE.

```bash
curl -s -X POST http://localhost:4000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"product":"perfume","country":"AR","maxDepth":1,"maxResults":5}'
# {"searchId":"7f8a3c","status":"queued","params":{...}}
```

Body: `SearchParams` (`product` required, `country` must be `AR` for live seeds;
`MX`/`ES` quedan en el contrato/calendario pero el índice de seeds es AR-only).

## GET /api/search/:id

Poll job state. Keys opcionales `result` / `error` solo presentes si existen (§V10).

```json
{
  "searchId": "7f8a3c",
  "status": "done",
  "params": { "product": "perfume", "country": "AR", "maxDepth": 1, "maxResults": 5 },
  "createdAt": "2026-09-20T12:00:00.000Z",
  "progress": { "searchId": "7f8a3c", "status": "done", "depth": 1, "nodesVisited": 12, "resultsFound": 4 },
  "result": { "...": "SearchResponse, abajo" }
}
```

## GET /api/search/:id/events

Server-Sent Events stream with live `SearchProgress` updates.

```
data: {"searchId":"7f8a3c","status":"running","depth":1,"nodesVisited":23,"resultsFound":2}
```

## GET /api/calendar/:country

Return event calendar + next event for a country (`AR`, `MX`, `ES`).

## GET /api/health

`{ "ok": true, "mode": "live", "uptime": 12 }`

## SearchResponse — example

```json
{
  "query": { "product": "perfume", "country": "AR", "maxDepth": 1, "maxResults": 5 },
  "generatedAt": "2026-09-20T12:00:01.000Z",
  "event": {
    "activeToday": false,
    "nextEvent": { "name": "Hot Sale AR", "date": "2026-05-04", "daysLeft": 123 }
  },
  "results": [
    {
      "rank": 1,
      "name": "Perfume Dolce 100ml",
      "price": 14500,
      "currency": "ARS",
      "store": { "name": "MercadoLibre", "logo": null, "local": true, "siteUrl": "https://www.mercadolibre.com.ar" },
      "url": "https://www.mercadolibre.com.ar/p/MLA-1234567890",
      "image": "https://http2.mlstatic.com/D_NQ_NP_....jpg",
      "shipping": { "confirmed": true, "country": "AR", "type": "local", "free": true },
      "depth": 0,
      "sourceUrl": "https://listado.mercadolibre.com.ar/perfume"
    }
  ],
  "stats": {
    "source": "live",
    "nodesVisited": 12,
    "linksQueued": 41,
    "pagesFetched": 10,
    "maxDepthReached": 1,
    "skippedNoShipping": 3,
    "skippedDedupe": 2,
    "elapsedMs": 8200
  }
}
```

Rules: every result has `shipping.confirmed === true` (§V1); `price>0` in the destination country's
currency (§V2); local stores rank before international at equal cost (§V4); images from og:image /
first valid `<img>` (§V11).
