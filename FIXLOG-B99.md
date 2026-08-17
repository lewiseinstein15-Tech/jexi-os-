# FIXLOG-B99 — Code Mode / PTC (DeepSeek Harness `code` preset mirror)

**Phase:** B99 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
DeepSeek Harness ships a **PTC (code) preset**: instead of one tool call per action, the
model writes **one TypeScript program** against a generated SDK and `run_code` executes
it — a sequence that would be five round trips becomes one. The program body runs in a
worker thread; every `await tools.name(args)` is dispatched back through the SAME gated
registry; only what the program prints/returns enters the conversation. B99 ports this
exactly: `packages/core/tools/src/code-mode.ts` (run_code transport),
`packages/core/tools/src/ts-types.ts` (generated SDK), and
`packages/code-runtime/code-runtime-worker-thread` (worker execution).

## What was built

### `server/src/services/code-worker.js` (new — DSH worker mirror)
- Runs one program body in a **dedicated worker thread** (separate isolate). The only
  capabilities: the `tools` binding (every call posted to the host) and a captured
  `console` (5 leveled methods into a **byte-budgeted log buffer** — 64 KB, truncates
  with an `output-limit` signal, DSH `LogBuffer` mirror).
- `new AsyncFunction('tools','ToolCallError','console', "'use strict';\n" + code)` —
  top-level `await`/`return`, exactly DSH's `runWorkerMain`.
- **Strict JSON contract**: arguments and return values must be lossless JSON —
  functions/undefined/symbols/bigint are rejected loudly instead of silently dropped.
- Runaway programs (infinite loops) can't fire the worker's own timers → the host's
  backstop kills the isolate and reports a clean budget error.

### `server/src/services/CodeModeRuntime.js` (new — host mirror)
- `renderToolsSdk(defs)` — the **generated TypeScript SDK** (`tools:sdk`): usage
  instructions + `ToolArgsMap` / `ToolOutputMap` / `ToolName` / `ToolCallError` /
  `declare const tools` block, deterministic (sorted), declared from the SAME pruned
  tool set the loop offers — never the whole catalog.
- `buildRunCodeSchema()` — `run_code { code, description }` (both required, DSH shape).
- `runCodeProgram(...)` — worker lifecycle + protocol: `call` → dispatch → `reply`;
  `log`/`output-limit`/`done`; **concurrency contract** (DSH: read-only calls overlap
  under `Promise.all` — semaphore, default 5; mutating calls run alone in submission
  order via a serial queue); sub-call budget (40); wall-clock budget (120 s) + abort
  signal; honest `CODE_RUN_FAILED`-style errors.

### ToolRuntime — `run_code` engine (registry 185 → **186**)
- zod output contract (`kind:'code-run'` + logs/result/toolCalls/durationMs/truncated),
  longer outer timeout (240 s), `codeTools` threaded through `executeTool →
  executeToolInner → runEngine` (the loop's pruned set caps sub-dispatches; direct API
  calls fall back to a safe read-tier default — never the whole catalog).
- Sub-calls re-enter the **gated pipeline** (permissions, risk tiers, allowlists,
  approval) with the parent's intent; `run_code` cannot recurse into itself.

### Loops
- **AgentLoop** (`/api/agent`, subagents, graph steps) and **WorkerRouter.runWorker**
  (chat SIMPLE path): `opts.codeMode` appends the SDK section to the system prompt,
  adds the `run_code` schema, and caps its visible set to the pruned tools.
- **/api/chat + /api/agent**: `x-jexi-code-mode` header (default ON in agent mode; the
  app's Settings toggle sends `0` to turn off). Normal mode untouched.

### Frontend
- **Settings → System: CODE MODE (PTC) toggle** (persisted `jexi_code_mode`, default
  on) with a one-line explanation.
- `useJexiEngine` sends `x-jexi-code-mode: 1` on agent-mode chat requests.
- The engine streams `🧮 Code Mode · <description> — N tool call(s) in Xms · ok/failed`
  log lines into the existing chat stream — no new UI needed to see it work.

### Tests & fixes
- **`test-code-mode.js` — 27 checks**: SDK determinism + declarations, program
  execution (logs/JSON result), ToolCallError try/catch with toolName, honest failures
  (program exception, non-JSON args/returns), runaway budget kill, parallel read
  calls, run_code through the gated runtime with contract + recursion guard.
- **27/27 green; full sweep exit 0; lint 0 errors.**
- Debugging caught a real protocol bug during development: the worker's call message
  was missing `type:'call'`, so the host never dispatched replies — fixed + covered by
  the suite.

## Verification
- `npm test` full sweep (41 suites): **exit 0**
- `eslint`: **0 errors** · `audit-roster`: 251 agents · 507 skills · **186 tools** ·
  100% reachable · AGENT-CATALOG.md regenerated
- Live debug runs: `run_code` program composing `todo` + `skill-search` through the
  gate returned `{todos, skills}` with 2 sub-calls in 63 ms.

## How the user sees it
With Code Mode on, JEXI can collapse multi-step work into a single program it writes
itself — e.g. "load the meeting notes skill, search past sessions, and summarize" runs
as one `run_code` call instead of three separate tool calls. Toggle it off anytime in
Settings.
