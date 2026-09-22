# FIXLOG-B116 — Critical: "Cannot access 'mode' before initialization" (TDZ crash)

**Phase:** B116 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green

## The bug (user report)
Chat showed: "Cannot access 'mode' before initialization — The server is online —
tap STOP and try again."

## Root cause
B114 (AUTO mode) inserted the auto-routing block (`let autoDirect = false;
if (mode === 'auto') {…}`) near the top of the /api/chat handler — but the
`const mode = String(req.body.mode …)` declaration stayed at its OLD position,
much later in the handler. Referencing `mode` before its `const` declaration throws a
JavaScript **temporal-dead-zone (TDZ) ReferenceError**, and that reference was OUTSIDE
the try/catch — so EVERY chat request crashed server-side before producing any events,
and the app showed the generic connection-failure message.

## The fix
- **Hoisted** `const preset` + `const mode` to the very top of the chat handler
  (right after the user message is logged), before the /plan command, the identity
  fast-path, and the auto-routing block — so `mode` is always initialized before any
  use.
- Removed the now-duplicate later declaration (single source of truth; the /api/agent
  route keeps its own, separate preset line).

## Tests
- test-auto-mode.js gained a **source-order regression guard** (31 checks): asserts the
  `const mode` line appears BEFORE the `if (mode === 'auto')` block, that exactly ONE
  mode declaration exists, and no preset declaration follows mode in the chat handler —
  so this class of bug can never return silently.
- **Live smoke test**: booted the server and POSTed /api/chat — the request ran the
  full handler (auto-routing → pipeline → streamed events → done) with **zero**
  "before initialization" errors.

## Verification
- `npm test` full sweep (53 suites): **exit 0** · `eslint`: **0 errors**
- test-plan-mode / identity / api-surface / llm-models all green.
- Backend-only fix; Render picks it up on the next auto-deploy.

## How the user sees it
After the deploy, chat works again: every message streams the normal events (auto
routing decision → agent work or direct answer → result). No more "Cannot access
'mode' before initialization".
