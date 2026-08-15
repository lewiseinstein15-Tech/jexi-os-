# FIXLOG-B68 — Memory persistence: REDIS_URL is now a first-class, verified persistence backend

**Date:** 2026-08-15
**Standard:** every claim has real code + a real passing test (or live response) behind it.

---

## The report

User checked `https://jexi-os-brain.onrender.com/api/health/memory` and saw:

```json
{"persistentDisk":false,"previousBootsSeen":[],"sessionCount":0,"note":"no previous boot stamps found — disk persistence not yet proven (mount a persistent disk at DATA_DIR on Render, or set REDIS_URL for cross-restart memory)"}
```

with `REDIS_URL` already configured in the Render environment. The question: is the code ignoring Redis, or is the Redis connection failing?

## Diagnosis (code + live service, not guesses)

**Root cause — both halves of the question were partly true, and the code half was the real bug:**

1. **The deployed code never treated Redis as a persistence backend in the probe.** In the deployed (B67) `memoryPersistenceProbe()` the probe only stamped `DATA_DIR` on disk and returned the "no previous boot stamps found — mount a persistent disk… or set REDIS_URL" note as a fallback. There was **no Redis branch at all** — no ping, no stamping, no Redis-aware note. So even a perfectly healthy `REDIS_URL` could never make `persistentDisk`/`persistent` true or change that note. (`server/src/services/MemoryManager.js`, deployed B67, probe body.)
2. **`isRedisActive()` never proved a real connection.** B67 returned `redisEnabled && !!redisClient` — "a client object exists" — not "a real command succeeded". And the module tracked no connection state, so `/api/health`'s `redis:` flag and the probe had no truthful signal to report.
3. **A secondary trap: the local repo was 16 commits behind the deployed code.** The local checkout was at `b74c2f1` (B56); Render runs `f432a55` (B67). `/api/health/memory` does not exist in the local tree at B56 — which is why a repo-side search found nothing. The workspace was synced (`git merge --ff-only origin/main`) **before** any edit so B57–B67 work could not be clobbered.

So: **not** a Redis connection failure — the code path to use Redis as a persistence backend did not exist, and the health signal could not verify a connection even when it worked.

## What changed

### `server/src/services/MemoryManager.js`

- **`memoryPersistenceProbe()` is now async and stamps BOTH persistence layers**, with the exact same evidence model for each:
  - disk: `.jexi-boot-<instance>.json` files in `DATA_DIR` (unchanged).
  - Redis: a `jexi:bootstamps` JSON list of `{ instance, boot }` (30-day TTL, capped at 20) written on every probe when `REDIS_URL` is configured.
- New `persistent` field: `disk.persistent || redisPersistent` — true when **either** backend's stamps survived a restart.
- The response now carries a `redis: { configured, connected, error, previousBootsSeen }` block, and the `note` is truthful per state:
  - Redis stamps from a previous boot survived → **"Redis-backed persistence PROVEN: … memory survives redeploys without a persistent disk"**
  - disk stamps survived → disk-persistence note (unchanged)
  - connected but no prior stamps yet → "…will be proven after the next restart/redeploy"
  - configured but failed → **"REDIS_URL is configured but the Redis connection failed: <real error>"**
  - else → original fallback note (unchanged)
- Every Redis command in the probe is wrapped in a hard 5 s `withTimeout` so a dead/slow Redis can never hang the health endpoint.
- **`isRedisActive()` now means "configured AND a real command succeeded"** — `redisStatus` is tracked (`unset | connecting | connected | error`) and updated by the probe's ping/get/set, `hydrateFromRedis`, and `redisPush`.
- New `redisConnectionInfo()` → `{ configured, status, error }` for health reporting.
- `getRedis()` hardened: `connectTimeout: 8000`, bounded `retryStrategy` (fail fast instead of retrying forever), and an `'error'` listener that records the real failure instead of crashing the process with an uncaught exception.

### `server/index.js`

- `/api/health/memory` and `/api/memory/persistence` now `await` the async probe (previously they serialized a stale synchronous shape) and `/api/health/memory` sets `Cache-Control: no-store`.
- `/api/health` now includes `redisDetail: redisConnectionInfo()` next to the existing `redis:` flag.

## Proof

### Restart survival — Redis as the ONLY backend (two real processes, real ioredis)

`server/test-memory-persistence.js` spawns the real probe (`tests/memoryProbeChild.js`) as a **fresh process per boot**, each with its own fresh `DATA_DIR` (so disk cannot be what survives), against the clearly-labeled local RESP mock (`tests/respMockRedis.js`) — the same `ioredis` client MemoryManager uses in production, unmodified.

