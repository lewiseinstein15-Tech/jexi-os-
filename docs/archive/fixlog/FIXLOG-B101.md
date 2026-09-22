# FIXLOG-B101 — Tool Output Contracts for ALL 187 Tools + Per-Tool timeouts (DeepSeek Harness `output contract` + `timeout-policy` mirror)

**Phase:** B101 (final DSH-map item) · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green

## Why
DeepSeek Harness enforces two things on EVERY tool:
- a **mandatory output contract** (the registry rejects a tool without one) — the
  model-facing schema is allowlisted and the engine's output is validated against it,
  so a malformed result can never silently reach the model;
- an optional **`timeoutMs`** on the definition, enforced by a cooperative
  `timeout-policy` wrapper: the deadline aborts the call's signal, the tool reaches
  quiescence, and the model sees a structured `TOOL_TIMEOUT` error.

B101 closes the map: JEXI's 187 tools are now ALL contract-checked and carry
per-tool budgets with structured timeout results.

## What was built

### Output contracts for every tool (dsh mandatory output mirror)
- **Specific contracts** for all 27 structured engines, as a **union of the canonical
  SUCCESS shape (required fields) and the honest-FAILURE shape** (`{ok:false, error}`) —
  exactly dsh's output contract + `isError` channel: search family (6), deep-read,
  pdf-extract, trusted-library, book-fetch, news-feed, memory-recall/semantic-search,
  memory-write/knowledge-save/episode-save, knowledge-search, profile-read, code-run,
  code-write, summarize-doc, video-analyze, video-transcript, data-crunch/stats-compute,
  plus the B96–B100 contracts (session/skill/run_code/spill/weather) and
  self-diagnose/mcp-call/connector-call.
- **Generic baseline contract** for every remaining tool: engines must return a string
  or a plain object (arrays/numbers/booleans/undefined fail closed). `null` remains the
  legal ROUTING contract (registry-only tools route to their agents — fixed an ordering
  bug where null would have been rejected as malformed).
- **`hasOutputContract(slug)`** export + audit coverage in tests: all 187 tools checked.

### Per-tool timeouts (dsh timeout-policy mirror)
- **`timeoutMs` declared on the definition** for 29 long-running tools
  (web-search 45s, deep-read 90s, pdf-extract 60s, video-analyze/transcript 120s,
  code-run 120s, run_in_sandbox 180s, subagent 120s, run_code 240s, …); plugin tools
  may declare their own (`timeoutMs` on the plugin tool def, validated positive).
- **Tier-based defaults** for the rest: read 45s, write_local 60s, exec/risky 120s
  (replacing the flat 60s).
- **Cooperative cancellation**: each call gets an AbortController; the per-tool
  deadline AND the caller's signal abort it, and the controller's signal is threaded
  into the engine (run_code workers terminate, future engines can check it).
- **Structured `TOOL_TIMEOUT` result**: `{ ok:false, code:'TOOL_TIMEOUT', error:'tool
  call timed out after Nms', durationMs }` — dsh's exact error contract, emitted to
  the event log too.

### Tests & fixes
- **`test-tool-contracts.js` — 41 checks**: all-187 coverage, canonical shapes pass,
  failure shapes tolerated, garbage rejected (42, arrays), routing null legal,
  structured TOOL_TIMEOUT fires at the deadline (252ms for a 250ms budget), fast tools
  unaffected, registry budgets positive, run_code 240s declared, aborted signal kills
  a runaway program in 12ms, routed tools survive the gate.
- **41/41 green; full 43-suite sweep exit 0; lint 0 errors.**
- Development caught a shadowing bug (older loose contracts overrode the new ones) and
  over-optionalized contracts that would have let incomplete shapes pass — fixed with
  the union design and re-verified against `test-audit-b47`'s fail-closed invariant.

## Verification
- `npm test` full sweep: **exit 0** · `eslint`: **0 errors**
- audit-roster: 251 agents · 507 skills · **187 tools** · 100% reachable (unchanged)
- This phase is server-only (no frontend/APK change).

## How the user sees it
Invisible but load-bearing: every tool JEXI calls now has a declared output shape and
a budget. A stuck tool returns "tool call timed out after 45s" instead of hanging the
whole mission, and a malformed engine result can never silently reach the model.
