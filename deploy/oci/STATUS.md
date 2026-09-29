# OCI migration status — 2026-09-26

> **Prod API hoy:** **OCI Micro** `147.15.72.239.sslip.io` — [`docs/PROD.md`](../../docs/PROD.md).  
> **Backup:** Render Free — [`REVERT-RENDER.md`](REVERT-RENDER.md).  
> **A1 full:** **bloqueado** por cupo Oracle — [`DISABLED.md`](DISABLED.md); no bloquea Micro.

## Micro E2.1 (primario planificado)

| Campo | Valor |
|---|---|
| Instancia | `ahorrar-api-micro` (display name; antes `watchdog-micro`) |
| Shape | `VM.Standard.E2.1.Micro` · **RUNNING** · `sa-saopaulo-1` |
| **Reserved Public IP** | **147.15.72.239** |
| **DOMAIN** | `147.15.72.239.sslip.io` |
| Public IP OCID | `ocid1.publicip.oc1.sa-saopaulo-1.amaaaaaa7brmyhaamypaclpsgdex2jlsd7fl7qwavdl4eu76y2r5r7aftw6q` |
| Stack en VM | **UP** — Docker + Caddy + swap 2G + anti-idle cron 4h · scrapling OK |
| DOMAIN health | `https://147.15.72.239.sslip.io/api/health` → ok |
| Imagen | build local en Micro (`ghcr.io/yukac/ahorrar-api:micro`); workflow GHCR listo (push `main` → CI) |

**Cutover D hecho:** Vercel Production apunta a Micro. Render = backup.

## Hecho ($0 en tarjeta)

| Pieza | Estado |
|---|---|
| VCN + subnet pública + IGW + SL 22/80/443 | OK · solo home `sa-saopaulo-1` |
| SSH `~/.ssh/oci_ahorrar` | OK |
| Budget `ahorrar-zero-spend-guard` $1/mes + alertas 1% email | OK (anti-cargo) |
| Micro + **IP reservada** en VNIC | OK (B1) |
| `docker-compose.micro.yml` + `scripts/oci-bootstrap-micro.sh` + `oci-micro-smoke.sh` | OK en repo |
| Workflow `.github/workflows/docker-ghcr.yml` (amd64 → GHCR) | OK en repo |
| Retry A1 + watchdog (timeout 90s) + bootstrap watcher | opcional en laptop |
| Support ticket formal | **bloqueado** (cuenta free sin CSI) |

## Bloqueado (Oracle — solo A1 Flex)

- `LaunchInstance` → `InternalError` / **Out of host capacity** para `VM.Standard.A1.Flex`
- Región con **1 solo AD** → no hay “probar otro AD”
- Docs oficiales: reintentar / otra shape / esperar · capacity no garantizada en Always Free

## Scripts

| Script | Rol |
|---|---|
| `oci-bootstrap-micro.sh` | Micro: swap, Docker, pull GHCR, compose micro + Caddy, anti-idle |
| `oci-micro-smoke.sh` | Smoke health (+ búsqueda opcional) contra sslip |
| `oci-a1-rotate-retry.sh` | Intenta A1 1 OCPU/6 GB (timeout, rota imagen+FD) |
| `oci-a1-watchdog.sh` | Reinicia rotator si el log se estanca |
| `oci-watch-and-bootstrap.sh` | Al ver `public_ip=` → bootstrap **A1** |
| `oci-finish-when-ready.sh` | make-env + bootstrap A1 + hint Vercel |
| `oci-make-env.sh` / `oci-bootstrap-remote.sh` | `.env` + Docker/Caddy/anti-idle perfil **A1** |
| `oci-anti-idle.sh` | Cron 4–6h anti-reclaim 7d |

## Cutover Micro (cuando Fase C smoke OK)

1. `https://147.15.72.239.sslip.io/api/health` → `ok:true`  
2. Vercel Production: `VITE_API_BASE=https://147.15.72.239.sslip.io`, `VITE_FREE_HOST=1` + redeploy  
3. ML DevCenter: redirect + webhook a sslip  
4. Render **no** apagar (backup) — revert: [`REVERT-RENDER.md`](REVERT-RENDER.md)

## Cutover A1 (cuando haya cupo — futuro)

1. Instancia `ahorrar-api` RUNNING + IP  
2. `./scripts/oci-finish-when-ready.sh <IP>`  
3. Vercel: `VITE_API_BASE=https://<IP>.sslip.io`, `VITE_FREE_HOST=0` + redeploy  

## Anti-cargo

Home region only · A1 ≤2–4 OCPU / 12–24 GB según doc Always Free · boot ≥50 GB · sin LB/ADB pagos · sin otras regiones · ver `always-free-guards.md`.
