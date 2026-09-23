# FIXLOG-B120 — The freeze was a STALE LIVE SERVER (Render never redeployed)

**Phase:** B120 · **Branch:** main

## What I found (not a code bug this time)
I reproduced the full send flow locally with the CURRENT code: the server boots, the
chat request streams 11 events and completes (`done`) — no freeze, no crash. The
frontend bundle on GitHub Pages is fresh. The problem is the **live backend**:

- `https://jexi-os-brain.onrender.com/api/health` shows `uptime ≈ 10,600s` (~3 hours)
  — the running instance predates the **B116 TDZ fix** (the "Cannot access 'mode'
  before initialization" crash that killed every chat request).
- Render's GitHub auto-deploy **has not fired** for the last several pushes, so the
  live server is still running the crashing code. Every message you send hits that
  old instance → crash → nothing streams → "freezing, can't send".

## What I shipped to make this visible & verifiable
- **`server/build-stamp.json` + `/api/health.build`**: the health endpoint now reports
  the deployed commit/phase. Bump the stamp on every push, so a stale deploy is
  instantly detectable: `curl https://jexi-os-brain.onrender.com/api/health` → look at
  `build.commit`.
- Verified locally: `/api/health` returns `build: {commit: 5c768d3, phase: B119…}`;
  api-surface suite green; full sweep re-run below.

## WHAT YOU MUST DO (2 minutes, on your side — I can't reach the Render dashboard)
1. Open https://dashboard.render.com → service **jexi-os-brain**.
2. Click **Manual Deploy → Deploy latest commit** (use "Clear build cache & deploy"
   if you want a clean build).
3. Wait ~3-5 min (Playwright Chromium install in the build), then check:
   `curl https://jexi-os-brain.onrender.com/api/health` → `build.commit` should be
   `5c768d3` (or newer).

## Optional — let me automate it
If you give me either:
- a **Render deploy hook** (Render → jexi-os-brain → Settings → Deploy Hook → copy
  URL), or
- a **RENDER_API_KEY** (Dashboard → Account → API Keys),
I'll wire automatic redeploy verification + a hook trigger into the keepalive
workflow so this can never strand you on a stale instance again.
