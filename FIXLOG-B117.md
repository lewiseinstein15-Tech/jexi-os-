# FIXLOG-B117 — One Mode: Normal + Agent truly combined (no toggle, JEXI decides)

**Phase:** B117 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## The gap (user report)
"You are supposed to combine both modes — you never did that. Update the frontend to
ONE mode to let it decide which one is using."

B114 had added AUTO as a THIRD option on a toggle instead of removing the two modes.
This phase actually combines them: there is now exactly **one mode**, no toggle
anywhere, and JEXI decides per query (direct answer vs full team).

## What changed

### Frontend — all mode toggles removed
- **ChatWindow**: the AGENT/NORMAL segmented toggle is gone (state, storage, handlers
  deleted); replaced by a static badge **"⚡ AUTO · JEXI DECIDES"**.
- **HomeView**: the mode pill (AUTO→AGENT→NORMAL) is gone; replaced by a static badge
  **"⚡ ONE MODE · JEXI DECIDES"**. Unused icon imports cleaned.
- **useJexiEngine**: **never sends `x-jexi-mode`** anymore and no longer reads
  `jexi_mode`; it only sends the dsh preset header (still the one explicit override —
  minimal = direct answers) and the code-mode header (off for standard/minimal
  presets, otherwise on).
- **SettingsPanel**: presets no longer write `jexi_mode`; they only adjust the
  code-mode default (server routes everything itself).

### Server (unchanged behavior — already auto by default)
- `/api/chat` defaults to auto routing when no `x-jexi-mode` header arrives; the
  `normal`/`agent` overrides remain only for backward compatibility with older app
  builds. Every new request is classified: conversational/direct intents
  (conversation, direct_answer, translate, math_solve, creative_writing, confidence
  ≥ 0.6) → direct answer; everything else → the full agent pipeline.

## Tests (test-auto-mode.js 31 → 35)
- Engine sends NO x-jexi-mode and reads no jexi_mode; preset header still sent.
- ChatWindow has no AGENT/NORMAL buttons, no MODE_STORAGE/toggleMode, and shows the
  AUTO badge. HomeView has no toggle and shows the ONE MODE badge. SettingsPanel
  writes no jexi_mode.
- Server-side auto checks unchanged (default auto, confidence gate, direct block).

## Verification
- `npm test` full sweep (53 suites): **exit 0** · `eslint`: **0 errors**
- API surface: 85 frontend endpoints ↔ server routes, 0 missing
- esbuild compiles all touched frontend files
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
No mode buttons anywhere — just one chat. Ask "who are you" or "2+2" → instant direct
answer; ask "build me an app" or "research X" → the full team spins up automatically.
The static badge reminds you: ONE MODE · JEXI DECIDES.
