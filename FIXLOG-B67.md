# FIXLOG-B67 — Native tool-calling adoption completed (finishes B66 3a PARTIAL)

**Date:** 2026-08-15
**Standard:** every claim has real code + a real passing test behind it.

B66 shipped the *capability* (`generateWithTools`) but the honest status board marked native tool-calling **PARTIAL**: the SIMPLE path never attached tool schemas, tool calls were returned **without being executed**, and `/api/agent` / subagents still ran the JSON-in-prose `extractToolCalls` loop. B67 closes that gap: every worker path now runs **real provider-native `tool_calls`** that are executed through the gated ToolRuntime and fed back to the model until it answers.

---

## What was wrong (proven)

In B66, `WorkerRouter.runWorker` called `generateWithTools` once and returned `toolCalls` **without executing them** — the model could declare a call but nothing ever ran it. And `AgentLoop.js` still instructed models to emit ```json {"tool": ...} blocks in prose and parsed them with `extractToolCalls` (fragile, provider-dependent).

## What changed (all real file edits)

### 1. `server/src/services/LLMClient.js` — real multi-round tool loop
- `parseToolCalls()` now **keeps the tool_call `id`** (required to echo results back as `tool_call_id`).
- New `generateWithToolsLoop(prompt, system, tools, opts)` — the loop:
  - round → model emits native `tool_calls` → `opts.executeToolCalls(calls)` executes them → assistant message + `{role:'tool'}` results appended → repeat until the model answers directly or `maxIterations` (default 6, bounded).
  - provider-walk preserved: a provider that fails mid-loop falls through to the next one (B66 3e degradation inside tool calling too); non-tool-capable providers (Gemini/HF) are skipped.
  - `opts.signal` cancellation honored between rounds; `opts.__mockCompletions` test seam (same pattern as AgentLoop's `__mockAnswer`) drives the loop deterministically with no keys.
  - `generateWithTools` is now a thin 1-round wrapper over the loop (contract unchanged).
- **Evidence:** `test-tools.js` — "native loop executed the tool call", "native loop ran 2 rounds then answered", "no tool execution when the model answers directly".

### 2. `server/src/services/ToolRuntime.js` — native schema builder
- New `buildNativeSchemas(defs)` converts tool defs (flat `TOOL_SCHEMAS` shape) into OpenAI function-calling schemas (`{type:'function', function:{name, description, parameters:{properties, required}}}`). Defs with no executable schema are dropped — no routing dead-ends offered to the model.
- **Evidence:** `test-tools.js` — schema shape, required args, number typing, defs-without-schema dropped.

### 3. `server/src/services/WorkerRouter.js` — coworker path now executes tools
- New `executeNativeToolCalls(calls, opts)` runs each call through **`executeTool`** (permission profile → risk guard → arg validation → real engine), returning OpenAI-shaped `{ tool_call_id, content }`. Blocked / approval-required / failed calls return their honest `ERROR: …` text — never a fake success.
- `runWorker` uses `generateWithToolsLoop` + that executor when `opts.tools` is passed; result now carries `toolCalls` + `iterations`.
- **Evidence:** `test-tools.js` — `executeNativeToolCalls` runs the keyless `memory-recall` engine for real, preserves `call_7`, and reports a blocked `code-run` honestly.

### 4. `server/src/services/SimpleTask.js` — SIMPLE path is now tool-capable
- The single coworker is offered **5 native tools** (memory-recall, memory-write, semantic-search, profile-read, knowledge-search) — all safe/write_local (autonomous under the default profile) and inside the `conversation`/`direct_answer` allowlist, which is enforced in code via `intent` passed through to `executeTool`.
- Statistics now record `toolCalls` + `iterations`; an `Orchestrator` log line reports when the coworker used native tools.

### 5. `server/src/services/AgentLoop.js` — JSON-in-prose loop deleted
- `extractToolCalls` **removed entirely** (export gone; grep: no remaining references outside this FIXLOG).
- `runAgentLoop` keeps its exact call signature and event stream (`agent.plan / agent.log / tool.start / tool.result / agent.done`) — `/api/agent` and `SubagentRuntime` unchanged callers — but the generation is now `generateWithToolsLoop` with the auto-selected **executable** tool subset, executed through `executeTool` (permission/risk/approval gates, `confirm` threaded). `__mockAnswer` seam preserved.
- Honest edge handling kept: a tool that needs approval pauses with finalized details; blocked calls are reported; the synthesis fallback only fires when tool evidence exists but no clean answer was produced.

## Test evidence

```
$ cd server && npm test
EXIT=0 — all 25 suites, 0 failed (connectors: 116/116; test-tools: 33/33 incl. the new
B67 native-loop tests; test-subagent-isolation: 24/24 — the __mockAnswer seam still drives
the isolated-subagent path through the rewritten AgentLoop).
```

## Honest status after B67

| B66 item | Status |
|---|---|
| 3a. Native tool-calling adoption | **DONE** — SIMPLE path + AgentLoop both run provider-native `tool_calls` executed through ToolRuntime; JSON-in-prose parsing removed |
| Everything else in B66 | unchanged (WhatsApp removed, Email primary + creator recognition, coworker routing, loop/graph split, per-session memory, formatting) |
