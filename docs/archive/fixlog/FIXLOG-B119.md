# FIXLOG-B119 — Full Lifecycle Parity (question → response, exactly like DeepSeek Harness)

**Phase:** B119 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## What DSH does (traced from their source)
`packages/core/agent-loop/src/agent.ts` drives every request as a typed session lifecycle:
`turn/start → step/start → user/message → assistant/chunk → tool/call → tool/result →
assistant/message → step/end → turn/end {reason}`, with each step's prompt assembled from
ORDERED sections (`packages/core/system-prompt`: persona, agent-instructions,
time-context, session-reference, skill catalog, todo, plan, goal, tool guidance,
preferences, policy) and tool/call + tool/result events carrying `{callId, name,
arguments}` / `{ok, durationMs}`.

## What JEXI had before
- Events streamed on the wire (B96) but the durable conversation log only stored
  `user/jexi` chat lines + EventLog tool events — the full lifecycle wasn't replayable.
- Prompts were concatenated ad-hoc at three call sites with no canonical section order.

## What was built

### `server/src/services/SessionLifecycle.js` (new — dsh session-event vocabulary)
`lifecycleTurnStart/StepStart/ToolCall/ToolResult/StepEnd/TurnEnd/UserMessage/
AssistantMessage` append typed events to the conversation's append-only log
(kind = `turn/start` … `turn/end`, meta carrying the DSH fields: turn, step, callId,
name, arguments, ok, durationMs, reason). `isLifecycleEvent()` marks them; title,
search and message counts ignore them (counts = kind 'chat' only).

### `server/src/services/PromptAssembly.js` (new — dsh systemPrompt.assemble mirror)
Ordered sections exactly like DSH: persona/core (−100) · time context (−80) ·
session references (−70) · skill catalog (−60) · **live state (todo / plan / goal)
(−50)** · code-mode SDK (−40) · preset flavor (−30) · preferences (−20) · plan-mode
policy (−10). `todoStateBlock()` / `planStateBlock()` / `goalStateBlock()` render the
current todo list, active plan with per-step status, and active goals into every
prompt (DSH tool-todo/plan/goal behavior). Individually selectable so callers never
duplicate content they already inject.

### Wiring
- **AgentLoop** (the DSH-equivalent loop): assembles its system prompt via
  `assemblePrompt` and writes the full lifecycle to the session log (turn/start →
  step/start → tool/call → tool/result → step/end → turn/end{reason}).
- **SimpleTask** (chat SIMPLE path): assembles via `assemblePrompt` (session refs +
  state skipped — its own conversation context already provides them).
- **index.js**: wires the real GoalEngine into assembly (`setGoalEngine`); the chat
  route appends the `user/message` lifecycle event.
- **SessionTrace + ConversationsScreen TRACE**: the lifecycle events now surface in
  the trace (🔁 turn start/end · ▸/▪ steps · 🔧 tool calls with args · ✅/❌ results
  with ms · 💬/🤖 messages) — the UI can replay the exact question → response flow.

## Tests — `test-lifecycle.js` (35 checks)
- DSH event ORDER in the log (turn/start → user/message → step/start → tool/call →
  tool/result → step/end → assistant/message → turn/end).
- tool/call + tool/result carry callId/name/ok/durationMs; turn/end carries reason.
- Lifecycle events excluded from message counts/titles.
- Assembly: all sections present in order, no duplication, selectable toggles,
  todo/plan/goal state rendering (with engine-injection seam).

## Verification
- `npm test` full sweep (54 suites): **exit 0** · `eslint`: **0 errors**
- sessions-b96 / compaction / code-mode / workflow / plan-mode / tools / identity /
  api-surface (85 endpoints) all green.
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
Every exchange is now a fully replayable DSH-style lifecycle: open any conversation's
TRACE and you see the exact turn boundaries, every step, every tool call with its
arguments and real outcome/latency, and the final message — plus JEXI's prompts now
always carry the current todo list, active plan and goals, so she remembers her own
work-in-progress exactly like DSH.
