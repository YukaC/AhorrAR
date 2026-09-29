# Estado de producción — 2026-09-27

## Ahora (primario Micro)

| Capa | Host | Notas |
|---|---|---|
| UI | https://ahorrarg.vercel.app | Vercel Hobby |
| API **primario** | **OCI Micro** `https://147.15.72.239.sslip.io` | E2.1.Micro · reserved IP · sin cold start · `VITE_FREE_HOST=1` |
| API **backup** | Render Free `ahorrar-api.onrender.com` | Dejar UP · revert: [`deploy/oci/REVERT-RENDER.md`](../deploy/oci/REVERT-RENDER.md) |
| Fly | `ahorrar-api.fly.dev` | **RETIRADO** — no usar |

**Vercel Production (activo):**

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://147.15.72.239.sslip.io` |
| `VITE_FREE_HOST` | `1` |

**ML DevCenter (confirmar / actualizar si aún apunta a Render/Fly):**

| Campo | Valor |
|---|---|
| Redirect | `https://147.15.72.239.sslip.io/auth/ml/callback` |
| Webhook | `https://147.15.72.239.sslip.io/webhooks/ml` |

Detalle OCI: [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md) · plan: [`deploy/oci/MICRO-PLAN.md`](../deploy/oci/MICRO-PLAN.md).

## OCI A1 Flex — DISABLED hasta cupo

Upgrade futuro (más RAM). No bloquea Micro. Guards: [`deploy/oci/always-free-guards.md`](../deploy/oci/always-free-guards.md).

## Pin de imagen Micro (`AHORRAR_IMAGE`)

La VM puede anclar el contenedor a un digest concreto vía `deploy/oci/.env`:

```bash
AHORRAR_IMAGE=ghcr.io/yukac/ahorrar-api@sha256:<digest>
```

`scripts/oci-micro-pull.sh` **sourcea** ese `.env` antes del pull. Mientras el pin exista, el job CI `deploy-micro` (push a `main`) **no** reemplaza la imagen por el tip flotante `:micro`.

### Cómo quitar el pin (redeploy tip)

1. Decisión explícita del owner (Agustín): anotar en `docs/progress.md` ledger — hora UTC, digest que se suelta, digest destino, motivo.
2. En la VM: editar `/opt/ahorrar/deploy/oci/.env` — borrar o comentar la línea `AHORRAR_IMAGE=…`.
3. `sudo AHORRAR_GIT_PULL=0 /opt/ahorrar/scripts/oci-micro-pull.sh` (o esperar el próximo `deploy-micro` sin pin).
4. Verificar: `docker image inspect` del contenedor → `org.opencontainers.image.revision` + `RepoDigests`.

**Pin actual (2026-09-29):** `sha256:e9504ec0086e1e67a23a56c30e796e7ebed684d302a2605d2ab74d5f4a68888d` · rev `e1db4fb` (rollback post-T61 cold). Quién decide quitarlo: owner del repo.

