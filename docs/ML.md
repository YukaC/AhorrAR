# MercadoLibre — estrategia AhorrAR (post-eval 2026-09-21)

Fuente: análisis [Grok 4.6](internal) + verificación live API 403 sin OAuth.

## Decisión

| Prioridad | Camino | Notas |
|---|---|---|
| **1 PRIMARY** | API oficial MLA + OAuth user token | Legal, JSON, precio/permalink/thumb/shipping |
| **2 FALLBACK** | Scrapling StealthyFetcher + proxies residenciales AR | Solo si app ML rechazada / 403 persistente |
| **⊥** | Octoparse, GitHub scrapers, HTML listado, search sin token | No adoptar |

## Gate

1. Crear app en [DevCenter ML](https://developers.mercadolibre.com.ar)
2. OAuth Authorization Code → `MELI_ACCESS_TOKEN` + `MELI_REFRESH_TOKEN`
3. Probar: `GET /sites/MLA/search?q=bensimon` con `Authorization: Bearer …`
4. Si 200 con `results[].price` → activar `INCLUDE_ML=1` / token en scraper env

## Env (scraper)

```
MELI_ACCESS_TOKEN=
MELI_REFRESH_TOKEN=          # refresh one-shot; rotar al renovar
MELI_APP_ID=
MELI_CLIENT_SECRET=
MELI_REDIRECT_URI=
MELI_SITE_ID=MLA
```

Sin `MELI_ACCESS_TOKEN`, el crawler **no** scrapeá ML HTML (aunque `includeMl=true`).

## §V1 shipping

Confirmar oferta si `free_shipping` **o** `mode` me1/me2 **o** `logistic_type` usable (≠ `not_specified`).
