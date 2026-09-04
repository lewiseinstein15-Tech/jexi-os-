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
