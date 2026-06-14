# Deploy Lingo on Vercel

## Before you start

- A [GitHub](https://github.com) account
- A [Vercel](https://vercel.com) account (free is fine to start)
- Your **OpenAI API key** ready

> **Important:** Lingo calls OpenAI (transcribe + translate + voice). Each message uses your API credits.
>
> **Timeout:** Audio processing can take 15–30 seconds. Vercel **Free** plan limits functions to **10 seconds** — long messages may fail. For production, use **Vercel Pro** (60s limit) or deploy the API on [Railway](https://railway.app) / [Render](https://render.com).

---

## Step 1 — Push code to GitHub

Open Terminal in the project folder:

```bash
cd /Users/adrianhernandez/Desktop/Lingo
git add .
git commit -m "Prepare Lingo for Vercel deployment"
```

Create a new repository on GitHub (github.com → **New repository** → name it `lingo` → **Create**).

Then connect and push:

```bash
git remote add origin https://github.com/TU_USUARIO/lingo.git
git branch -M main
git push -u origin main
```

Replace `TU_USUARIO` with your GitHub username.

---

## Step 2 — Import project in Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (with GitHub is easiest).
2. Click **Add New…** → **Project**.
3. Select your **lingo** repository.
4. Vercel should detect:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Do **not** change those unless something looks wrong.

---

## Step 3 — Environment variables

Before clicking Deploy, open **Environment Variables** and add:

| Name | Value | Environments |
|------|--------|----------------|
| `OPENAI_API_KEY` | your key (`sk-...`) | Production, Preview, Development |
| `APP_PASSWORD` | a long access code you share with users | Production, Preview, Development |

- **`OPENAI_API_KEY`** — required for transcription and translation.
- **`APP_PASSWORD`** — optional but recommended. When set, users must enter this code once per browser session before using the app. Scripts without the code cannot call your API.

Never commit `.env` to GitHub — secrets stay only in Vercel.

**Also set a monthly spending limit** at [platform.openai.com/settings/organization/limits](https://platform.openai.com/settings/organization/limits).

---

## Step 4 — Deploy

Click **Deploy** and wait 1–2 minutes.

When it finishes, you get a URL like:

`https://lingo-xxxxx.vercel.app`

Open it on your phone or computer and test the microphone.

---

## Step 5 — Custom domain (optional)

In Vercel → your project → **Settings** → **Domains**, add your own domain.

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `API key not configured` | Add `OPENAI_API_KEY` in Vercel → Settings → Environment Variables, then **Redeploy** |
| `Unauthorized` / access screen | Add `APP_PASSWORD` in Vercel, redeploy, share the code with users |
| `Too many messages this hour` | Rate limit (100 messages/hour per IP). Wait or adjust in `server/security.js` |
| Function timeout / 504 | Upgrade to Vercel Pro, or use shorter voice messages |
| Mic not working | Use **Chrome** or **Safari**, allow microphone permission, site must be **HTTPS** (Vercel provides this) |
| Build failed | Check Vercel build logs; run `npm run build` locally first |

---

## Redeploy after code changes

```bash
git add .
git commit -m "Your change description"
git push
```

Vercel redeploys automatically on every push to `main`.
