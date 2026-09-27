# Estado de producción — 2026-09-27

## Ahora (primario Micro)

| Capa | Host | Notas |
|---|---|---|
| UI | https://ahorrarg.vercel.app | Vercel Hobby |
| API **primario** | **OCI Micro** `https://147.15.72.239.sslip.io` | E2.1.Micro · reserved IP · sin cold start · `VITE_FREE_HOST=1` |
| API **backup** | Render Free `ahorrar-api.onrender.com` | Dejar UP · revert: [`deploy/oci/REVERT-RENDER.md`](../deploy/oci/REVERT-RENDER.md) |
| Fly | `ahorrar-api.fly.dev` | **MUERTO** — no usar |

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
