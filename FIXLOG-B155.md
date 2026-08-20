# FIXLOG B155 — memory & conversation continuity really work; update stops wiping everything; chat UI + banner fixed

**Date:** 2026-08-20 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

## 1. THE BIG ONE — updates were wiping identity, memory and settings (root cause of 3 complaints at once)

The B153 update fix deleted the **entire `app_webview` directory** on every
version change. That directory is also where the app's **localStorage** lives
(`Local Storage/`), so every in-app update destroyed:

- `jexi_session_id` → the app got a **new random conversation id** → the
  backend saw a brand-new conversation → **all memory and continuity lost**,
  which is exactly "continuing conversation is not working" and "it doesn't
  remember what I tell it";
- `jexi_access_key`, backend URL, presets → the app appeared **broken** after
  every update ("the update is breaking it").

**Fix (`MainActivity.java`):** the wipe now deletes ONLY the directories that
can hold a stale bundle — `Cache`, `HTTP Cache`, `Code Cache`, `GPUCache`,
`Dawn*Cache`, `GrShaderCache`, `ShaderCache`, `Service Worker`. **`Local
Storage`, `Web Data`, `Cookies`, `IndexedDB` and everything else are kept**,
so identity, settings and conversations survive every update from now on.
The stale-bundle bug itself stays fixed (localStorage never serves HTML/JS —
only the HTTP cache and service worker did).

## 2. Memory — the direct answer path never saw learned facts

Audited against DeepSeek Harness's model (durable per-session JSONL logs,
session projection, compaction checkpoints, cross-session references — all
already mirrored in JEXI) and found **two real wiring gaps**:

1. **`conversationSummaryContext` (direct answers) never injected learned
   facts / preferences / user profile / episodic memory** — only the agent
   pipeline did. So "my name is X" → "what's my name?" forgot, because
   casual questions are answered by the direct path.
   → Now injects `topUserFacts(6)` + `recallPreferences(4)` + profile name/
   location + recent episodes, labeled `[What I remember about the user: …]`.
2. **`addChat('user', …)` — which extracts lasting facts — ran ONLY on the
   direct path.** Messages handled by the agent pipeline never had their
   facts learned.
   → Moved to the top of `/api/chat`: EVERY message (direct, pipeline, with
   or without image) is logged and fact-extracted.
3. Bonus (DSH session-projection mirror): `assemblePrompt` now includes the
   **current conversation's tail** (last user/JEXI turns, char-budgeted), so
   autonomous research/coding runs keep the thread instead of starting fresh.
   Callers that inject their own context already disable it — no duplication.

## 3. Chat UI — spec exactness + touch fixes

- User bubble contrast bumped (`#1c1c1c` on `#0a0a0a`, border `#303030`) —
  clearly different from the page, exactly as the spec says.
- Message actions (Copy / Regenerate / Helpful / Not helpful): bigger touch
  targets (30–32px), always visible on phones.
- **Live-stream caret**: while JEXI is typing, a blinking white block cursor
  shows the answer is being generated right now (spec: "appear as they are
  generated").
- The "working…" block now uses the same J avatar as every AI message
  (was an unstyled text glyph).
- Removed a duplicate `.jx-scroll` rule.

## 4. The last green thing is gone — update banner is monochrome

`UpdateBanner` still used the **banned `#00FF9D` green brand** (pulsing dot,
button, progress bar, success/error colors). Rewritten in pure black/white/
grays to match the rest of the app. Verified no other reachable screen uses
color (the remaining green files are legacy components no longer imported).

## Verification
- New suite **`test-memory-direct-path.js` — 8 checks**: direct-path memory
  injection (name/location/preference/profile), fact extraction from EVERY
  message via the central `addChat`, turn recorded in history, and the
  conversation-projection tail reaching `assemblePrompt`. Added to `npm test`.
- Full suite: **exit 0, 0 failures** (100+ suites incl. test-everything
  134-check gauntlet, test-rich-render 17/17, test-github-repo 34/34).
- Frontend builds clean (`vite build`).
- Server boots clean; `/api/health` OK.

## Build
APK **apk-build-NN** (see release tag). **Install #NN once manually** (Settings
→ update or the release link). From then on: updates keep your chats, memory,
access key and settings — nothing resets anymore.
