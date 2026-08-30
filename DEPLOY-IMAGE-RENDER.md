# 🐳 JEXI brain on Render — ZERO build minutes (image deploy)

**The problem:** Render free limits *build* minutes (that's what you hit).
The running server was always free.

**The fix (already automated):** GitHub Actions now builds JEXI into a
ready Docker image (GitHub gives 2,000 free build minutes/month) and
publishes it to your own package registry. Render just **pulls the ready
image** — pulling is not building, so the Render limit is never touched.
No new account. No card. Same Render you already know.

---

## Your part — ~8 minutes

### 1. Make the package public (one click, after the first build finishes)
- Your repo → **Packages** (right sidebar) → **jexi-os-** → **Package settings**
  → Danger Zone → **Change visibility** → **Public**
- (Needed so Render can pull it without login. The image contains no secrets.)

### 2. Create the new brain service
- **dashboard.render.com** → **New +** → **Web Service**
- Choose **"Deploy an existing image from a registry"**
- Image URL: **`ghcr.io/lewiseinstein15-tech/jexi-os-:latest`**
- Name: `jexi-brain-image` · Region: Frankfurt (closest free) · Instance: **Free**
- Health check path: **`/api/health`**

### 3. Environment variables
Copy the same list from your old service (old service → Environment → open
each value). Must-haves:
- `JEXI_API_KEY` = your access key
- all AI keys (Groq/Gemini/OpenRouter/etc.), `TAVILY_API_KEY`, `GITHUB_TOKEN`
- **Do NOT add** `JEXI_NO_BROWSER` — the slim image already defaults it on.

### 4. Deploy → paste the new URL to your engineer
First pull ~2-3 min. Then I flip one repo variable and the website + APK
rebuild pointed at the new brain.

### 5. Old service
Suspend/delete the old `jexi-os-brain` (free plan = 750 hours = one 24/7
service). Old APKs pointed at it will be re-pointed via the new APK's
**Settings → Server address**.

## Why not Koyeb/Zeabur/Back4App? (checked Aug 2026)
- Koyeb — signup hangs in some regions (you hit it)
- Zeabur — $5/mo credit runs out; Back4App — 256MB too small
- This plan: no new account, no card, nothing to migrate
- Bonus: Render build minutes reset monthly anyway — this just never needs them
