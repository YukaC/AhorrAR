# OCI A1 deploy — DISABLED until capacity (§T54)

Ampere `VM.Standard.A1.Flex` (perfil full ~4 GB) is the **upgrade** target.

**Do not point production Vercel here** while Oracle returns `Out of host capacity`
for `VM.Standard.A1.Flex` in `sa-saopaulo-1`.

## Production today (not this file)

| Rol | Destino |
|---|---|
| API **primario** | OCI **Micro** `147.15.72.239.sslip.io` — [`docs/PROD.md`](../../docs/PROD.md) |
| API **backup** | Render Free — [`REVERT-RENDER.md`](REVERT-RENDER.md) |
| Fly | **retirado** |

## When capacity appears — cutover runbook

1. Laptop: `scripts/oci-a1-rotate-retry.sh` / `oci-watch-and-bootstrap.sh` until `RUNNING` + public IP.
2. Bootstrap A1: `scripts/oci-finish-when-ready.sh` (make-env + compose **A1** `docker-compose.yml`, not micro).
3. Smoke: health + 1–2 cold searches; watch RSS vs ~4 GB; `RestartCount=0`.
4. Vercel Production:
   - `VITE_API_BASE=https://<A1-IP>.sslip.io`
   - `VITE_FREE_HOST=0` (perfil full)
   - Redeploy UI.
5. ML DevCenter redirect URIs → nuevo sslip (quitar Micro solo cuando A1 estable ≥24 h).
6. Micro: lab / segundo servicio / apagar contenedor API (mantener VM si anti-reclaim).
7. Update [`docs/PROD.md`](../../docs/PROD.md) + [`STATUS.md`](STATUS.md).

Guards Always Free: [`always-free-guards.md`](always-free-guards.md).  
Detalle histórico: [`STATUS.md`](STATUS.md) §Cutover A1 · [`MICRO-PLAN.md`](MICRO-PLAN.md) Fase F.
