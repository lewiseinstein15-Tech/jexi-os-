# FIXLOG-B104 — Time Context + Spill Retention (DeepSeek Harness `time-context` + `output-retention` mirror)

**Phase:** B104 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
DeepSeek Harness injects a **request clock** into every step (`time-context`): the model
always knows the current date/time, so "today", "this week", deadlines and date math are
never guesses — a classic source of "completely confused" answers. It also bounds
storage growth (`output-retention`). B104 ports both.

## What was built

### `server/src/services/TimeContext.js` (new — dsh time-context mirror)
- `timeContextBlock()` — one compact line: `[Current date and time: <local, full
  weekday+date+time> (<zone>). Server clock: <ISO>…]`.
- `setRequestTimeZone(tz)` — the user's real timezone from the `x-jexi-tz` header
  (validated by actually formatting in that zone; unknown/empty → safe UTC fallback).
- `appendTimeContext(system)` — idempotent append (never duplicates the block).

### Injection — one place, covers EVERYTHING
- `LLMClient.generateContent` **and** `generateWithToolsLoop` now append the time block
  to every system prompt — agent loop, orchestrator graph nodes, coworkers, subagents,
  goals, normal mode, news/research agents: every LLM call in the system knows the date.

### `server/src/services/SpillStore.js` — retention (dsh output-retention analog)
- `runRetention({ maxAgeMs: 7d, maxBytesPerOwner: 25MB, maxFilesPerOwner: 60 })` —
  ages out expired spills, then trims per-owner byte and file-count budgets (newest
  kept, oldest deleted); returns deletion stats.
- Runs at boot + hourly (unref'd interval) in index.js.

### Frontend
- `jexiFetch` sends `x-jexi-tz` (the device's real `Intl` timezone) on every request —
  so the server always knows the user's local time, on web AND the Android APK.

### Tests & fixes
- **`test-time-context.js` — 22 checks**: block contains the real current date (verified
  against today's ISO date), zone switching (Africa/Nairobi / America/New_York / invalid
  / empty), idempotent append, LLMClient injection in both entry points, retention
  (age-out with backdated files, byte budget, file-count budget, empty-store no-op).
- **22/22 green; full 45-suite sweep exit 0; lint 0 errors.**

## Verification
- `npm test` full sweep: **exit 0** · `eslint`: **0 errors**
- test-llm-models + test-compaction re-verified green (LLMClient/SpillStore touched)
- APK rebuilt (frontend helper changed) → release tag bumped.

## How the user sees it
JEXI now knows what day it is — in your timezone — on every single answer, in every
mode. "What's today?", "when is my deadline relative to now", "this week" all resolve
correctly. And spilled files can't pile up forever: they age out after 7 days with
per-session budgets.
