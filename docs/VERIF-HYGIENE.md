# Higiene de verificación — AhorrAR

> Estado real de los hooks y del comando canónico de check, con los tiempos medidos
> en esta máquina. Complementa `docs/testing-strategy.md` (qué se testea) y `§I`
> de `SPEC.md` (`check = npm run check`).
>
> Este doc cubre **M1 y M2** del piloto de verificación (M3–M8 son del stack de
> reglas del harness y se registran en
> `~/.local/state/agent-eval-harness/VERIF-HYGIENE.md`). M2 se cierra como HECHO
> acá: el criterio original era correr tests relacionados en el pre-commit si
> entraban en ~15 s, y los corren.
>
> **Nota sobre los SHAs citados (2026-10-03).** La rama `chore/verification-hygiene` fue
> **reescrita por un rebase de autoría** (autor → `YukaC <agusyuk25@gmail.com>`; contenido
> idéntico, `git diff` vacío). Todos los SHAs de este documento son los **previos al
> rebase**: `bb3d746 → 556b03b`, `2f3873d → 4f1ffec`, `dc32eb9 → 25c8fa6`,
> `58a5c40 → ae170ca`, `0848405 → 5299dbb`, `606cb41 → 3740a17`. `main` no se movió
> (`926416654b405432ff63bcbfed4082a99b66ed6e`). Mapeo completo en
> `~/.local/state/agent-eval-harness/TANDA-2026-10-03-PUSH-Y-PORTABILIDAD.md` §1.2-bis.

## Estado de la tanda completa (M1–M8)

| M | estado | evidencia |
|---|---|---|
| M1 check canónico | **hecho** | `npm run check` verde, un paso reportado por workspace |
| M2 hooks/CI | **hecho** (evidencia D19) | 4 rechazos con test rojo y 2 pases limpios; peor caso 6.70 s < 15 s |
| M3 regla VERIFICAR | **hecho (aceptada)** | A 3/5 vs B 4/5 |
| M4 presupuesto STACK | **hecho** | `stack-lint lines=106 budget=106 OK` |
| M5 set de regresión | **parcial** | runner+baseline+prompts existen; R1–R3 nunca se corrieron (D6) |
| M6 graph-fresh | **hecho** | `graph-fresh: OK (dc32eb9)` (pre-rebase; hoy `25c8fa6`) |
| M7 tokens | **no verificado** | solo PROXY (D7), sin medición directa |
| M8 registro de skills | **hecho** | `skills-usage.md`, próxima revisión 2026-10-30 |

## M1 — check canónico

**Estado: HECHO.** `npm run check` corre typecheck + lint + una suite de tests por
workspace, con un paso reportado por línea. Verde en 6.46 s. El contrato cambió
para incluir frontend: ver "Cambio de contrato de `check`" más abajo.

## M2 — hooks de verificación local

**Estado: HECHO (re-cerrado según D19).** El criterio original de M2 (meter los tests
relacionados al pre-commit si su costo conjunto con typecheck entra en ~15 s) **se cumple
con holgura**: peor caso medido 6.70 s. La evidencia previa era de la era D2b (pre-commit =
typecheck-only) y quedó obsoleta cuando el pre-commit volvió a correr tests: D17 ya no
describe el estado actual. No hay decisión de design compensatoria que registrar en
`docs/decisions/`.

### Diseño final

| Hook | Qué corre | Cuándo |
|---|---|---|
| `.githooks/pre-commit` | `npm run typecheck` + `vitest related --run <archivos staged>` **por workspace** | commit local |
| `.githooks/pre-push` | `npm run check` (typecheck + suite backend + suite frontend) | push |
| `.github/workflows/check.yml` | `npm run check` (mismo script, sin cambios en el workflow) | push/PR en GitHub |

Los hooks están activos vía `core.hooksPath=.githooks` (no hay husky).

El pre-commit reparte los archivos staged entre paquetes y solo corre las suites
que los importan: `backend/*` → vitest de backend, `frontend/*` → vitest de
frontend, `shared/*` → **ambos** (los dos paquetes importan `shared/contract.ts`).
Si no hay `.ts/.tsx` staged (solo `.md`, `.json`, scripts) el paso se salta solo.

### Cambio de contrato de `check` (2026-10-02, commit bb3d746)

**El contrato cambió y es intencional.** `scripts/check` pasó a ser un runner
propio del proyecto en lugar de delegar en `~/.agents/scripts/check`. Motivo: el
wrapper viejo delegaba en el check genérico de la casa, que solo mira el
`package.json` raíz — y el script `test` de la raíz es
`npm --prefix backend run test`. Los tests de frontend (63 tests) **nunca**
corrieron en `check` ni en CI, pese a que `docs/testing-strategy.md` los listaba
como parte de la verificación completa.

