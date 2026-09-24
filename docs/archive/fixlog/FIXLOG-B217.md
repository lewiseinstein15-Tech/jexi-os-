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
- Full `npm test` chain: PASS before push (commit 74dabcd).
- **PROD END-TO-END PROOF (2026-09-04 ~16:33 UTC):**
  1. deploy live → `/api/mirror/status` = `{active:true, lastSyncAt set}` (loop running);
  2. created mission `ms-mtn69b1z-001` → 30s later mirror shows `keys:3` (mission+graph+events in Redis);
  3. **service restarted via Render API → brand-new instance (`…-d76cd46b-52z8q`)**;
  4. new boot: `lastHydrateFiles:3` and `GET /api/missions` still lists `ms-mtn69b1z-001` (PLANNING, boot recovery resumed it).
  → The exact incident scenario (container replacement) replayed on production: **zero mission loss.** Before B217 this was a wipe.
- Keepalive guard exercised live: dispatched run 33895232884 → "App site: HTTP 200" → no heal needed (correct pass-through behavior).
- Self-ping: enabled via Render env (`JEXI_SELF_PING=1`, all 22 existing vars preserved); uptime verification below.

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

---

## ADDENDUM (same day, evening) — aftermath, verification, and closure

### Both incidents: CLOSED
- **Pages root cause FOUND (it was us, not an attacker):** the user flipped the
  repo to private for a few minutes (~16:02–16:09 UTC). GitHub Free cannot
  serve Pages from private repos, so the site was killed instantly — and
  flipping back to public does NOT auto-re-enable Pages (that's why it stayed
  a 404 until the API re-enable). The Security Log correctly showed the user
  as actor. Lesson recorded: going private on Free = site down until re-enabled.
- **"Mystery repos" explained:** `repo.create` entries with the user as actor
  are JEXI infrastructure (jexi-workspace, jexi-os-test-, .github.io site,
  cinejexi) created via the API with the user's token. Full repo audit found
  nothing attacker-shaped.

### Security actions completed by the user (2026-09-04 evening)
- Old full-scope PAT **revoked (verified 401)**; new PAT stored in
  `GH_PAGES_GUARD_TOKEN` (updated 17:29:30Z) + git remote; guard permissions
  re-verified live: Pages write probe 409-as-expected, workflow rerun 201,
  keepalive rerun completed success. NOTE: user chose to keep the new token
  full-scope intentionally ("I will not notice some things you will") — swap
  to a minimal repo+workflow token planned for next week.
- CodebuffAI (`freebuff-web`) **revoked** (plus other app authorizations).
  Keepalive scheduled runs now attribute to `lewiseinstein15-Tech`
  (verified via triggering_actor on the 17:02 run) — revocation broke nothing.
- **UptimeRobot monitor live** — see verification below.
- Render workspace ownerId (for the logs API): `tea-d9r5odf10e5c73anqs50`.

### UptimeRobot verification (controlled experiment, 17:59–18:17 UTC)
Render free tier doesn't expose request logs (only `type=app`), so UptimeRobot
pings can't be read from logs. Instead: JEXI_SELF_PING was set to 0 (env value
changes do NOT auto-trigger a deploy — an env-var ADD does; a value change
needs a manual deploy trigger), a fresh instance booted 17:59:52, then 17.5
minutes of total silence from us. Result: **uptime 1104s (18.4 min), no cold
start** — she crossed the 15-min hibernation threshold with self-ping OFF.
Contamination ruled out: no keepalive cron run fired in the window (last was
17:02). ⇒ the only possible keep-awake source was the external monitor.
**UptimeRobot: PROVEN working.** Self-ping restored after (boot-log marker
verified via Render logs API).

### Transient incident during the test (honest record)
The rapid double-boot (18:17/18:19) hit an Upstash latency spike: one boot
logged `[Memory] Redis hydrate failed, using local file: Command timed out`
and ran with `redis:false` until a clean restart. Upstash itself was healthy
(external PING → PONG in ~1.3s; mirror keys intact). The clean restart
recovered everything: memory hydrate ✓, 56 goal jobs ✓, mirror hydrated the
3 mission files onto the fresh disk ✓. **Known residual weakness:** the boot
memory hydrate has no retry — if Upstash is slow at boot, she falls back to
the local file for that process lifetime. Future hardening candidate (add
hydrate retry with backoff); not fixed in this build.

### Final state (2026-09-04 ~18:25 UTC)
- keep-warm: self-ping ON (primary) + UptimeRobot 5-min external (proven) +
  starved GitHub cron (best-effort backup)
- persistence: Redis mirror active (missions/world/conversations, 45d TTL)
- Pages: 200, self-heal guard armed with the rotated token
- brain: healthy, memory + goals hydrated, mission restored across 3
  container replacements today with zero data loss
