# FIXLOG-B92.md — Normal Mode · Unified Attach · Tool-Fallback · UI Polish

Build 92 (Aug 17, 2026)

## 1. Fixed the "failure JSON" (All AI providers failed for tool calling)
When every tool-capable provider was rate-limited/cooldowned at once, the
SIMPLE chat path threw "All AI providers failed for tool calling" — an
honest but harsh failure for a plain question.
- `generateWithToolsLoop` now has a **plain-text fallback**: if the tool
  walk fails, it retries the same providers WITHOUT tools and returns
  `{ fallback: 'plain-text' }` — a direct answer instead of a failure.
  Callers (WorkerRouter, SimpleTask, AgentLoop) consume it transparently.
- Live-verified: "what is the capital of Kenya" → answered (Nairobi, conf 92).

## 2. Agent mode ↔ Normal mode (anyone can switch)
- **Agent mode** (default): full multi-agent team — planner, roster, tools,
  graph, verification (today's behavior).
- **Normal mode**: ChatGPT-style — ONE direct LLM call, no planner/roster/
  tools/graph; minimal events (log, plan, done). Fast and simple.
- Toggle: segmented **AGENT | NORMAL** control in the chat header AND a mode
  pill on Home. Persisted per device (localStorage `jexi_mode`); the engine
  sends `x-jexi-mode: normal` on chat requests.
- Goals also accept `mode` (normal goal = direct answer) so both modes are
  testable on the same pipeline.
- Normal mode still honors explicit agent commands (/build, /goal, /do,
  links, travel) — those always run the agent pipeline.

## 3. Frontend — professional arrangement (per screenshots)
- **Unified attach in the "+" area of the chat composer**: the quick-action
  row (and its bottom sheet) now has EYES · PHOTO · **FILE** · CHECK —
  the file option lives in the SAME place as the photo option.
  File = any file (PDF/code/text) → uploaded via /api/upload → attachment
  chip → sent with the message; PHOTO stays image-only for vision.
- **Removed the file button from the Home page** (the scattered paperclip +
  attachment chips are gone) — Home is a clean greeting + one input + the
  mode pill.

## Verification
- test-goal-engine 33/33 (new normal-mode goal tests) · test-goal-jobs 25/25
  · full 25-suite sweep green · lint 0 errors · esbuild checks on all
  changed JSX · live: normal-mode chat returns minimal events; agent-mode
  unchanged. CI will run the full build (sandbox lacks RAM for the final
  bundle; GitHub Actions has 7GB and builds fine).
