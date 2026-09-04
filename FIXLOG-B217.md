# FIXLOG B217 — Survive the sleep: keep-warm + Redis persistence mirror

**Date:** 2026-09-04 · **Trigger:** the B216 post-ship incident (see FIXLOG-B216.md addendum)

## What happened (the two incidents, in one paragraph each)

1. **GitHub Pages went dark.** Between ~16:02–16:09 UTC the Pages site was
   disabled by something OUTSIDE the repo (no workflow, collaborator, deploy
   key or webhook did it — all checked via API). The account holds a
   full-scope never-rotated PAT and a third-party AI app (`freebuff-web` by
   CodebuffAI); either could have done it with one API call. The definitive
   actor is only visible in the user's Security Log
   (github.com/settings/security-log → filter "pages" → `pages.disable`).
2. **The brain slept and forgot.** Render free tier hibernates after ~15 min
   without INBOUND traffic and hands back a FRESH disk on wake. Upstash Redis
   (REDIS_URL) was believed to keep her awake — it can't: it's an outbound
   DATA connection, not an inbound heartbeat. The GitHub keepalive cron
   (`*/10`) was supposed to ping her, but GitHub starved it to ~5–6 runs/day
   (2.5–4.5h gaps, chronic). Result: she slept daily, and the 15:45 hibernation
   → 16:20 wake wiped the mission created at 15:02.

## What shipped (this build)

### 1. Pages self-heal guard — `.github/workflows/keepalive.yml`
Every keepalive run now also checks the app site. On non-200 it:
re-enables Pages via API (`POST /repos/…/pages {"build_type":"workflow"}`,
token = Actions secret `GH_PAGES_GUARD_TOKEN`), re-runs the latest successful
frontend deploy, and emits a loud `::warning::` annotation telling us to check
the Security Log. Self-heals recurrence within one cron run.

### 2. Self-ping keep-warm — `server/index.js`
With `JEXI_SELF_PING=1` (now set on Render via env API) she pings her own
public `/api/health` (RENDER_EXTERNAL_URL) every ~9 min + jitter while
running. Honest limit: this keeps a RUNNING instance from idling out; it
cannot wake a stopped one (still needs external traffic: cron/monitor/user).
Enabled on prod: 22 existing env vars preserved + `JEXI_SELF_PING=1` added.

### 3. Redis persistence mirror — `server/src/services/RedisMirror.js` (the data-loss fix)
- Every 30s: push files under `DATA_DIR/{missions,world,conversations}`
  whose mtime changed → Redis key `jexi:mirror:<relpath>`, 45-day TTL
  (refreshed each sync). Only `.json`/`.jsonl`.
- On boot (before mission boot recovery): `hydrateMirroredDirs()` writes back
  every mirrored file MISSING on disk (atomic tmp+rename; disk always wins).
- Zero changes to the persistence cores (Mission/WorkGraph/Lessons/WorldState/
  SessionConversations untouched) — the B211 systems keep working exactly as
  they are; the mirror watches the filesystem.
- No Redis → honest no-op with recorded reason (never crashes local dev).
- Telemetry: `GET /api/mirror/status` → `{active, keys, lastSyncAt,
  lastSyncFiles, lastHydrateAt, lastHydrateFiles}` (counts only, no content).
- RPO: at most 30s of writes — vs total loss before.

### 4. `test-b217.js` (in the `npm test` chain, 6 cases)
no-Redis no-op honesty · changed-file-only sync + 45d TTL + extension filter
· **the incident replay**: sync → wipe disk → hydrate → 6/6 files
byte-identical · disk-wins rule · loop idempotence + immediate first tick ·
scope isolation (nothing outside mirrored dirs).

## Verification
- `node test-b217.js`: 6/6 PASS (fake-redis seam, no network).
- Full `npm test` chain: run before push (see commit CI).
- Post-deploy prod checks: `/api/mirror/status` shows `active:true` + keys
  climbing; `/api/health` uptime climbing past 15 min (self-ping working);
  Pages 200.

## Honest limits
- Self-ping cannot resurrect a STOPPED instance; if she's down, only external
  traffic (keepalive cron — now best-effort — or a user request) wakes her.
  Optional stronger fix for the user: UptimeRobot/cron-job.org free monitor →
  `https://jexi-brain-image.onrender.com/api/health`, or QStash scheduled
  message (needs the Upstash API token).
- Mirror loses the last ≤30s of writes on a hard kill (boot recovery handles
  the in-flight mission state, as designed in B211).
- The mirror stores data in the SAME Upstash Redis as memory — if Redis itself
  is flushed, mirror is gone too (it was never the failure mode here).
- The Pages guard only runs when the keepalive workflow runs (GitHub starves
  it sometimes); it's a safety net, not a guarantee.

## User actions (only you can do these)
1. **Rotate the GitHub PAT NOW** — it's full-scope (delete_repo included),
   never rotated, and now also lives in Actions secrets. A leak = total
   account control.
2. **Check github.com/settings/security-log** → filter "pages" → the
   `pages.disable` entry shows WHO disabled it (IP + time). If it wasn't you:
   rotate everything.
3. **Review github.com/settings/installations** — revoke `freebuff-web`
   (CodebuffAI) if you don't use it; it's the actor on every keepalive run
   and had repo workflow access.
