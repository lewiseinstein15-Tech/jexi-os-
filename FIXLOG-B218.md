# FIXLOG B218 — boot resilience: one slow Redis moment must not cost a boot its durable layer

**Date:** 2026-09-04 (late) · **Trigger:** real production incident observed live during B217 verification

## The incident (18:19 UTC, this evening)

During the UptimeRobot experiment's rapid double-boot, one boot logged:

```
[Memory] Redis hydrate failed, using local file: Command timed out
```

and came up with `redis: false`. Root cause chain (audited in MemoryManager.js):

1. `hydrateFromRedis()` had ONE attempt; a single ~3s command timeout hit the catch block
2. the catch block set `redisEnabled = false` — **permanently, for the whole process lifetime**
3. side effects: memory stopped persisting to Redis, the B217 mirror silently no-opped
   (its `getRedis()` returned null), health reported `redis:false` — until a manual restart
4. Upstash itself was healthy ~2 minutes later (external PING → PONG, all data intact)

Secondary bug found during audit: **mission boot recovery raced the mirror hydrate.**
`app.listen()` fired `missionRunner.resumeOnBoot()` immediately while the mirror
hydration ran fire-and-forget in the background — on a fresh disk + Redis blip, the
mission files would land AFTER recovery had already scanned an empty disk, so
mid-flight missions would sit unresumed.

## Fixes

### 1. `hydrateFromRedis()` — retry with backoff + fresh client (MemoryManager.js)
- 3 attempts (initial + retries after 10s + 45s; overridable via
  `JEXI_HYDRATE_RETRY_DELAYS_MS` for tests) — worst case ~55s for a genuinely dead
  Redis, vs one 3s timeout before
- each retry builds a FRESH ioredis client (the old one may be wedged mid-command)
- B158 semantics preserved: after ALL attempts fail, the layer still disables
  (health stays honest — never reports active when off)
- reachable-but-empty Redis settles immediately (no pointless retries)
- new `closeRedis()` export — clean client shutdown for tests + graceful SIGTERM

### 2. Mission recovery waits for the mirror (index.js)
- `hydrateMirrorWithRetries()` replaces the fire-and-forget boot call
- `app.listen()` callback now chains `mirrorHydrateSettled.finally(() => resumeOnBoot())`
- listening is NEVER blocked (Render health checks stay happy); only the resume is
  delayed (≤ ~55s worst case on a dead Redis; <1s normally)

### 3. Mirror hydrate settling + tick self-heal (RedisMirror.js)
- `hydrateMirroredDirs()` now records `hydrateSettled` (true only when a full SCAN
  ran with a live client and no new errors — client-unavailable ≠ settled)
- new `hydrateMirrorWithRetries()` — same backoff contract as the memory hydrate
- `startMirrorLoop`'s 30s tick retries the hydrate while unsettled: if the outage
  outlives the boot retries but the layer is still enabled, a later tick still
  restores the fresh disk (self-heal, no restart needed)
- `mirrorStatus()` exposes `hydrateSettled` (observable in `/api/mirror/status`)

### 4. B68 probe compatibility (test-memory-persistence.js)
`runBoot` children are diagnostics, not boots — they now pass
`JEXI_HYDRATE_RETRY_DELAYS_MS: '0'` so broken-Redis scenarios stay fast (the suite
asserts probes return in <15s). Suite re-verified: 37/37.

## Tests (`test-b218.js`, `test-b218b.js` — both in the npm chain)

- **THE INCIDENT replayed**: a REAL minimal RESP server over TCP (proper command-queue
  parser — commands can arrive coalesced; a naive line-splitter drops pipelined
  commands and stalls ioredis, found the hard way) fails the first GET with a Redis
  error + connection drop, then serves normally → hydrate must SUCCEED on retry,
  memory.json written, layer `ready`, ≥2 connections (fresh client proven)
- dead Redis (instant-refused port): all attempts honored (backoff timing asserted),
  layer honestly `off` — B158 preserved
- mirror: null→null→working client = settled + files restored; never-returns client =
  unsettled, no files, no crash; boot-exhausted + later tick = disk restored (self-heal)
- disk-wins rule still holds after all of it (B217 contract intact)
- regression: test-b217.js 6/6, test-memory-persistence.js 37/37

## Verification
- Full `npm test` chain (incl. both new files): **PASS, 0 failures** before push.
- Post-deploy prod check: boot log shows hydrate success (or retries if Upstash
  blips), `/api/mirror/status` reports `hydrateSettled: true`.

## Honest limits
- Boot retries cover a ~55s outage window; a LONGER outage at boot still disables
  the layer for that process (B158 honesty > silent zombie) — recovery = next restart
- Mid-run Redis outages (after a successful boot) are unchanged: ioredis
  auto-reconnects; writes log errors and retry on the next save — the layer never
  disables mid-run (that was already true before B218)
- The mirror tick self-heal only operates while the memory layer is still enabled
  (a boot that exhausted retries has the layer off; hydrate no-ops then by design)