Qué hace ahora (`scripts/check`):

- `typecheck` y `lint` desde la raíz (se saltan e informan si no hay script).
- Un paso de tests **por workspace** (`backend`, `frontend`), reportado por
  separado: `test-backend` y `test-frontend`.
- Un workspace sin script `test` se salta como `SALTADO (sin script de test)` — no
  se ignora en silencio. Un workspace inexistente reporta `SALTADO (workspace
  inexistente)`. Ambos caminos verificados con un proyecto simulado.
- Sale con código distinto de 0 si algún paso da `FALLA`.

Los pasos se reportan uno por línea, así un rojo de frontend no puede pasar
disfrazado de verde de backend:

```
typecheck: OK
lint: SALTADO (sin script de lint)
test-backend: OK
test-frontend: FALLA
```

CI no necesitó cambios: ya hacía `npm --prefix frontend ci` + `npm --prefix backend ci`
y después `npm run check`, así que ahora cubre ambos workspaces por el mismo
comando. Costo: `check` subió de ~5.5 s a ~6.5 s (el frontend agrega ~1.2 s).

### Tiempos medidos (2026-10-02, commits 2f3873d / bb3d746)

| Comando | Tiempo |
|---|---|
| Suite frontend sola — `npm --prefix frontend run test` (10 archivos / 63 tests) | **1.18–1.27 s** |
| Suite backend sola — `npm --prefix backend run test` (27 archivos / 175 tests) | 4.20 s |
| `npm run typecheck` (backend + frontend) | 1.52 s |
| **Suite completa — `npm run check` (= pre-push = CI)** | **6.46–6.56 s** |
| └ antes del cambio (solo backend) | 5.44–5.76 s |
| `vitest related` backend — `src/search/relevance.ts` | 1.55 s (13 archivos / 89 tests) |
| `vitest related` backend — `shared/contract.ts` | 1.40 s (3 archivos / 19 tests) |
| `vitest related` frontend — `src/lib/format.ts` | 1.23 s (3 archivos / 25 tests) |
| **pre-commit real** — solo staged de shell (sin código) | **1.49–1.55 s** (related se salta) |
| **pre-commit real** — 1 archivo de código staged | **2.40–3.34 s** |
| **pre-commit real** — peor caso: 61 archivos `.ts` staged | **6.70 s** (backend 26 archivos/170 tests + frontend 10/63) |
| **pre-push real** — `npm run check` | **6.47–6.57 s** |

El peor caso del pre-commit (6.70 s) es ahora **más barato que la suite completa**
(6.5 s) porque el typecheck se comparte: correr las dos suites en paralelo por
paquete no suma lo que sumarían por separado. Queda a menos de la mitad del
presupuesto de 15 s, así que `related` sigue siendo la opción: paga lo mismo o
menos que la suite entera y atrapa el error en el commit, no en el push.

### Verificación de que los hooks muerden

Probado con `core.hooksPath` real, sin `--no-verify`, en una rama temporal
`tmp/check-frontend-probe` (ya borrada):

| Escenario | Resultado |
|---|---|
| Commit con test rojo en `backend/test/bfs.test.ts` | **rechazado**, exit 1 — `vitest related` reportó `1 failed | 7 passed` |
| Commit con test rojo en `frontend/src/lib/format.test.ts` | **rechazado**, exit 1 (2.45 s) — `vitest related en frontend`: `1 failed \| 19 passed` |
| Commit limpio con cambio real en `frontend/src/lib/result-caps.ts` | **pasa**, exit 0 (2.40 s) — `1 passed / 4 tests` |
| Pre-push con test rojo de frontend | **rechazado**, exit 1 (6.57 s) — `test-backend: OK` + `test-frontend: FALLA` |
| Pre-push con test rojo de backend | **rechazado**, exit 1 — `test: FALLA` |
| Pre-push limpio | **pasa**, exit 0 (6.47 s) — `test-backend: OK · test-frontend: OK` |
| `npm run check` (comando exacto de CI) | **verde**, exit 0 |

Comandos y salidas de la ronda de frontend:

