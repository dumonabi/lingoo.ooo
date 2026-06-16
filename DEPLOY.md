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

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `API key not configured` | Add `OPENAI_API_KEY` in Vercel → Settings → Environment Variables, then **Redeploy** |
| `Unauthorized` | Add or update `APP_PASSWORD` in Vercel, redeploy, share the code with users |
| `Too many messages this hour` | Rate limit (100 messages/hour per IP). Wait or adjust in `server/security.js` |
| Function timeout / 504 | Upgrade to Vercel Pro, or use shorter voice messages |
| Mic not working | Use Chrome or Safari, allow microphone permission, site must be HTTPS |
