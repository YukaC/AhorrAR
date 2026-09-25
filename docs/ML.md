# MercadoLibre — estrategia AhorrAR (actualizado 2026-09-23, v2)

## Realidad post-eval

- **El endpoint `/sites/{site}/search?q=` está DESCONTINUADO** (abril 2025). Devuelve
  `403 forbidden` aun con OAuth Bearer válido (verificado también sin token).
  Documentado como eliminado. Lo mismo para `?nickname=` y `?seller_id=` (403 2026-09-23).
- Reemplazo oficial para búsqueda por texto: **catálogo**:
  1. `GET /products/search?site_id=MLA&status=active&q={q}` → páginas de producto
     (id `product_id`, name, pictures, attributes). HTTP 200 verificado.
  2. `GET /products/{product_id}/items?site_id=MLA` → **items que compiten en el PDP**:
     200 `results[]` con `item_id`, `price`, `currency_id`, `seller_id`,
     `seller_address`, `shipping`, `condition`; 404 `No winners found` cuando el
     producto no tiene competidores activos (por diseño).
- Con el permiso funcional **"Publicación y sincronización" = Lectura y escritura**
  activo en la app (+ re-consent OAuth) queda desbloqueado:
  `products/search` (200), `products/{id}` (`status` real), `products/{id}/items`
  (precios reales), `price_to_win`. Verificado 2026-09-23 con 17 items competidores
  de un iPhone 15 (precios 1.2–1.55 M ARS, sellers distintos, ciudades).
- El `buy_box_winner` del PDP **sigue `null`** aun con pdp r/w + re-consent. Causa
  raíz hallada: **la cuenta del token (YUCA, user 1134148467) no es vendedora**
  (`status.billing.allow=false → address_pending`, `list.allow=false`, reputación 0).
  La doc Error 403 lista expresamente "validación de datos de usuarios" como causa de
  403. El KYC de esa cuenta **no se puede completar (error en el flujo de ML)** → el
  buy box queda bloqueado. No es config de app ni certificación.

## Estrategia implementada (2026-09-23)

- `meli_api.py search_mla()` ahora usa **`products/search → products/{id} →
  products/{id}/items`**: por cada producto de búsqueda publica la **oferta con el
  precio más bajo entre sus items competidores** (ARS + signal de envío, §V1).
- No depende del buy box. `store.name` identifica al vendedor; imagen del producto
  desde el catalog product.
- Productos sin competencia (404 en `/items`) **se saltan por diseño** — su precio
  requeriría `/sites/MLA/search` (muerto) o `/items/{id}` (gated por la cuenta no
  vendedora). Son los de menor interés (PDP de un solo vendedor).
- Gate real hoy: mientras la cuenta no sea vendedora, la cobertura ML es la del
  catálogo competitivo (electrónica, etc.). No scrape HTML (§C).

## Decisión

| Prioridad | Camino | Notas |
|---|---|---|
| **1 PRIMARY** | API oficial catálogo: `products/search` + `products/{id}/items` (precio de competidores) | Implementado y probado (S24 → 5 ofertas ARS). Requiere app pdp r/w + token. |
| **2 PARALLEL** | Crawler Scrapling AR (stores + SERP + VTEX/Woo/Shopify) | Siempre ON; ML suma vía API (cap ≤50% top-N §V17). |
| **3 FALLBACK (descartado)** | StealthyFetcher + proxies residenciales AR | **⊥ por ToS ML** (scraping HTML no autorizado; API oficial es el único camino legal) — §T17 descartado. En su lugar: **circuit breaker** (T43/V26) degrada con gracia: tras 3 fallos consecutivos skip ML 5 min, búsqueda sigue sin ML. |
| **⊥** | `/sites/MLA/search` (`q=/nickname=/seller_id=`), Octoparse, search sin token, scraping HTML | No adoptar. |

## Gate

| # | Check | Estado |
|---|---|---|
| 1 | App creada en DevCenter (PKCE + refresh + redirect) | ✅ done 2026-09-23 |
| 2 | OAuth Authorization Code → `MELI_ACCESS_TOKEN`+`MELI_REFRESH_TOKEN` | ✅ re-consent hecho (grant r/w reflejado) |
| 3 | Permiso funcional "Publicación y sincronización" Lectura y escritura en app | ✅ `GET /applications/8567113374842839` → `urn:ml:all:publish-sync:/read-write` + `notifications_topics` cargados |
| 4 | `GET /products/search` + `GET /products/{id}/items` con precios | ✅ 200, precios reales (17 items iPhone, etc.) |
| 5 | buy box / `sale_price` / `/sites/MLA/search` | ❌ bloqueado por **cuenta no vendedora** (`address_pending`, sin KYC posible). No obstruye el camino 1. |
| 6 | `INCLUDE_ML=1` en prod | ✅ ON (Fly secrets + `fly.toml`, 2026-09-25) |

