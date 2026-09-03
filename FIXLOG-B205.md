# B205 — Arena-Style Streaming Rebuild (Unified Thinking Panel)

**Date:** 2026-09-03 · **Ask:** "The streaming — rebuild it as the arena agent,
like you described."

## What the Arena agent's streaming looks like

One collapsible "thinking" block per reply that carries the whole live story
while the agent works, then collapses to a one-line summary when the answer
lands:

```
┌─────────────────────────────────────────────┐
│ ✻ Thinking · 12.3s                        ▾ │  live: open, pulsing
│                                             │
│ ● I'm on it — let me break this down.       │  narrations — her voice
│ ● I found 30 sources across 6 engines.      │
│                                             │
│ Query Analyzer   Analyzing the best way…    │  activity — compact rows
│ Searcher         scan done — 20 sources     │
│ Extractor        ✓ Read Wikipedia           │
│                                             │
│ (raw reasoning tokens, dimmed, if any)      │
└─────────────────────────────────────────────┘
(the answer streams below, token by token)

done → ✻ Thought for 43s · 8 agents · 10 sources · 21 steps   ▸  (tap to reopen)
```

## What was there before

Three scattered components fighting for the same space: ThinkRow (B173
reasoning row), NarrationFeed (B200 commentary), and the chat-inline
ActionFeed + AgentPipeline (global log feed). Plus a real bug: the
done-handler built a fresh final message that **dropped narrations
entirely** — the "HOW I WORKED" collapsed view could never render after
completion.

## The rebuild

- **`AgentThinking.jsx`** — the unified panel: narrations (first-person,
  italic, amber dots) + compact agent/tool rows (deduped, ellipsized) +
  dimmed mono reasoning tokens. Live: open, auto-scrolling, ticking timer.
  Done: auto-collapses to `Thought for 43s` + chips (`8 agents · 10 sources
  · 21 steps`), one tap to review the whole trace. Messages with no trace
  (direct answers) render no panel at all.
- **`useJexiEngine.js`** — log events now attach to the streaming message
  (`activity`), website events bump a per-message `sourceCount`, every
  creation path stamps `t0`, and the done-handler preserves the ENTIRE trace
  (narrations, activity, sourceCount, by, totalMs) — the dropped-narrations
  bug is fixed.
- **`src/utils/agentStream.js`** — pure helpers (dedupe, agent/step counts,
  duration formatting, chips, hasTrace) with no React imports so the server
  suite unit-tests them directly.
- **ChatWindow** — ThinkRow/NarrationFeed/ActionFeed/AgentPipeline replaced
  by the single panel (ResearchScreen keeps its own pipeline view).
- **CSS** — `.jx-agent-*` block in the app's design language (breathe
  animation while live, chips when done).

## Result

- `test-b205.js`: **31/31** (helpers + wiring contracts + no-empty-panel
  guard); B173 thinking contracts updated to the new panel
- Full `npm test`: **SUITE_EXIT=0** (B197→B205 all green)
- `vite build`: clean (4338 modules)
- Live check: a research run streams 7+ distinct agent rows into the panel
  data; repeat questions correctly skip the panel (memory fast path)

## Where to see it

- Dev: the local UI (port 3000)
- Production: auto-deploys with CI (frontend → GitHub Pages, backend →
  Render — no backend changes needed; the panel consumes events that
  already existed)
