# Plan definitivo — Micro OCI primario + Render backup (+ A1 futuro)

Fecha: 2026-09-26  

Estado: **cutover hecho** — API prod = OCI Micro (`147.15.72.239.sslip.io`); Render = backup; Fly retirado.  
Fases A–E checklist abajo (§D/E) están ✓. A1 (Fase F) sigue bloqueado por cupo — ver [`DISABLED.md`](DISABLED.md).  
Contexto vivo: [`docs/PROD.md`](../PROD.md) · [`STATUS.md`](STATUS.md) · [`DISABLED.md`](DISABLED.md).

## 0. Objetivo

| Rol | Host | Por qué |
|---|---|---|
| **Primario API** | OCI `VM.Standard.E2.1.Micro` **`ahorrar-api-micro`** · IP reservada **147.15.72.239** · `147.15.72.239.sslip.io` | Always Free, **sin sleep**, 1 GB RAM |
| **Backup API** | Render Free `ahorrar-api.onrender.com` | Ya desplegado; cold start OK como fallback |
| **UI** | Vercel `ahorrarg.vercel.app` | Sin cambios de stack |
| **Upgrade futuro** | A1 Flex 1 OCPU/6 GB | Cuando haya cupo; no bloquea este plan |

Reglas $0: solo home `sa-saopaulo-1`, sin LB/ADB pagos, sin otras regiones. Budget alerts ya activos.

---

## 1. Contraste (qué quedó validado)

- Stack real: Scrapling + Express en **una** imagen Docker (`Dockerfile` + `docker-entrypoint.sh`); Playwright **no** se descarga en prod (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).
- `STEALTH_FETCH` default **0**; hay que dejarlo en 0 en Micro.
- `CRAWLER=scrapling` obligatorio (evitar fallback Node→Chromium).
- Perfil Render 512 MB (`render.yaml` + `nodesBudgetFor` ceiling) es la plantilla de límites para Micro.
- Compose actual `deploy/oci/docker-compose.yml` es perfil **A1 (~4 GB)** → **no** usarlo tal cual en Micro.
- Workers/CF serverless: **fuera de alcance** de este plan (otra épica).
- A1: retry opcional en laptop; **no reserva plaza** hasta `RUNNING`.

---

## 2. Mitigaciones (obligatorias en el plan)

### 2.1 OOM (1 GB + Scrapling + Node)

| Mitigación | Cómo |
|---|---|
| Swap 1–2 GB | `/swapfile` en el Micro al bootstrap |
| Perfil slim | Mismos knobs que Render (o más chicos): `FETCH_WORKERS=1–2`, `MAX_NODES≤60–80`, `MAX_RESULTS=50`, `WARM_CACHE=0`, `CONCURRENCY=1`, `STEALTH_FETCH=0`, `NODE_OPTIONS=--max-old-space-size=192` |
| `mem_limit` Docker | ~700–800 m + `restart: unless-stopped` |
| Backup Render | Runbook de revert Vercel en &lt;5 min |
| Abort | Si OOM en smoke → no cutover; quedarse en Render |

### 2.2 IP que cambia (sslip.io)

| Mitigación | Cómo |
|---|---|
| **Reserved Public IP** Always Free (hasta 2) | Crear, asociar al VNIC del Micro; `DOMAIN=<ip-reservada>.sslip.io` |
| No recrear VM sin necesidad | Reboot / recreate container ≠ nueva IP si la reserved está atada |
| Doc | Si algún día hay que mover la reserved IP, actualizar Vercel + ML DevCenter |

### 2.3 Reclaim Always Free (~7 d &lt;20 % uso)

| Mitigación | Cómo |
|---|---|
| `scripts/oci-anti-idle.sh` | Cron cada **4–6 h** (health + red + burst CPU) |
| No `STOP` la instancia | Dejar `RUNNING` |
| Tráfico real | Suma; no sustituye el cron |

### 2.4 Build lento en Micro (CPU compartida)

| Mitigación | Cómo |
|---|---|
| **No buildear en el Micro** | GitHub Actions → `ghcr.io/yukac/ahorrar-api:<tag>` (`linux/amd64`) |
| Compose Micro | `image: ghcr.io/...` + `pull`, no `build:` en el host |
| Rebuild | Solo en CI al push `main` (o workflow_dispatch) |

---

## 3. Arquitectura objetivo (después del cutover)

```
Browser → Vercel
            │  VITE_API_BASE=https://<RESERVED_IP>.sslip.io
            │  VITE_FREE_HOST=1
            ▼
     OCI Micro (x86)  Docker: API:4000 + Scrapling:4100
            │         Caddy :443
            │         swap + anti-idle + reserved IP
            │
            └─ fallback manual → Render Free (mismo contrato HTTP)
```

ML DevCenter:

- Redirect: `https://<RESERVED_IP>.sslip.io/auth/ml/callback`
- Webhook: `https://<RESERVED_IP>.sslip.io/webhooks/ml`

---

## 4. Fases de implementación

### Fase A — Repo / CI (sin tocar la VM aún)

1. `deploy/oci/docker-compose.micro.yml`  
   - `image: ghcr.io/yukac/ahorrar-api:micro` (o `:main`)  
   - `mem_limit` ~768m  
   - perfil `caddy` (80/443)  
   - volume `meli_data`  
