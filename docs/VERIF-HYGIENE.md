# Higiene de verificación — AhorrAR

> Estado real de los hooks y del comando canónico de check, con los tiempos medidos
> en esta máquina. Complementa `docs/testing-strategy.md` (qué se testea) y `§I`
> de `SPEC.md` (`check = npm run check`).

## M2 — hooks de verificación local

**Estado: HECHO.** El criterio original de M2 (meter los tests relacionados al
pre-commit si su costo conjunto con typecheck entra en ~15 s) **se cumple con
holgura**: peor caso medido 8.05 s. No hay decisión de design compensatoria que
registrar en `docs/decisions/`.

### Diseño final

| Hook | Qué corre | Cuándo |
|---|---|---|
| `.githooks/pre-commit` | `npm run typecheck` + `vitest related --run <archivos staged>` por paquete | commit local |
| `.githooks/pre-push` | `npm run check` (typecheck + suite backend) | push |
| `.github/workflows/check.yml` | `npm run check` | push/PR en GitHub |

Los hooks están activos vía `core.hooksPath=.githooks` (no hay husky).

El pre-commit reparte los archivos staged entre paquetes y solo corre las suites
que los importan: `backend/*` → vitest de backend, `frontend/*` → vitest de
frontend, `shared/*` → **ambos** (los dos paquetes importan `shared/contract.ts`).
Si no hay `.ts/.tsx` staged (solo `.md`, `.json`, scripts) el paso se salta solo.

### Tiempos medidos (2026-10-02, commit 2f3873d)

| Comando | Tiempo |
|---|---|
| Suite completa — `npm run check` (= CI) | **5.33–5.47 s** |
| └ `npm run typecheck` (backend + frontend) | 1.52 s |
| └ `npm test` backend completo (27 archivos / 175 tests) | 4.20 s |
| └ `npm --prefix frontend run test` completo (10 archivos / 63 tests) | 3.29 s |
| `vitest related` backend — archivo típico (`src/search/relevance.ts`) | 1.55 s (13 archivos / 89 tests) |
| `vitest related` backend — `shared/contract.ts` | 1.40 s (3 archivos / 19 tests) |
| `vitest related` frontend — `src/lib/format.ts` | 1.23 s (3 archivos / 25 tests) |
| **pre-commit real** — solo staged de shell (sin código) | **1.55 s** (related se salta) |
| **pre-commit real** — 1 archivo backend staged | **3.34 s** |
| **pre-commit real** — peor caso: 61 archivos `.ts` staged | **8.05 s** (backend 26 archivos/170 tests + frontend 10/63) |
| **pre-push real** — `npm run check` | **5.37 s** |

Los tiempos son de la primera corrida en frío; con el cache de Vite de Vitest
calentado bajan ~1 s. El peor caso (8.05 s) equivale a correr la suite entera y
aun así queda a la mitad del presupuesto de 15 s: **related siempre gana**, porque
en el peor caso no es más caro que la suite completa.

### Verificación de que los hooks muerden

Probado con `core.hooksPath` real, sin `--no-verify`:

| Escenario | Resultado |
|---|---|
| Commit con test rojo en `backend/test/bfs.test.ts` | **rechazado**, exit 1 — corrió typecheck + `vitest related` y reportó `1 failed | 7 passed` |
| Commit limpio | **pasa**, exit 0 |
| Pre-push con test rojo en el working tree | **rechazado**, exit 1 — `check summary → test: FALLA` |
| Pre-push limpio | **pasa**, exit 0 (`typecheck: OK · test: OK`) |
| `npm run check` (comando exacto de CI) | **verde**, exit 0 |

Nota de alcance: el push se validó invocando `.githooks/pre-push` con el protocolo
exacto que usa git (argumentos `<remote> <url>` + stdin de refs) contra un remoto
bare temporal creado con `git init --bare` en `/tmp` y borrado después. El binario
`git push` está bloqueado por permisos del harness de esta sesión, así que no se
pudo ejecutar el push literal; el hook es el mismo binario que git would've
ejecutado, con la misma entrada. Los archivos de prueba quedaron restaurados y el
árbol está limpio (`git status` vacío).

## Brecha conocida

`npm run check` (y por lo tanto CI) corre `npm --prefix backend run test` — **los
tests de frontend no entran en el check**. `docs/testing-strategy.md` los lista
aparte (`npm --prefix frontend run test`, 3.29 s) y el e2e Playwright también
queda afuera. No se cambió acá porque `check` es el contrato compartido con CI y
ampliarlo altera el presupuesto de toda verificación; queda como decisión de scope,
no como olvido.