```
== B68 B — REDIS IS A FIRST-CLASS BACKEND: stamps survive across processes ==
  ✅ boot 1: REDIS_URL configured AND really connected (ping round-trip)
  ✅ boot 1: isRedisActive()=true after a real command succeeded
  ✅ boot 1: disk is NOT the backend (fresh DATA_DIR) — only Redis could persist
  ✅ boot 2 sees boot 1's Redis stamp → memory survives a RESTART/REDEPLOY
       — [{"instance":"redis-boot-1","boot":"2026-08-15T20:56:45.708Z"}]
  ✅ boot 2: persistent=true — Redis alone proved it
  ✅ note says Redis-backed persistence is PROVEN
```

### Error paths executed (not just coded)

```
== B68 C — BROKEN REDIS IS REPORTED AS BROKEN ==
  ✅ dead REDIS_URL → connected=false, error surfaced: "Reached the max retries per request limit (which is 2)…"
  ✅ auth failure → connected=false, error surfaced: "ERR WRONGPASS invalid username-password pair"
  ✅ unresponsive Redis → probe times out with a real error (no hang) — "Redis command timed out after 5000ms", returned in 5.1s
  ✅ in every failure: isRedisActive()=false, persistent=false, note names the failure
```

### Health truthfulness

```
== B68 D ==
  ✅ redisConnectionInfo() reports unset when no REDIS_URL
  ✅ isRedisActive()=false when Redis is not configured
```

### Full suite

```
$ cd server && npm test
EXIT=0 — all suites pass; B68 suite 33/33 (disk stamps 7, Redis cross-process 10
incl. whitespace normalization, broken-Redis paths 14 incl. malformed URL,
health truthfulness 2).
```

## Live finding after deploy — the configured REDIS_URL value is itself malformed

Once B68 deployed on Render, the new truthfulness surfaced the actual blocker the
user's report was pointing at:

```
/api/health →  redis: false, redisDetail: { configured: true, status: "error", error: "Invalid URL" }
```

`REDIS_URL` **is** set in the Render environment, but the value cannot be parsed as a
Redis connection string. Reproduced with the real ioredis client:

```
THROW "redis://:6379" → Invalid URL          (empty host)
THROW "  redis://host:6379" → Invalid URL    (leading whitespace)
OK   "redis://h:p@host:6379" / "rediss://default:abc@host:6379"
```

So the fix has two parts, both now in the code:

1. **Normalize:** leading/trailing whitespace around the URL is trimmed before use
   (test: `REDIS_URL` with leading spaces connects fine).
2. **Actionable failure:** an unparseable value now produces a clear message instead
   of a bare `Invalid URL` TypeError — e.g. `REDIS_URL does not start with redis://
   or rediss://…` or `REDIS_URL is missing its hostname — expected
   redis://<user>:<password>@<host>:<port>` — surfaced in `/api/health/memory`'s
   `redis.error`/`note` and `/api/health`'s `redisDetail.error` (test: malformed
   URL → `configured: true`, `connected: false`, actionable error, `isRedisActive()
   false`).

## Final live evidence (after the normalization deploy)

```
/api/health/memory → redis: { configured: true, connected: false,
  error: "REDIS_URL does not start with redis:// or rediss:// — current value starts
         with \"(the value is not a URL)\" …" }
```

The stored value is **not a URL at all** — it contains no `scheme:` at all (not
`https:`, not a quote-wrapped `redis://`). It looks like a bare hostname, a service
name, or a similar placeholder.

## What the user must do (the remaining live blocker)

The **code** is fixed, deployed, and proven; the **value** is the only blocker.
Replace the `REDIS_URL` env var in the Render dashboard with the full connection
string from the Redis provider:
- **Upstash:** Console → Database → **Connect** → **Redis** tab → connection string
  (e.g. `rediss://default:XXXX@…upstash.io:6379`) — *not* the REST tab URL.
- **Any other Redis:** `redis://<user>:<password>@<host>:<port>` (or `rediss://`
  for TLS).

No quotes, no spaces. After the redeploy the endpoint will show `connected: true`,
and after the following restart it proves persistence (`persistent: true`, note:
**"Redis-backed persistence PROVEN"**) — without any persistent disk.

### Live-vs-mock disclosure

No real Redis was touched: all Redis assertions run against the **clearly-labeled local mock RESP server**, but through the **real `ioredis` client and the real `MemoryManager` code** — the identical code that runs on Render. Nothing about the mock changes production behavior; the only production difference is the `REDIS_URL` value.

## What happens on Render after this deploys

- First deploy of B68: the probe performs a real ping + GET + SET against Redis → `/api/health/memory` will show `redis.connected: true` (or the actual failure reason under `redis.error`), and `/api/health` will show `redisDetail: { configured: true, status: "connected" }` and `redis: true`. Note will say stamps will be proven on the next restart.
- Second restart/redeploy: boot stamps from the first boot are found in Redis → `persistent: true` and **"Redis-backed persistence PROVEN"** — cross-restart memory without any persistent disk.
