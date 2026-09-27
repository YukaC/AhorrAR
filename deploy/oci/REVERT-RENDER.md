# Runbook — Revert API primario a Render Free

Usar si OCI Micro falla (OOM, health flap, cert, downtime) y hay que volver al puente Render en &lt;5 min.

## 1. Vercel Production

| Key | Value |
|---|---|
| `VITE_API_BASE` | `https://ahorrar-api.onrender.com` |
| `VITE_FREE_HOST` | `1` |

Redeploy del frontend (env Vite es build-time).

## 2. Mercado Libre DevCenter

Si se habían cambiado URLs a sslip:

| Campo | Valor Render |
|---|---|
| Redirect URI | (la configurada para Render / prod anterior) |
| Webhook | (idem) |

Si Render nunca dejó de tener las URLs ML correctas y solo cambió Vercel: **solo paso 1**.

## 3. Verificar

1. https://ahorrarg.vercel.app → búsqueda real  
2. Network: requests a `ahorrar-api.onrender.com`  
3. Cold start Free OK (~30–60 s primera vez)

## 4. Qué NO hacer

- No apagar el servicio Render (sigue siendo backup).  
- No borrar la Reserved IP ni la VM Micro (se puede reintentar cutover).  
- No apuntar Vercel a Fly (`ahorrar-api.fly.dev` — muerto).

## Volver a Micro

Cuando Micro esté sano de nuevo: `VITE_API_BASE=https://<RESERVED_IP>.sslip.io`, `VITE_FREE_HOST=1`, redeploy + ML URLs a sslip. Ver [`MICRO-PLAN.md`](MICRO-PLAN.md) Fase D.
