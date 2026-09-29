# Política de crawl — AhorrAR

> Política del proyecto (no es asesoramiento legal). Complementa [`PRIVACY.md`](../PRIVACY.md) y [`SECURITY.md`](../SECURITY.md).

## Qué crawleamos

- Tiendas de retail en Argentina listadas o descubiertas vía [`shared/ar-shops.json`](../shared/ar-shops.json) (índice curado + discovery).
- APIs públicas de catálogo cuando existen (VTEX, Woo Store API, Shopify products/suggest).
- Mercado Libre **solo** por API OAuth oficial — ⊥ HTML de listado ML (ToS; ver [`ML.md`](ML.md)).

## Cómo nos comportamos

| Regla | Detalle |
|---|---|
| User-Agent | Identificable (Scrapling TLS impersonate rotativo en fetch; no fingir ser un browser de usuario final en stealth de prod). |
| Stealth / browser | `STEALTH_FETCH=0` en prod Micro; cascade browser solo local/opt-in. |
| robots.txt | Motor legacy Node respeta vía `robots.ts`. Primario Scrapling: política documentada en SPEC (VTEX API pública + índice curado); no se usa como bypass de ToS de ML. |
| Rate | Presupuesto bajo en Micro (`FETCH_WORKERS≤2`, límites hub/api/html); cortesía implícita por cola y timeouts. |
| Secrets | Tokens ML solo en env / volume; nunca en git. |

## Opt-out de tiendas

Si operás una tienda y querés quedar fuera del índice:

1. Abrí un issue en [github.com/YukaC/AhorrAR](https://github.com/YukaC/AhorrAR) con el host y contacto.
2. O mail al maintainer del repo (ver [SECURITY.md](../SECURITY.md) / perfil GitHub).

Marcaremos `alive:false` (o quitaremos la entry) en `shared/ar-shops.json` y no seedearemos ese host.

## Discovery

Hosts nuevos descubiertos en un crawl **no** se tratan como confiables hasta pasar probe. Persistencia exige TLD/allowlist y rechazo de destinos privados (anti-SSRF) — ver §V / implementación T59.

## Límites de producto

Comparador de precios para usuarios finales. No revendemos datos de crawl como dataset. Resultados se muestran en vivo / caché corta (TTL).
