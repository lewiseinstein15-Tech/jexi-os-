# 🚀 Move JEXI's brain to Koyeb — FREE, no card, always-on

Render's free **build minutes** ran out (the brain still RUNS there on the
old build — only new builds are blocked). Koyeb is the new home:

| | Koyeb free |
|---|---|
| Price | **KSh 0 forever** — no credit card |
| Sleep | **None — always on** (better than Render's 15-min sleep!) |
| Specs | 512 MB RAM · 0.1 vCPU · 2 GB disk |
| Deploys | Automatic on every git push (like Render) |
| Docker | Full support — ffmpeg + yt-dlp for `/watch` included |

---

## Your part — 10 minutes, phone-friendly

### 1. Create the account
- Open **https://app.koyeb.com** → **Sign up with GitHub** (no card asked)

### 2. Create the app
- **Create App** → **GitHub** → pick **lewiseinstein15-Tech/jexi-os-** → branch **main**
- Builder: **Dockerfile** (it auto-detects ours)
- Instance: **Free**
- Port: it reads our `EXPOSE 7860` — leave default; if asked for a health
  check path, use **`/api/health`**

### 3. Add the environment variables
In the app's **Environment variables** section, copy these from Render
(Render → jexi-os-brain → Environment → open each → copy value):

**AI keys:** `GROQ_API_KEY` · `GEMINI_API_KEY` · `OPENROUTER_API_KEY` ·
`HF_TOKEN` · `CEREBRAS_API_KEY` · `DEEPINFRA_API_KEY` · `MISTRAL_API_KEY` ·
`XAI_API_KEY` · `NVIDIA_API_KEY` · `SAMBANOVA_API_KEY` · `TAVILY_API_KEY`
· `DEEPSEEK_API_KEY` (harmless, no credit) · `GITHUB_TOKEN`

**Must-adds:**
- `JEXI_API_KEY` = your access key (`com/0006/25`)
- `JEXI_NO_BROWSER` = `1`  ← **important on the 512MB free plan** (Chromium
  can eat all the RAM; search/research//watch/vision all work WITHOUT it —
  only remote browser-control is paused. Remove this var later if you ever
  upgrade the instance.)

### 4. Deploy
- Tap **Deploy**. First build takes ~10–15 min (it downloads Chromium +
  ffmpeg into the image). Later builds are faster.
- When green, you get a URL like `https://jexi-os-brain-xxxx.koyeb.app`

### 5. Paste that URL to your engineer (me 😄)
I then flip one repo variable (`BACKEND_URL`) and the **website + APK
automatically rebuild pointed at Koyeb**. Old installed APKs: Settings →
**Server address** field (new APK) — or just update the APK.

---

## Why Koyeb won over the others (checked Aug 2026)
- **Zeabur** — $5/month credit runs out for an always-on server
- **Back4App** — only 256 MB (too small)
- **Railway** — $5 one-time trial, not forever
- **Northflank / Fly / Oracle / Cloud Run** — demand a credit card
- **HF Spaces** — now needs a paid PRO plan to create Docker spaces

Render stays running (free) on the old build as a fallback for old APKs —
nothing to delete.