```
$ git commit -m 'test: semilla roja frontend'      # con SEMILLA_ROJA_FRONTEND en format.test.ts
pre-commit: npm run typecheck
pre-commit: vitest related en frontend (1 archivo/s)
 FAIL  src/lib/format.test.ts > SEMILLA_ROJA_FRONTEND > falla a proposito
 Test Files  1 failed (1)   Tests  1 failed | 19 passed (20)
EXIT=1  ELAPSED=2.45 s

$ .githooks/pre-push verif-remote2 /tmp/opencode/verif-remote2.git
pre-push: npm run check
check: npm run typecheck
check: npm --prefix backend run test    → Test Files 27 passed (27) / Tests 175 passed
check: npm --prefix frontend run test  → Test Files 1 failed | 9 passed (10)
typecheck: OK · lint: SALTADO · test-backend: OK · test-frontend: FALLA
EXIT=1  ELAPSED=6.57 s

$ git commit -m 'chore: sonda limpia frontend'    # cambio real, tests verdes
pre-commit: vitest related en frontend (1 archivo/s) → Test Files 1 passed (1) / Tests 4 passed
EXIT=0  ELAPSED=2.40 s

$ .githooks/pre-push verif-remote2 /tmp/opencode/verif-remote2.git
typecheck: OK · lint: SALTADO · test-backend: OK · test-frontend: OK
EXIT=0  ELAPSED=6.47 s
```

Nota de alcance: la ronda anterior validó el hook invocando `.githooks/pre-push` con el
protocolo exacto que usa git (argumentos `<remote> <url>` + stdin de refs) contra un
remoto bare temporal. **Eso quedó superado por una prueba con `git push` literal**
(2026-10-03), ver más abajo.

### Push real con `git push` (2026-10-03): RECHAZADO

Ya no es simulación. Con un test roto commiteado (saltando el pre-commit a propósito con
`--no-verify` para poder llegar al pre-push):

```
$ git checkout -b tmp/push-probe
$ git add backend/test/zz-probe.test.ts
$ git commit --no-verify -m 'wip'          # 5ef9d15
$ git push probe chore/verification-hygiene:tmp/push-probe
pre-push: npm run check
check: npm run typecheck
check: npm --prefix backend run test   →  FAIL  zz-probe.test.ts > "expected 1 to be 2"
test-backend: FALLA
error: failed to push some refs to '/tmp/probe.git'
hint: the pre-push hook rejected this push   (git: "falló el empuje de algunas referencias")
exit != 0
```

El pre-push corrió `check` completo y bloqueó el push de verdad. La rama
`tmp/push-probe`, el remoto `probe`, `/tmp/probe.git` y `backend/test/zz-probe.test.ts`
fueron eliminados; `git status --short` quedó vacío.

**Corrección de un informe anterior:** se había reportado este push como **"ACEPTADO"**
por ver `update by push` en el reflog del ref de tracking. **Esa inferencia era incorrecta**:
git actualiza el ref de tracking solo si el remoto acepta el push; si el hook rechaza el
push antes de que el remoto lo reciba, el ref de tracking no se actualiza por ese rechazo.

Los dos hechos que constituyen la evidencia válida son independientes:

1. **Push de la rama limpia: ACEPTADO.** El push de `chore/verification-hygiene` al
   remoto fue aceptado. El reflog muestra `update by push @ dc32eb9` (pre-rebase), que
   sí refleja un push que el remoto recibió y aceptó.
2. **Push con test roto: RECHAZADO por el pre-push.** El hook `pre-push` corrió
   `npm run check`, detectó `test-backend: FALLA` y terminó con exit ≠ 0. Git reportó
   `"falló el empuje de algunas referencias"` y el push nunca llegó al remoto. La primera
   prueba era válida para un push limpio pero no probaba el rechazo de un push con test roto.

## Pendientes conocidos

- **lint SALTADO.** No hay script de lint en el repo: `check` reporta
  `lint: SALTADO (sin script de lint)`. No es lint verde, es lint ausente.
- **E2E y accesibilidad en navegador fuera de scope.**
  `npm --prefix frontend run test:e2e` (Playwright) sigue fuera de `check` y de
  CI: arranca un browser y no es comparable en costo a un vitest de jsdom.
- **CI sin proteger hasta mergear.** Mientras `chore/verification-hygiene` no esté
  mergeada, el `check.yml` de la rama no corrió nunca y la verificación es
  local/hooks.
- **Tokens (M7) sin medición real.** Solo proxy; ver el registro del harness.

## Retiro del guard `no-bench-seeds.yml`

El workflow `.github/workflows/no-bench-seeds.yml` se retiró en `58a5c40` (pre-rebase;
hoy `ae170ca`), después
de eliminar las ramas y worktrees de evaluación que protegía (el bundle estaba
verificado antes). Recuperable desde `HEAD~1` o desde
`~/.local/state/agent-eval-harness/backups/no-bench-seeds.yml.20261002.bak`
(sha256 `99283ca5…` idéntico al original).