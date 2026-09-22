# FIXLOG-B118 — Fixed "freezing, can't send" (B117 left a stale mode reference)

**Phase:** B118 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## The bug (user report)
After B117 (one-mode removal), the app froze when trying to send: nothing happened.

## Root cause
B117 deleted the mode state from ChatWindow but **missed one reference**: the send
handler still called
`onSend(input, image, fileAttachments, mode)` — a 4th argument naming the removed
`mode` variable. Hitting Send threw `ReferenceError: mode is not defined` inside the
submit handler, so the send silently crashed → "freezing, can't send".

## The fix
- Removed the stale `, mode` argument — the send handler now calls
  `onSend(input, image, fileAttachments)` exactly matching `runSearch(query, image,
  attachments)`.
- Grepped every touched file for stray `mode` references: clean (only the unrelated
  `x-jexi-code-mode` header remains).
- Added a **regression guard** to test-auto-mode.js: no `onSend(..., mode)` call may
  exist in ChatWindow (36 checks now).

## Verification
- `npm test` full sweep (53 suites): **exit 0** · lint 0 errors
- esbuild compiles ChatWindow/HomeView/useJexiEngine
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
Sending works again: type → Send → JEXI routes automatically (direct answer or full
team) and streams the result.
