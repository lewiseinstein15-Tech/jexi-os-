# FIXLOG B142 — "Pull all": bash-sandbox, cordis inspect tools, agent-loop-testkit, SDK codec, e2b facts

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

**Parity tracker: 118 ported · 5 partial · 0 not-yet (96%) — every DSH package is now at least partially in JEXI.**

---

## What landed

### 1. `shell/bash-sandbox` → `SandboxLocal.sandboxPolicyFor()` + bash sandbox facts
- Per-call sandbox policy resolution (mode + enforcement + workspace root)
  with denial facts when the mode gates the tier (read-only exec → blocked
  with reason). The coding plugin's persistent bash now attaches
  `sandbox: { mode, enforcement, denied? }` to EVERY result (dsh
  SandboxBashExecutor `result.sandbox` parity).

### 2. `extensions/tool-cordis` → `CordisInspect.js` + registry tools `cordis_inspect_list` / `cordis_inspect_query`
- Model-facing read-only runtime introspection: 5 inspect providers
  (jexi:plugins, jexi:tools, jexi:skills, jexi:services, jexi:inventory)
  with declared methods; queries are validated (unknown provider/method →
  honest error) and can never invoke business services or modify runtime.
- **Registry 211 → 213 tools.** Schemas + output contracts.
- `GET /api/cordis/inspect`, `GET /api/cordis/inspect/providers`,
  `POST /api/cordis/inspect/query`.

### 3. `test-support/agent-loop-testkit` → `server/test-support/agent-loop-testkit.js`
- One-call mount of the test dependencies (plugin seam + replay provider) for
  deterministic offline AgentLoop tests.

### 4. `sdk/codec` → `server/sdk/codec.js`
- Wire codec: JSON-safe encode (rejects BigInt/circular), schema-validated
  decode (required/unknown/type codes), tagged-value codec
  (`{ t, v }` with strict shape).

### 5. `e2b/e2b` → `SandboxLocal.e2bStatus()`
- Sandbox-as-a-service facts: mode, remote config (`E2B_URL`), enforcement,
  wrappers, temp root. `GET /api/e2b`.

### 6. `ui-settings-plugin-inventory` → `src/hooks/usePluginInventory.js`
- React hook with TTL cache over `/api/plugins/inventory`.

## Verification
- `npm test` — **exit 0, 67 suites green**, incl. new `test-dsh-batch11.js`
  (~45 checks: sandbox policy facts incl. denial, cordis providers + query
  validation + tool execution, testkit mount, codec encode/decode/tagged,
  e2b facts, hook file).
- Registry count assertions **211 → 213** across 16 suites.
- `AGENT-CATALOG.md`: **252 agents · 508 skills · 213 tools · 100% reachable**.
- `DSH-PARITY.md` regenerated: **118 ported · 5 partial · 0 not-yet (96%)**.
- `eslint` — 0 errors, 0 warnings in new files; frontend esbuild parse OK.
- Boot smoke: cordis providers + live query (226 tools incl. plugins), e2b
  facts, bundles counts (0 not-yet).