## Estado 2026-09-23 (v2 — conclusión final)

- App OK: `blocked:false`, `certification_status:"not_certified"` (irrelevante),
  scopes `publish-sync:/read-write` + `mktp` + `read/write/offline_access`, callback
  `https://ahorrar-api.fly.dev/webhooks/ml`, tópicos `['items_prices','items',
  'catalog_item_competition_status']`.
- **Desbloqueado** con pdp r/w + re-consent: `products/search`, `products/{id}`
  (status real), `products/{id}/items` (precios de competidores), `price_to_win`.
- **Sigue 403/enmascarado** por cuenta no vendedora (KO no subsanable):
  `/sites/MLA/search`, `/items/{id}`, `sale_price`, `buy_box_winner`,
  `pdp_types:['traditional']`, `permalink`, `buy_box_winner_price_range`.
- KYC imposible (error del flujo ML) → *no hay fix por código ni por DevCenter*:
  los datos de venta/competencia quedan fuera del alcance. La integración corre con
  `/products/{id}/items`.
- `scraper/src/ahorrar_scraper/meli_api.py` reescrito a la estrategia de
  competidores; probado end-to-end vía `crawl(include_ml=True)`.
- ML **ON en prod** (`INCLUDE_ML=1` + secrets Fly). Local: `INCLUDE_ML=0` default en `.env.example`.
- **Auto-refresh**: si la API responde 401, `meli_auth.refresh_access_token()` rota access
  (+ refresh) y persiste en `MELI_TOKEN_FILE` (`/data/meli_tokens.json` en Fly volume
  `meli_data`). No hace falta `fly secrets set` en cada expiry. CLI manual sigue disponible.
  Stores AR siguen primary; ML cap ≤50% (§V17).
- Productos catálogo **sin items competidores** (404/`0 items`) se skipean — típico en algunos
  PDPs con cuenta no vendedora; no es fallo del gate OAuth.

## OAuth (PKCE)

- Flujos: **Authorization Code + Refresh Token**, PKCE S256 (obligatorio).
- Redirect URI: `https://ahorrar-api.fly.dev/auth/ml/callback` (localhost rechazado por ML).
- Scope: `read offline_access`.
- CLI: `cd scraper && uv run python scripts/ml_login.py {url|code|refresh}`
  - `url` → imprime authorization URL con `code_challenge` (persiste verifier en `.ml_oauth_state.json`, gitignored)
  - `code [--url] <valor>` → canjea `?code=` por tokens y los escribe en `scraper/.env`
  - `refresh` → rota `MELI_ACCESS_TOKEN` (+ nuevo refresh si ML lo devuelve)
- El refresh token se rota al usar; guardar el nuevo devuelto.

## Env (scraper/.env — gitignored)

```
MELI_ACCESS_TOKEN=
MELI_REFRESH_TOKEN=          # refresh one-shot; rotar al renovar
MELI_APP_ID=
MELI_CLIENT_SECRET=
MELI_REDIRECT_URI=https://ahorrar-api.fly.dev/auth/ml/callback
MELI_SITE_ID=MLA
```

Sin `MELI_ACCESS_TOKEN`, el crawler **no** scrapeá ML HTML (aunque `includeMl=true`).
El server Python NO autoload `.env`: exportar antes o cargar con `set -a; . .env; set +a`.

## PROD checklist (deploy)

1. **Fly secrets** (backend+scraper en `ahorrar-api`): `MELI_ACCESS_TOKEN`,
   `MELI_REFRESH_TOKEN`, `MELI_APP_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`,
   `MELI_SITE_ID=MLA`, `INCLUDE_ML=1`.
2. **Token lifetime**: access ~6h; **lazy refresh en 401** (automático) + persist volume.
   El refresh token rota → archivo `/data/meli_tokens.json` (no solo secrets estáticos).
3. **Permisos app DevCenter** (ya aplicados): Publicación y sincronización =
   **Lectura y escritura**; tópicos `item competition`, `items prices` + callback
   `https://ahorrar-api.fly.dev/webhooks/ml` (stub `POST /webhooks/ml` en backend → 200).
4. **IP allowlist**: configurar en DevCenter las IPs salientes de Fly si ML exige.
5. **Rate limit**: 429 documentado (10k req/h al token). Caché + backoff.
6. **Homologación / test→prod**: valores de la app actuales cumplen lo necesario
   para `/products/*` con el token del owner.
7. **No exponer** app_id/secret/tokens en frontend (solo backend).
8. `.env*` y `*.local` ya gitignore; `.env` local NO se commitea.

## §V1 shipping

Confirmar oferta si el item competidor tiene `free_shipping` **o** `mode` me1/me2
**o** `logistic_type` utilizable (≠ `not_specified`).