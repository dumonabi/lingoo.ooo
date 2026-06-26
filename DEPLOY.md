# Deploy Lingu.ooo on Vercel

## Live URL

**https://lingu-ooo.vercel.app**

> Vercel project: `linguooo` · GitHub repo: `Linguooo`

---

## Environment variables

| Name | Value | Environments |
|------|--------|----------------|
| `OPENAI_API_KEY` | your key (`sk-...`) | Production, Preview, Development |
| `APP_PASSWORD` | access code for users | Production, Preview, Development |

Never commit `.env` to GitHub.

Set a monthly spending limit at [platform.openai.com/settings/organization/limits](https://platform.openai.com/settings/organization/limits).

---

## Redeploy after code changes

```bash
git add .
git commit -m "Your change description"
git push
```

Vercel redeploys automatically on every push to `main`.

---

## Keep-warm (cold start)

Vercel serverless functions can take 1–3 s on the first request after idle.

| Mechanism | Interval | Notes |
|-----------|----------|--------|
| **GitHub Actions** (`.github/workflows/keep-warm.yml`) | Every 10 min | Pings `/api/health` on production URLs after push to `main` |
| **Client** (`src/keep-warm.js`) | Every 8 min | While the tab is visible on production (not localhost) |

Vercel **Hobby** only allows built-in cron once per day. For 5–10 min intervals, use the GitHub workflow above (free on public repos).

**Pro plan:** you can also add native cron in `vercel.json`:

```json
"crons": [{ "path": "/api/health", "schedule": "*/10 * * * *" }]
```

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `API key not configured` | Add `OPENAI_API_KEY` in Vercel → Settings → Environment Variables, then **Redeploy** |
| `Unauthorized` | Add or update `APP_PASSWORD` in Vercel, redeploy, share the code with users |
| `Too many messages this hour` | Rate limit (100 messages/hour per IP). Wait or adjust in `server/security.js` |
| Function timeout / 504 | Upgrade to Vercel Pro, or use shorter voice messages |
| Mic not working | Use Chrome or Safari, allow microphone permission, site must be HTTPS |
