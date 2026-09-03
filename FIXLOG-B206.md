# B206 — Thinking-Panel Hardening ("thinking must never break the UI")

**Date:** 2026-09-03 · **Ask:** "Make sure when it is thinking it will not
break the UI."

## The failure modes guarded

The B205 panel renders LIVE, UNTRUSTED server data mid-stream. Five ways that
could break the chat:

1. **Non-string payloads** — a log event whose `message` arrives as an
   object/number/null would throw `Objects are not valid as a React child`
   mid-render. The app-wide ErrorBoundary would catch it — but by replacing
   the WHOLE screen with the recovery card. The chat dies with the panel.
2. **Control characters / ANSI escapes** in log or reasoning text — junk
   rendering, invisible layout breakers.
3. **Marathon tasks** — a long autonomous run can emit hundreds of activity
   rows; rendering them all re-rendered 10×/s (the timer tick) is a DOM +
   CPU bomb.
4. **Giant reasoning blobs** — providers with reasoning channels can emit
   very long think texts; the panel held all of it.
5. **A render crash anyway** — some path nobody foresaw.

## The hardening (defense in depth)

**Ingestion (`useJexiEngine.js`)** — log entries are sanitized the moment
they arrive: `sanitizeText()` coerces anything to a safe string, strips
ANSI/C0 controls, caps length; agent names capped at 40 chars; the stored
activity array is capped at the last 400 entries so state can't grow
unbounded on marathon tasks.

**Helpers (`agentStream.js`)** — `sanitizeText`, `safeRows` (coerce + drop
invalid rows), `capTail` (render the newest N + "+K earlier" marker),
`capText` (keep the reasoning tail).

**Render (`AgentThinking.jsx`)** —
- All prop processing runs inside one `useMemo` (keyed on the data), so the
  10Hz timer tick only re-renders header text, never re-processes big arrays
- Narrations capped at the last 30, activity rows at the last 40, reasoning
  at 6KB — each with a `+N earlier steps/notes` marker (`.jx-agent-more`)
- `by` / `sourceCount` / array props defensively coerced
- **Local crash boundary (`PanelBoundary`)**: if the panel throws despite
  everything, it renders `null` and logs to console — the panel disappears,
  the chat and the streaming answer keep rendering. Thinking can no longer
  take the UI down.

**Test:** `server/test-b206.js` — **36 checks**: objects/numbers/nulls/
arrays through `sanitizeText` and `safeRows`, ANSI/control stripping,
500-row → 40-row tail caps with correct hidden counts, 50KB reasoning → 6KB
tail, helper robustness under hostile input, and wiring contracts (ingestion
sanitization, slice(-400), local boundary hides-not-kills, memoized
processing, caps, markers, styles).

## Result

- `test-b206.js`: **36/36**; B205 timer contract updated to the hardened
  form; full `npm test`: **SUITE_EXIT=0** (B202→B206 all green; one
  presenter "live lion" network flake passed on rerun)
- `vite build`: clean
- Shipped as `3a790c0` → all CI workflows green (CI, Backend, Frontend,
  Docker, APK) → deployed Pages bundle verified to contain the hardened
  panel (`jx-agent-more`, capped-trace markers present)

## Guarantee

Whatever the brain streams while thinking — malformed events, objects,
control characters, 500-step marathons, megabyte reasoning — the worst case
is now: the panel hides itself. The answer and the chat always survive.
