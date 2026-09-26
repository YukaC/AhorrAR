# Estado de producción — 2026-09-26

## Ahora (puente activo)

| Capa | Host | Notas |
|---|---|---|
| UI | https://ahorrarg.vercel.app | Vercel Hobby |
| API | **Render Free** (`render.yaml`) | Perfil 512 MB · sleep ~15m · `VITE_FREE_HOST=1` |
| Fly | `ahorrar-api.fly.dev` | **MUERTO** (TLS EOF) — no usar |

**Por qué se rompió prod:** Vercel Production tenía `VITE_API_BASE=https://ahorrar-api.fly.dev` y Fly ya no responde.

**Vercel debe quedar:**

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://ahorrar-api.onrender.com` (o la URL exacta del servicio Render) |
| `VITE_FREE_HOST` | `1` |

Tras cambiar env en Vercel → **Redeploy** del frontend (build-time Vite).

## OCI Always Free — **DISABLED** hasta cupo A1

Infra y scripts listos en `deploy/oci/` + `scripts/oci-*`, pero **no es el API de prod** mientras Oracle responda `Out of host capacity` en `sa-saopaulo-1`.

Detalle: [`deploy/oci/STATUS.md`](../deploy/oci/STATUS.md) · guards: [`deploy/oci/always-free-guards.md`](../deploy/oci/always-free-guards.md).

Cuando haya VM A1 + IP:

```bash
./scripts/oci-finish-when-ready.sh <PUBLIC_IP>
# Vercel: VITE_API_BASE=https://<IP>.sslip.io  VITE_FREE_HOST=0
```

Hasta entonces: **dejar OCI deshabilitado** (no apuntar Vercel a sslip/OCI).