2. `deploy/oci/.env.micro.example` — knobs slim + `DOMAIN=` + `API_UPSTREAM=api:4000`  
3. Workflow `.github/workflows/docker-ghcr.yml`  
   - trigger: `main` + manual  
   - `docker buildx` `linux/amd64`  
   - push GHCR (GITHUB_TOKEN)  
4. Docs: actualizar `PROD.md`, `STATUS.md`, este plan; README Micro  
5. Tests: no romper typecheck; opcional smoke script `scripts/oci-micro-smoke.sh`

**Done when:** imagen `amd64` publica en GHCR; compose micro validado con `docker compose config`.

### Fase B — Red / IP fija ($0)

1. Crear **Reserved Public IP** en `sa-saopaulo-1` (Always Free).  
2. Asociar al VNIC de `watchdog-micro` (o renombrar display name → `ahorrar-api-micro`).  
3. Anotar IP definitiva → `DOMAIN=<ip>.sslip.io`.  

**Done when:** IP pública estable documentada; ping/SSH a esa IP.

### Fase C — Bootstrap Micro

1. Extender o añadir `scripts/oci-bootstrap-micro.sh`:  
   - swap 2 G  
   - Docker Engine  
   - login GHCR (read) si la imagen es private; si public pull anónimo  
   - clone/pull repo `/opt/ahorrar`  
   - copiar `.env` (make-env + DOMAIN reserved)  
   - `docker compose -f deploy/oci/docker-compose.micro.yml --profile caddy pull && up -d`  
   - cron anti-idle cada 4 h  
2. Security List: ya 22/80/443.  
3. Smoke local en VM: `curl 127.0.0.1:4000/api/health`, `docker stats`, `free -h`.  

**Done when:** HTTPS `https://<ip>.sslip.io/api/health` → `ok:true` en &lt;2 s en caliente; sin OOM en 1 búsqueda de prueba.

### Fase D — Cutover prod

1. Vercel Production:  
   - `VITE_API_BASE=https://<ip>.sslip.io`  
   - `VITE_FREE_HOST=1`  
   - redeploy  
2. Actualizar ML redirect + webhook a sslip.  
3. Verificar UI → búsqueda real.  
4. Actualizar `docs/PROD.md`: primario Micro, backup Render.  

**Done when:** UI prod usa Micro; Render sigue UP pero no es el default.

### Fase E — Backup / runbook

1. Doc corto “Revert a Render” → [`REVERT-RENDER.md`](REVERT-RENDER.md).  
2. Dejar Render desplegado; no apagar.  
3. (Opcional) Uptime check semanal manual; **no** cron 24/7 agresivo a Render (horas Free).  

### Fase F — A1 (paralelo, no bloquea)

1. Retry/watchdog A1 opcional en PC.  
2. Si A1 `RUNNING`: perfil **full** compose, `VITE_FREE_HOST=0`, dominio nuevo/IP reserved 2ª o mover IP.  
3. Micro → lab / segundo servicio / apagar contenedor API (mantener VM si aporta anti-reclaim o liberar).  

---

## 5. Orden de ejecución sugerido (checklist)

- [x] A1a. `docker-compose.micro.yml` en repo  
- [x] A1b. `.env.micro.example` (slim knobs; trackeable vía `!.env.micro.example` en `.gitignore`)  
- [x] A2. Workflow GHCR amd64 (`.github/workflows/docker-ghcr.yml`)  
- [x] A3. Docs PROD/STATUS/README + smoke script en repo  
- [x] B1. Reserved Public IP → VNIC Micro (**147.15.72.239**)  
- [x] C1. Bootstrap (swap, docker, pull/build, caddy, anti-idle 4h)  
- [x] C2. Smoke health HTTPS + 1 search + `docker stats` OK  
- [x] D1. Vercel cutover (`VITE_API_BASE` sslip + `VITE_FREE_HOST=1`) · **ML URLs: confirmar en DevCenter**  
- [x] D2. Verificación UI prod (bundle embeds sslip)  
- [x] E1. Runbook revert Render (`REVERT-RENDER.md`)  
- [ ] F. A1 retry sigue opcional  

---

## 6. Criterios de abort / rollback

| Señal | Acción |
|---|---|
| OOM o health flap en smoke | No cutover; seguir en Render |
| Pull GHCR falla / imagen wrong arch | Fix CI; no buildear en Micro |
| Let's Encrypt / 80 cerrado | Revisar Security List antes de cutover |
| Post-cutover caídas | Revert Vercel a `https://ahorrar-api.onrender.com` + `VITE_FREE_HOST=1` |

---

## 7. Fuera de alcance (explícito)

- Cloudflare Workers / D1 / KV para el crawler  
- Split API/scraper en 2 Micros (salvo que Fase C falle por RAM)  
- Persistencia offer_cache a disco (solo si OOM persistente)  
- Pagar shapes / otra región / Support CSI  

---

## 8. Resultado esperado

- API **sin cold start** en Micro (sslip + reserved IP).  
- Render vivo como **backup**.  
- Builds **fuera** del Micro (GHCR).  
- Riesgos OOM / IP / reclaim **mitigados** (swap, slim, reserved IP, anti-idle).  
- Camino claro a A1 sin re-arquitectura (mismo Dockerfile, otro compose/env).
