# FIXLOG-B114 — AUTO Mode: Normal + Agent combined, JEXI decides per query

**Phase:** B114 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why (user request)
"Combine Normal mode and Agent mode — let it decide which is using."

## What was built
**AUTO mode is now the default.** One mode where JEXI classifies every query and
routes it herself:
- conversational / simple / direct intents → **direct answer** (fast, no pipeline);
- anything needing tools, teams or the browser → **full agent pipeline**.

### Server (`index.js` + `Planner.js`)
- `Planner.DIRECT_INTENTS` + `isDirectIntent()` — the direct set: `conversation`,
  `direct_answer`, `translate`, `math_solve`, `creative_writing`. Everything else
  (`code_task`, `research`, `news_latest`, `study_topic`, `github`, `data`,
  `link_analysis`, `knowledge_recall`, `docs`, `perf`, `compound_task`, …) routes to
  the agent pipeline.
- `/api/chat`: mode defaults to **`auto`** when no header is sent. In auto mode, the
  query is classified via `planner.analyzeIntent`; if the intent is direct AND
  confidence ≥ 0.6 → the direct-answer path (same context/time/session-refs as
  normal). Otherwise it falls through to the full agent flow.
- Updates stream in both cases: "⚡ Auto mode — this is a conversation question,
  answering directly" or "🛰 Auto mode — routed to the agent pipeline (intent: …)".
- `normal` / `agent` remain as explicit overrides (Settings / pill).

### Frontend
- **Home pill is now 3-state: AUTO → AGENT → NORMAL** (default AUTO; label + tooltip
  explain "AUTO = JEXI decides").
- `useJexiEngine` defaults to auto and only sends an explicit `x-jexi-mode` for
  normal/agent; code mode stays on for auto (the agent pipeline may run).
- **Settings presets**: standard/ptc/creator now set AUTO (JEXI decides); minimal
  still forces NORMAL (direct answers only).

## Tests — `test-auto-mode.js` (27 checks)
- Direct-intent routing: 5 conversational intents → direct; 12 agent intents →
  pipeline.
- Server: default 'auto', autoDirect flag, isDirectIntent + confidence ≥ 0.6 gate,
  direct block runs for normal OR autoDirect.
- Frontend: engine + Home default 'auto', pill cycle AUTO→AGENT→NORMAL, presets map
  to auto (minimal → normal).

## Verification
- `npm test` full sweep (52 suites): **exit 0** · `eslint`: **0 errors**
- test-plan-mode / identity / llm-models / tools / api-surface all green
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
One mode, zero decisions: ask "who are you" or "what's 2+2" → instant direct answer;
ask "build me an app" or "research X" → the full team spins up automatically. The
pill shows AUTO by default; tap it to force AGENT or NORMAL anytime.
