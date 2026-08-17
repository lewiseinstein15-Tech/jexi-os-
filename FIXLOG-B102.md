# FIXLOG-B102 — Agent Presets (Standard/PTC/Minimal/Creator) + Session Trace (DeepSeek Harness `agent-presets` + web session explorer mirror)

**Phase:** B102 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
DeepSeek Harness ships its agents as **presets** — Standard (native tools), PTC (Code
Mode), Minimal (direct answers), Creator (creative) — and its web UI exposes the
**session as a trace**: every tool call, result, error and compaction, replayable.
B102 ports both: JEXI now has the four presets with a one-tap selector, and every
conversation gets a TRACE view built from the durable event log.

## What was built

### `server/src/services/PresetManager.js` (new — dsh agent-presets mirror)
- Four presets with exact mappings:
  - **standard** → agent mode, code mode OFF (native tool calling only)
  - **ptc** (default) → agent mode, code mode ON (run_code + generated SDK)
  - **minimal** → normal mode (direct answers, no planner/tools)
  - **creator** → agent mode, code mode ON + a creative-expressiveness flavor line
- `resolvePreset` / `presetFromHeader` / `presetFlavor` — safe: unknown/empty falls
  back to the default (ptc); explicit `x-jexi-mode` / `x-jexi-code-mode` headers
  always override the preset.

### `server/src/services/SessionTrace.js` (new — dsh web session explorer mirror)
- `buildTrace(convId)` assembles the replayable view: durable EventLog events for the
  session (user_message, tool_call/tool_result with real outcomes + durations,
  coworker_call/result, orchestrator_decision, error, context_compaction) + the
  conversation's compaction checkpoints, per-type counts, summary, last activity.
- `traceEventLabel` / `isTraceCompaction` helpers for the UI.
- **CompactionEngine now appends a `context_compaction` event** to the durable log on
  every successful checkpoint (the reserved event type was already in the catalog).

### Wiring
- **/api/chat + /api/agent**: `x-jexi-preset` header resolves the preset; its mode /
  code-mode / flavor drive the run (flavor injected into SimpleTask coworker prompts
  and the AgentLoop system prompt).
- **Frontend**:
  - Settings → **AGENT PRESET** selector (4 cards; persists `jexi_preset` and also
    sets the mode + code-mode defaults behind the scenes).
  - `useJexiEngine` sends `x-jexi-preset` on every chat request.
  - ConversationsScreen → **TRACE button** per conversation: color-coded event stream
    (🔧 tool calls, ✅/❌ results with durations, 🧑💻 coworker calls, 📦 compactions,
    ⚠ errors, 💬 messages) + compaction count.

### Tests & fixes
- **`test-presets.js` — 27 checks**: preset mappings, safe fallback, header parsing,
  flavor lines; buildTrace with seeded events + a real injected-summarizer compaction
  (tool outcomes, counts, namespacing, labels). **27/27 green.**
- Full 44-suite sweep exit 0; lint 0 errors; esbuild compiles the three touched
  frontend files.

## Verification
- `npm test` full sweep: **exit 0** · `eslint`: **0 errors**
- audit-roster unchanged (251 agents · 507 skills · 187 tools · 100% reachable)
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
Settings → AGENT PRESET: pick Standard (classic tool-calling), PTC (program mode,
default), Minimal (just answers) or Creator (program mode + flair) — JEXI's whole
behavior changes with one tap. And in Conversations, hit **TRACE** on any past
conversation to replay exactly what JEXI did: every tool call, its real outcome and
latency, coworker work, errors and compactions — the DSH web session explorer, in the
app.
