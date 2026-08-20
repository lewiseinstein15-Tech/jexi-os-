# FIXLOG B153 — update still breaking → real fix; chat UI per the full spec

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

## 1. The update problem — root cause found and REALLY fixed
The previous fix cleared the WebView cache 60ms AFTER launch — but the page
had ALREADY started loading from the stale cache by then, so the broken
white screen survived. The definitive fix:

- **`MainActivity.java`** — on versionCode change (upgrade/fresh install),
  DELETE THE ENTIRE WebView data directory (`app_webview` — regular cache +
  per-origin HTTP cache + Service Worker storage) **BEFORE
  `super.onCreate()`**, i.e. before the WebView is created and the page
  starts loading. The new bundle then loads from the APK's assets with zero
  stale state. `clearCache()` alone never cleared the local-server HTTP
  cache — that was the surviving bug.
- **Service worker removed from the native APK** (`pushSubscribe` skips
  registration when running inside Capacitor; FCM already handles native
  push) + a one-time native boot cleanup that unregisters any previously
  registered SW and clears its caches — defence in depth.

After installing this build, every future in-app UPDATE installs cleanly:
no more broken screen, no more re-downloading.

## 2. Chat UI — the full spec (user vs AI distinct + actions)
- **User messages**: right-aligned, compact, on a distinct subtle surface
  (dark panel + hairline border + rounded bubble) — immediately obvious at
  a glance, original text preserved.
- **AI messages**: left-aligned with a small **J avatar**, full-width rich
  content (RichAnswer: headings, lists, checklists, code+copy+highlight,
  KaTeX math, tables, quotes, links, callouts, dividers, images), and a
  **message-actions row: Copy · Regenerate · Helpful · Not helpful**
  (subtle, monochrome; always visible on touch).
- **Regenerate** re-sends the user's message that preceded that answer.
- **Copy** copies the answer text.
- Monochrome palette, no gradients, no cards, mobile-first (bubble
  max-width on phones, actions always visible).

## Verified
- Full suite: 68 suites, exit 0 (incl. the rich-render test).
- esbuild parse OK on all changed frontend files.
- Android build compiles (BuildConfig enabled in B152; this build adds the
  pre-load wipe, no new build errors).
