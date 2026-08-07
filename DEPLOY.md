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
   - **jexi-os-brain** — Node 22, root dir `server/`, build `npm ci && npx playwright install --with-deps chromium`, start `npm start`, health check `/api/health`.
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
- **Build Command:** `npm ci && npx playwright install --with-deps chromium`
- **Start Command:** `npm start`
- **Instance Type:** Free (or Starter)
- **Health Check Path:** `/api/health`
- **Env vars:** `GROQ_API_KEY`, `GEMINI_API_KEY` (secrets)

### Verify it works
Open your service URL, e.g. `https://jexi-os-brain.onrender.com/api/health` — you should see:
```json
{"ok":true,"name":"JEXI OS Brain","version":"1.0.0","port":10000}
```

### Option C — Docker runtime (more reproducible)
A production-ready `server/Dockerfile` is included (Node 22 slim + Chromium system deps).
In Render, create the service with **Docker** as the environment instead of Node, then set:
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

## Local development (unchanged)

```bash
# Terminal 1 — backend (port 3002)
cd server && npm ci && npm start

# Terminal 2 — frontend (port 3000, proxies /api to 3002)
npm ci && npm run dev
```
Add keys in the app's **Settings** tab (writes `server/settings.json`), or set `GROQ_API_KEY`/`GEMINI_API_KEY` env vars.
