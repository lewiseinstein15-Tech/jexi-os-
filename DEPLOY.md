# 🚀 Deploying JEXI OS — Render (backend) + Vercel (frontend)

JEXI OS is two pieces:

| Piece | What it is | Where it runs |
|-------|-----------|---------------|
| `server/` | Express "Brain": chat API, agents, memory core, knowledge library, Playwright browser (JEXI's eyes), terminal runner | **Render** (web service) |
| Frontend (`src/`, repo root) | React/Vite UI (chat, virtual desktop, memory, knowledge) | **Vercel** (static) |

---

## Part 1 — Deploy the backend to Render

The repo ships a **`render.yaml` blueprint** that pre-configures everything.

### Option A — Blueprint (recommended, ~2 min)
1. Push this repo to GitHub (it's already at `lewiseinstein15-Tech/jexi-os-`).
2. Go to [dashboard.render.com](https://dashboard.render.com/select-repo?type=web).
3. Click **New → Blueprint** (or *New + → Blueprint Instance*).
4. Select the `jexi-os-` repo. Render finds `render.yaml` and shows one service:
   - **jexi-os-brain** — Node 22, root dir `server/`, build `npm ci && (npx playwright install --with-deps chromium || npx playwright install chromium)`, start `npm start`, health check `/api/health`.
5. Pick your **region** and instance type (Free is fine to start).
6. Click **Apply / Create Resources**. Render builds & deploys (~4–8 min, the Chromium download is the slow part).
7. After the first deploy, open the service → **Environment** → add these **secret** env vars:
   - `GROQ_API_KEY` — from console.groq.com/keys
   - `GEMINI_API_KEY` (optional fallback) — from aistudio.google.com/app/apikey
   - Then **Manual Deploy → Deploy latest commit** to apply them.

### Option B — Manual web service
Dashboard → **New → Web Service** → connect the repo, then set:
- **Root Directory:** `server`
- **Environment:** Node
- **Build Command:** `npm ci && (npx playwright install --with-deps chromium || npx playwright install chromium)`
- **Start Command:** `npm start`
- **Instance Type:** Free (or Starter)
- **Health Check Path:** `/api/health`
- **Env vars:** `GROQ_API_KEY`, `GEMINI_API_KEY` (secrets)

### Verify it works
Open your service URL, e.g. `https://jexi-os-brain.onrender.com/api/health` — you should see:
```json
{"ok":true,"name":"JEXI OS Brain","version":"1.0.0","port":10000}
```

### Why the first build failed (and why it's fixed)

Render's build environment runs as a **non-root user without `sudo`**, so Playwright's
`install --with-deps` step (it needs root to run `apt-get` and install Chromium's system
libraries) fails with `su: Authentication failure` and used to kill the whole build.

The build command now falls back — if the system-deps step can't escalate, it still
downloads Chromium so the build succeeds:

```bash
npm ci && (npx playwright install --with-deps chromium || npx playwright install chromium)
```

> **Browser on the Free tier:** Chromium itself downloads fine, but its system libraries
> may be missing on a Free instance, so the Virtual Desktop may show **"Browser offline"**.
> When that happens JEXI reads pages server-side instead — chat, research, link analysis
> and memory all still work. For a **guaranteed working browser**, use a paid instance
> with the Docker runtime (Option C) — Docker isn't supported on Free instances.

### Option C — Docker runtime (guaranteed browser, paid)
A production-ready `server/Dockerfile` is included (Node 22 slim + Chromium system deps
baked into the image — no build-time `apt` needed, so the browser always works).
**Docker requires a paid instance** (Free doesn't support Docker). In Render, create the
service with **Docker** as the environment instead of Node, then set:
- **Root Directory:** `server` (Render finds `server/Dockerfile` automatically)
- **Env vars:** `GROQ_API_KEY`, `GEMINI_API_KEY`
- Docker runtime skips the npm/build steps — the image already contains everything.

Build locally to test: `docker build -f server/Dockerfile -t jexi-os-brain server`

---

## Part 2 — Point the frontend at your Render backend

The frontend finds the backend in this order:
1. `VITE_JEXI_BACKEND_URL` (set in Vercel — recommended)
2. The **Backend URL** field in the **Settings** tab (runtime override, applies instantly — no reload)
3. The "Cloud URL" box in the **Virtual Desktop** tab (stored in the browser)

### On Vercel
1. Import the same repo into Vercel (framework preset: **Vite**; build `npm run build`, output `dist/`).
2. **Project → Settings → Environment Variables**, add:
   - `VITE_JEXI_BACKEND_URL` = `https://jexi-os-brain.onrender.com`
3. Redeploy. The chat, memory, knowledge and virtual desktop will now talk to Render.

> No key goes on Vercel — `GROQ_API_KEY`/`GEMINI_API_KEY` stay server-side on Render.
> CORS is already wide open on the backend, so the Vercel domain can call it directly.

---

## 🧠 Keep JEXI's memory across restarts (Redis)

On Render the local disk is ephemeral, so JEXI's memory core resets on redeploys/restarts. To make her **remember everything permanently**, add a `REDIS_URL` env var:

1. Create a free **Upstash Redis** database (upstash.com — free tier).
2. Copy the connection string, e.g. `rediss://default:...@...upstash.io:6379`.
3. Add it as `REDIS_URL` in your Render service's environment.
4. Restart/redeploy. JEXI now mirrors her whole memory core (chat history, learned answers, coding solutions) to Redis, and re-hydrates it on every boot. Also survives spin-downs.

Memory always writes to the local JSON file first (fast), then mirrors to Redis — if Redis is ever down, JEXI just keeps working with local memory.

## ⚠️ Free-tier gotchas (important)

- **Spin-down**: a Free web service sleeps after **15 min idle** and takes ~1 min to wake on the next request. The first chat message after idle may be slow once.
- **Ephemeral disk**: JEXI's memory (`server/data/`) and generated files reset on redeploys/restarts on Free — solve with `REDIS_URL` above, or a **Persistent Disk** on a paid instance (`DATA_DIR=/data`).
- **750 free instance-hours/month** per workspace; a spun-down service uses none.
- **Memory**: Free instances have 512 MB — fine for one Chromium tab. For heavy use (many browser tabs), use the Starter/Standard plan.

---

## Part 3 — 💰 $0 hosting (no credit card): Hugging Face Spaces

No money and no card? Hugging Face Spaces runs JEXI **completely free** — and because its
Docker build runs as **root**, Chromium's libraries install properly, so JEXI's virtual
desktop **works** (the one thing Render's free tier can't give you). The repo's
`Dockerfile` is already a single-container image: it builds the frontend and serves it
from Express, so the whole app runs on **one** free host — you don't even need Vercel.

- Free CPU Basic space: **$0/month**, sign-up with just an email (no card).
- URL after deploy: `https://<your-username>-jexi-os.hf.space` — the full JEXI OS UI.

### Steps (about 10 minutes)
1. Create an account at **huggingface.co** (email only, no card).
2. Create an access token: **huggingface.co/settings/tokens** → *New token* → role **Write** → copy it.
3. In GitHub: repo → **Settings → Secrets and variables → Actions → New repository secret** →
   name `HF_TOKEN`, paste the token.
4. GitHub → **Actions** → **Deploy to Hugging Face Spaces** → **Run workflow** → enter your Space ID,
   e.g. `your-username/jexi-os` (the Space is created automatically).
5. Wait ~5–8 min for the build (it installs Chromium + deps as root — that's a good thing).
6. Open `https://<your-username>-jexi-os.hf.space/api/health` → expect `{"ok":true,...}`.
7. Add keys: on the Space page → **Settings → Variables and secrets** → add `GROQ_API_KEY`
   (and optionally `GEMINI_API_KEY`), then rerun the workflow to apply them.
8. Open the Space page → JEXI OS is running. 🎉

### Keeping JEXI's memory on HF
Space disk is ephemeral (resets on rebuild). To make her remember everything:
- **Storage Bucket**: Space → **Settings → Storage** → attach a bucket, mount path **`/data`**.
  The Dockerfile already sets `DATA_DIR=/data`, so memory + knowledge auto-persist there.
- Or set `REDIS_URL` (Upstash free tier) — JEXI mirrors her memory to Redis as backup.

### Free-tier notes
- A free Space sleeps after **48h** of no visitors and wakes on the next visit (~30–60s).
- Outbound internet works, so research + link analysis behave normally.

### Same image anywhere else
`docker compose up --build` runs the identical container locally (port 7860, memory in a
Docker volume), and it's also the image for any VPS.

---

---

## 📚 The book library — JEXI answers from YOUR books (not just the internet)

Upload your own books & PDFs and JEXI treats them as the **first source of truth**
when answering — grounded, accurate answers with citations, instead of generic
AI guesses or heavy internet research.

### Add books (two ways, in the **Knowledge** tab)

1. **ADD A BOOK / PDF** — pick `.pdf`, `.txt` or `.md` files from your device
   (max 15MB each, up to 6 books). PDFs are parsed server-side with `unpdf`;
   text files are read directly.
2. **FETCH from a link** — paste a direct URL to a PDF or text file and JEXI
   downloads and indexes it (SSRF-guarded).

### How it works

- Book text is stored in the memory core (`bookLibrary`), which is **mirrored to
  Redis** when `REDIS_URL` is set — so books survive redeploys/restarts.
- On every chat message, JEXI searches her books **before** touching the
  internet. Questions like *"what does my book say about X"* are routed
  straight to the library.
- Answers cite the source book, quote the relevant passages, and only use the
  AI to *compose* the answer from those passages (a small, cheap prompt).
- **No AI key? Still useful** — she returns the exact matching passage as a
  direct quote, so simple lookups work even without `GROQ_API_KEY`/
  `GEMINI_API_KEY`.

### Persistence notes

- Book *text* lives in `memory.json` (Redis-mirrored) → survives restarts.
- The original uploaded file is saved to `DATA_DIR/books/` for download — on
  Render's free tier that disk is ephemeral and resets on redeploy, so keep
  your source PDFs; a persistent disk or HF Spaces bucket makes originals
  permanent too.
- Scanned/image-only PDFs (no text layer) can't be read without OCR — JEXI
  will tell you when a file has no extractable text.

---

## Local development (unchanged)

```bash
# Terminal 1 — backend (port 3002)
cd server && npm ci && npm start

# Terminal 2 — frontend (port 3000, proxies /api to 3002)
npm ci && npm run dev
```
Add keys in the app's **Settings** tab (writes `server/settings.json`), or set `GROQ_API_KEY`/`GEMINI_API_KEY` env vars.
