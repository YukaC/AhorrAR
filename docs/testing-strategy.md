# Estrategia de tests — AhorrAR

> Cómo se testea este proyecto. Regla de casa: **cada invariante de `SPEC.md` §V tiene
> (al menos) un test que la cubre**, y cada lógica nueva suma un test. "Debería andar"
> no es verificación: la verificación es un comando real (test/build/typecheck).

## Pirámide

- **Unit**: lógica de negocio en `backend/src/{search,scoring,normalize,shipping,calendar}`
  (rápidos, sin red; el scraper Python se valida con `compileall` + checks manuales).
- **Integration**: contrato `shared/contract.ts` (`contract.test.ts`), API (`api.test.ts`),
  streaming ndjson (`live.test.ts`), seeds e índice (`seeds.test.ts`).
- **Frontend**: guards de contrato y formatters (`frontend/src/**/*.test.ts`).
- **E2E**: manual sobre los procesos dev (curl a `/crawl/stream` y `/api/search/:id/events`).
  No hay suite E2E automatizada todavía.

## Frameworks y comandos

| Nivel | Framework | Comando |
|---|---|---|
| unit/integration (backend) | Vitest | `npm test` (desde raíz) o `npm --prefix backend run test` |
| unit (frontend) | Vitest | `npm --prefix frontend run test` |
| typecheck | `tsc --noEmit` | `npm run typecheck` |
| build | `tsc --noEmit` + vite | `npm run build` |
| python sanity | `compileall` + REPL | `cd scraper && uv run python -m compileall -q src` |

## Mapa test → invariantes (los §V principales)

| Test | Cubre §V |
|---|---|
| `backend/test/scoring.test.ts` | V4 (local > intl, tier gap), V17 (ML share ≤50%), V18 (reputación + cuotas bonifican, cap N) |
| `backend/test/live.test.ts` | V16 (SSE `results` parciales, parse ndjson limpio) |
| `backend/test/seeds.test.ts` | V19 (índice ar-shops compartido, buildSeedUrls, guessSearchUrls con magento/woo) |
| `backend/test/contract.test.ts` | contrato compartido + guards (`isProductResult`, `isSearchProgress`) |
| `backend/test/mercadolibre.test.ts` | V1 (price+country+shipping), V18 (sin installments ML) |
| `backend/test/vtex.test.ts` | V18 (installments VTEX, preferencia sin interés) |
| `backend/test/api.test.ts` | API search + SSE end-to-end |
| `backend/test/{bfs,priorityQueue,normalize,shipping,calendar,http-fetch,images}.test.ts` | invariantes de esos módulos |

## Cobertura objetivo

- Toda §V relevante tiene test (regla de casa).
- Lógica nueva → test en el mismo PR/commit; si una §V queda sin test, se registra
  como deuda y se paga.

## CI

- No hay CI configurado todavía (repo local). Comando de verificación manual completo:
  `npm run typecheck && npm test && npm --prefix frontend run test && npm run build`.

## Convenciones

- Nombres descriptivos: qué se prueba, no cómo.
- Fixtures chicos versionados (índice ar-shops de test via env `AR_SHOPS_JSON`, nunca el real).
- Test que falla → `backprop` (bug → `SPEC.md` §B + posible §V) antes de reintentar:
  nunca parchear el test para que pase.
- `npm run dev:*` en paralelo para E2E manual; el backend cae solito con `--watch`.