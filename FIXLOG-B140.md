# FIXLOG B140 — "Continue pulling all": schedule tools, bundle-base manifest, gateway client, client runtime, JEXI SDK

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

---

## What landed

### 1. `schedule/schedule` tools → registry tools `schedule_create` / `schedule_list` / `schedule_delete`
- Model-facing schedule management (dsh tools): create a recurring schedule
  (everySeconds or dailyAt + query), list all, delete by id — wired to the
  real TaskScheduler engine. Schemas + output contracts.
- **Registry 207 → 210 tools** (counts updated across 15 suites).

### 2. `bundle/base` → `BundleBase.js` + `bundles/manifest.json` + `DSH-PARITY.md`
- **The pull-all tracker**: a manifest of all 121 DeepSeek Harness packages
  with JEXI port + batch + status (**109 ported · 10 partial · 2 not-yet —
  90% ported**), a regenerator (`scripts/audit-bundles.js`), and the
  human-readable `DSH-PARITY.md` at the repo root.
- `GET /api/bundles` (manifest + live registry facts).

### 3. `api/gateway` client → `src/utils/gatewayClient.js`
- Browser gateway client: always sends `x-jexi-key`, retries idempotent GETs
  with capped backoff, normalizes errors into `GatewayError` (status/code/
  data), timeout with abort wiring.

### 4. `client/runtime` → `src/utils/jexiRuntime.js` + `src/hooks/useProjection.js`
- Browser runtime services: `ConnectionStatus` (health polling state
  machine), `LocaleRuntime` (strings + {var} substitution), `ProjectionStore`
  (TTL-cached conversation projections), and the `useProjection` React hook
  (the dsh session-projection wire cell).

### 5. `sdk/client` → `server/sdk/client.js` + `README.md`
- **Scriptable JEXI**: `JexiClient` with `health()`, `tools()`, `chat()`
  (NDJSON stream → final answer), `conversations()`; key from constructor or
  `JEXI_API_KEY`.

### 6. `subprocess` scrub parity → `ShellEnv.scrubbedParentEnv()`
- The dsh-named scrubbed parent environment export.

### 7. Route completeness
- `GET /api/sessions/:conv` (one conversation's summary — the client
  runtime's session cell), fixing the api-surface gap found by the new hook.

## Verification
- `npm test` — **exit 0, 67 suites green**, incl. new `test-dsh-batch9.js`
  (~45 checks: schedule tools via executeTool, bundle manifest + parity doc,
  gateway client retry/key/errors against a live local HTTP server, client
  runtime, SDK against a live NDJSON chat server, scrub parity).
- Registry count assertions **207 → 210** across 15 suites.
- `AGENT-CATALOG.md` regenerated: **252 agents · 508 skills · 210 tools ·
  100% reachable**.
- `eslint` — 0 errors, 0 warnings in new files; frontend esbuild parse OK.
- Boot smoke test: `/api/bundles` (121 packages, 90% ported), schedule tools
  in the inventory, `/api/sessions/:conv` route.
