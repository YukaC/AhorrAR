# Deploy notes — free / low-cost hosting

## Recommended split (generous free tiers)

| Piece | Where | Why |
|---|---|---|
| **Frontend** | [Vercel](https://vercel.com) Hobby | HTTPS, CDN, great free tier, Redirect URI for ML OAuth |
| **API + crawler** | Keep off Vercel serverless | Scrapling/Playwright need long CPU and a persistent process |

Vercel Hobby is excellent for the **UI + OAuth callback URL**. The live crawler belongs on a small always-on free/cheap host later (Fly.io, Render free with cold starts, or a home VPS). Until then, point the UI at a publicly reachable API or run API locally.

## Frontend on Vercel

```bash
# from repo root
npx vercel --cwd frontend
```

Root directory: `frontend`  
Build: `npm run build`  
Output: `dist`  
Framework: Vite

Env (Production):

```
VITE_API_BASE=https://YOUR-API-HOST
```

If `VITE_API_BASE` is empty, the UI talks to same-origin `/api` (configure rewrites) or falls back to `http://localhost:4000` in local dev.

## Mercado Libre Redirect URI

After Vercel deploy:

```
https://YOUR-PROJECT.vercel.app/api/auth/meli/callback
```

(Implement the callback route when enabling OAuth — see `docs/ML.md`.)

## Legal

- [LICENSE](../LICENSE) (MIT)
- [PRIVACY.md](../PRIVACY.md)
- [SECURITY.md](../SECURITY.md)
- [NOTICE](../NOTICE)
