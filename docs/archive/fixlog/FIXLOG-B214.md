# FIXLOG — B214 Preview Links Always Work

**Ask:** "correct when she sends a preview link to always work in any
browser."
**Scope:** the workspace publisher (the separate `jexi-workspace` GitHub
Pages repo where Ada's web builds land) + the chat message that hands the
link over.

## What was actually broken

1. **The fresh-404 window (the real killer).** `publishProject` committed
   the files via the Contents API and returned the URL immediately — but
   GitHub Pages rebuilds asynchronously for the next ~10-60s. She said
   "Open it live" and the user's browser said 404. The CDN even caches
   404s briefly, so a fast retry could keep failing.
2. **No `.nojekyll`.** GitHub Pages runs Jekyll by default, which silently
   drops `_`-prefixed directories (Next.js `_next/`, `_vendor/` …) and
   dotfiles. Any published app with such assets would load broken in
   every browser alike.
3. **24h TTL by default** — a link sent yesterday was legitimately dead
   today (when the sweep ran).

## The fix

- `waitForLive(url)` — poll the public URL (cache-busted, redirect-follow,
  8s per attempt) until it serves 200, bounded at 45s. `publishProject`
  now waits before calling anything a link, and returns `live` +
  `waitedMs`. If Pages is slow past the bound, it returns `live: false`
  with the honest note — never a fake "it's up".
- **Honest chat messaging** (`TeamRouter`): live → "**Open it live
  (works on any device):** … *Verified serving just now*"; not yet →
  "**Publishing now:** … *GitHub Pages rebuilds take up to a minute —
  refresh if it's not ready yet.*"
- **`.nojekyll` ensured** on every publish (one-time cheap GET, PUT only
  when missing) — and committed to the live workspace repo immediately.
- **Clean directory URLs** for `index.html` entries (`…/app/` instead of
  `…/app/index.html`) — same page, survives entry renames.
- **Production TTL raised to 7 days** (`JEXI_WORKSPACE_TTL_HOURS=168` on
  Render) — links stop dying after a day. Default stays 24h for
  self-hosters; the index's "Xh left" and the chat message reflect the
  real TTL.

## Proof

- `server/test-b214.js` — 4 always-on checks (`waitForLive` against real
  local servers: goes-live-mid-poll → `live:true` with the real
  turnaround time; never-live → honest `live:false`; connection refused →
  no crash) + 7 live-E2E checks behind `JEXI_WORKSPACE_E2E=1` (real
  publish to the live workspace repo: waited for live, clean dir URL,
  public URL serves OUR marker content to a fresh client, `.nojekyll`
  serves 200, cleanup clears).
- **Live run: 11/11** against the real repo (token via env, never in
  code).
- Full `npm test` chain green; CI 5/5; prod deploy + live verification
  (see below).

## Honest notes

- The 45s wait bound: if GitHub Pages is having a really slow day, she
  says "publishing now" with the link instead of blocking the chat — the
  link still goes live on its own.
- The TTL sweep only runs on boot/publish/manual (`/api/workspace-admin/
  sweep`), so links can outlive the TTL until the next sweep — the
  opposite of breaking.

## INCIDENT (same session, full disclosure): Render env set wiped — twice

While raising the TTL I PUT a single env var to the Render API. **The
PUT replaces the entire set** (it is not an upsert) — the service's 24
env vars collapsed to 1, and every deploy from that moment failed
(`Refusing to start: JEXI_API_KEY is required in production`) while the
old container kept serving, masking it. I then repeated the same mistake
once during recovery before burning the rule in.

**Recovery (verified live):** 22 vars restored — 8 read back from the
earlier session dump, 12 from the local `server/.env` (the user's own
keys; the GITHUB_TOKEN had to be the classic PAT — the fine-grained
local one cannot write `jexi-workspace`), and the Render env-vars API
**paginates at 20** (the first dump was page 1 of 2; `HF_TOKEN`,
`MISTRAL_API_KEY`, `NVIDIA_API_KEY`, `JEXI_API_KEY` were on page 2 —
caught via `/api/settings/status` on the still-running old process).
Post-restore verification: deploy live, health ok, key enforcement
identical (401/200), all 12 model lanes env-configured exactly as
before, and a real publish through the prod API returned `live: true`
after waiting out the Pages rebuild (22.8s).

**Still missing (user must re-paste in the Render dashboard):**
- `FIREBASE_SERVICE_ACCOUNT_B64` (push notifications; a hand-transcribed
  copy was corrupt and was discarded rather than shipped)
- `WHATSAPP_ACCESS_TOKEN` + `VERIFY_TOKEN` (WhatsApp messaging)
- `RESEND_API_KEY` (outbound email)
Everything else is verified at functional parity.

**Rules burned in:** Render env-vars PUT = whole-set replace (GET with
`limit=100` → merge → PUT everything, always); the env API paginates at
20; a "running fine" old container hides a broken deploy config.

## Deploy-hook race fixed for good

`render-deploy.yml` pinged the Render hook the moment code pushed —
racing the Docker publish, so Render could re-deploy a stale image (bit
us in B212, B213 and today). The hook ping now lives INSIDE
`docker-publish.yml` as the step AFTER the image push; the standalone
workflow is manual-only.

## User decision (2026-09-04): the 4 unconfigured integrations stay off

The four env values that were not recoverable (`FIREBASE_SERVICE_ACCOUNT_B64`,
`WHATSAPP_ACCESS_TOKEN`, `VERIFY_TOKEN`, `RESEND_API_KEY`) are **unused by
choice** — the owner will rebuild those integrations properly as a future
build ("build them well as intended"). Until then they stay unset: the
brain boots, serves, and degrades honestly without them (verified live —
health, key enforcement, 12 model lanes, missions, publishing all green).
Next-build scope: WhatsApp messaging, push notifications, outbound email —
each already designed to no-op cleanly when unconfigured.

## Addendum — binary publish support (same day)

**Found live:** demo-post images (banner.jpg, app-login.png, app-dashboard.png) published as 9-byte
files — literal text "undefined". Cause: the b64 binary format was edited locally but PROD still ran
the old publisher, which read the nonexistent `code` field on `{name,b64}` files. Lesson recorded:
**a local edit does nothing for prod — deploy before exercising new code paths on prod.**

**Fix (commit `62b7f6a`):** `putFile` accepts `content = {b64}` passed through as-is (text stays
utf-8→base64); E2E §3 added to test-b214.js — publishes a real 1×1 PNG and byte-compares it back.
CI green (CI/Pages/APK/docker-publish); docker-publish pushed image + hook deployed it (the race
fix held: deploy `dep-dadc529tb6fs73a99ma0` started after the image push). Env intact (22 vars).

**Verified on prod:** `jexi-demo` republished — banner.jpg 84,246 B, app-login.png 47,127 B,
app-dashboard.png 89,969 B — all three byte-identical (sha256) to the source files. B207 phone-width
drive: 3/3 images render (naturalWidth > 0), no horizontal overflow, both links resolve, zero
console errors. Future builds with images/assets publish natively.

**Known (pre-existing, not a regression):** chat transcripts live at DATA_DIR/conversations/*.jsonl
on the ephemeral container disk — every deploy starts a fresh container, so chat history does not
survive restarts. App code, workspace projects and long-term memory ride external stores (GitHub
repo / Redis). Persistent transcript storage is a future-build candidate.
