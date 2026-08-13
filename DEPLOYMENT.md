# JEXI OS — Deployment Guide

JEXI OS ships as two halves:

- **Backend ("Brain")** — Node/Express service in `server/`. All agent logic, the
  8-provider model router, memory, tasks, automations, MCP server, and the
  Playwright virtual desktop live here.
- **Frontend** — Vite/React app at the repo root (`src/`). Served statically
  (Vercel / GitHub Pages / any static host), talks to the backend over `/api`.

---

## 1. Backend deploy (Render, via `render.yaml`)

The repo ships a Render Blueprint (`render.yaml`) that pre-fills the service:

1. Push to GitHub, then in Render choose **New → Web Service → pick the repo**.
2. Render auto-detects `render.yaml` (service `jexi-os-brain`, free plan, `rootDir: server`).
3. **Secrets** — set these in the Render dashboard (Environment) before the first
   successful deploy (any 1 of the first 2 is required; the rest are optional failover):
   - `GROQ_API_KEY` (one of the two required)
   - `GEMINI_API_KEY` (one of the two required)
   - `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `DEEPINFRA_API_KEY`, `MISTRAL_API_KEY`,
     `XAI_API_KEY`, `HF_TOKEN` (optional failover providers)
   - `GITHUB_TOKEN` (optional — GitHub agent commit/push/PRs)
   - `JEXI_API_KEY` (recommended — locks the API; the app sends it from Settings → JEXI Access Key)
   - `JEXI_MCP_KEY` (optional — locks the `/mcp` endpoint with Bearer auth)
   - `CORS_ORIGINS` (optional — comma-separated browser origins allowed to call the API)
4. **Runtime env (Blueprint sets these automatically):** `NODE_VERSION=22`,
   `HOME=/tmp`, `PLAYWRIGHT_BROWSERS_PATH=0` (Chromium inside `node_modules` so it
   survives build → runtime), `DATA_DIR=/data` (recommended — persistent memory/trust/screenshots).
5. **Verify:** after deploy, `GET https://<your-service>.onrender.com/api/health`
   should return `{ ok: true }` and `/api/health/providers` shows live per-provider
   health. `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium` runs during
   the build; if it ever fails the install, the browser falls back to server-side reading.

> Key rule: **env vars always win** over keys pasted in the Settings panel. After
> changing a key on Render, redeploy (env is injected at boot).

## 2. Frontend deploy (Vercel / GitHub Pages / static)

1. Build: `bun install && bun run build` → static output in `dist/`.
2. Set one frontend env var at build time:
   - `VITE_JEXI_BACKEND_URL=https://<your-service>.onrender.com` — the API origin.
   - Leave unset to call the same origin (`/api` — works when frontend + backend share a host).
3. The Settings screen also lets users override the backend URL at runtime, so a
   stale build can still be pointed at a new backend without rebuilding.

## 3. Self-hosted (local / VPS)

```bash
cd server && npm ci && npm start          # backend on :3002 (PORT overridable)
bun install && bun run dev                # frontend dev (Vite proxy → :3002)
```

## 4. Environment variable matrix

| Variable | Required | Purpose |
|---|---|---|
| `GROQ_API_KEY` | one of the two | Fast chat/code (Groq) — leads code/data/news intents |
| `GEMINI_API_KEY` | one of the two | Code + vision (Gemini) — leads math/vision intents |
| `OPENROUTER_API_KEY` | optional | Seed vision + free text — leads research intents |
| `CEREBRAS_API_KEY` | optional | Cerebras free tier (no card) failover |
| `DEEPINFRA_API_KEY` | optional | DeepInfra free open models failover |
| `MISTRAL_API_KEY` | optional | Mistral free Experiment tier failover |
| `XAI_API_KEY` | optional | Grok (xAI) frontier models failover |
| `HF_TOKEN` | optional | HuggingFace Inference API (last-resort fallback) |
| `GITHUB_TOKEN` | optional | GitHub agent (commit/push/PRs) |
| `JEXI_API_KEY` | optional | Locks the API (all `/api` requests need `x-jexi-key`) |
| `JEXI_MCP_KEY` | optional | Locks `/mcp` (Bearer auth) |
| `CORS_ORIGINS` | optional | Comma-separated allowed browser origins |
| `REDIS_URL` | optional | Shared memory across instances/restarts |
| `DATA_DIR` | optional | Persistent data (defaults `server/data`); use a persistent volume in prod |
| `WORKSPACE_DIR` | optional | Generated-file workspace (defaults `server/jexi-workspace`) |
| `PORT` | optional | Backend port (default 3002) |
| `NODE_VERSION` | build-time | Pin Node (Blueprint uses 22) |
| `HOME` | runtime | Writable home for Chromium (Blueprint uses `/tmp`) |
| `PLAYWRIGHT_BROWSERS_PATH` | runtime | `0` keeps Chromium inside `node_modules` |
| `COMPUTER_RUNTIME` | optional | `local` / `remote` / `docker` / `mock` — computer provider (default auto → remote in-process bridge) |
| `VIRTUAL_API` | optional | External desktop/coder bridge base URL (overrides in-process browser) |
| `MCP_PORT` | optional | MCP server port (default 3457) |

## 5. Roadmap stage 25 status

Deployment architecture is documented and verified (`/api/health`, `render.yaml`,
static frontend flow). Remaining cloud work is operational, not code: setting
`DATA_DIR` to a persistent volume, adding `REDIS_URL` for multi-instance memory,
and a CDN/domain in front of the static frontend.
