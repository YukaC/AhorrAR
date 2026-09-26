# OCI migration status — 2026-09-26

> **DISABLED for production** until Ampere A1 capacity exists in `sa-saopaulo-1`.  
> Current prod API bridge: **Render Free** — see [`docs/PROD.md`](../../docs/PROD.md).

## Hecho ($0 en tarjeta)

| Pieza | Estado |
|---|---|
| VCN + subnet pública + IGW + SL 22/80/443 | OK · solo home `sa-saopaulo-1` |
| SSH `~/.ssh/oci_ahorrar` | OK |
| Budget `ahorrar-zero-spend-guard` $1/mes + alertas 1% email | OK (anti-cargo) |
| AMD Micro `watchdog-micro` | RUNNING · 1 GB · **no** corre AhorrAR |
| Artefactos `deploy/oci/*` + scripts `scripts/oci-*` | OK en repo |
| Retry A1 + watchdog (timeout 90s) + bootstrap watcher | opcional en laptop |
| Support ticket formal | **bloqueado** (cuenta free sin CSI) |

## Bloqueado (Oracle)

- `LaunchInstance` → `InternalError` / **Out of host capacity** para `VM.Standard.A1.Flex`
- Región con **1 solo AD** → no hay “probar otro AD”
- Docs oficiales: reintentar / otra shape / esperar · capacity no garantizada en Always Free

## Scripts (no prod hasta IP)

| Script | Rol |
|---|---|
| `oci-a1-rotate-retry.sh` | Intenta A1 1 OCPU/6 GB (timeout, rota imagen+FD) |
| `oci-a1-watchdog.sh` | Reinicia rotator si el log se estanca |
| `oci-watch-and-bootstrap.sh` | Al ver `public_ip=` → bootstrap |
| `oci-finish-when-ready.sh` | make-env + bootstrap + hint Vercel |
| `oci-make-env.sh` / `oci-bootstrap-remote.sh` | `.env` + Docker/Caddy/anti-idle en la VM |
| `oci-anti-idle.sh` | Cron 6h anti-reclaim 7d |

## Activar OCI (cuando haya cupo)

1. Confirmar instancia `ahorrar-api` RUNNING + IP pública  
2. `./scripts/oci-finish-when-ready.sh <IP>`  
3. Vercel Production: `VITE_API_BASE=https://<IP>.sslip.io`, `VITE_FREE_HOST=0` + redeploy  
4. Apagar / no usar Render como primario  

## Anti-cargo

Home region only · A1 ≤2–4 OCPU / 12–24 GB según doc Always Free · boot ≥50 GB · sin LB/ADB pagos · sin otras regiones · ver `always-free-guards.md`.
