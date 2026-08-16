# FIXLOG-B79 — Fixed Command Center layout + boot loading screen + the missing update explained

**Date:** 2026-08-16

## User request
"The command center should stay at a fixed position — not scroll to god knows
where. Make it like ChatGPT/Claude. Build a loading page so opening the app
never shows a blank screen. Trigger an update — I didn't get an update when
you built the last build."

---

## 1. Why the Command Center could scroll (root cause, real)

The app shell IS a fixed layout (`html/body/#root` locked, only `<main>`
scrolls) — but the shell's height came from Tailwind's `h-dvh`
(`height: 100dvh`). **`dvh` is not supported on older Android WebViews
(pre-Chrome 108).** On those WebViews the rule is dropped entirely, the shell
has no constrained height, and the page becomes freely scrollable — "to god
knows where". B71 already transpiles the JS for old WebViews, but no build
step can polyfill a CSS unit.

**Fix (`src/index.css` + `src/App.jsx`):**
- New `.app-shell` class: `height: 100vh; height: 100dvh;` — modern browsers
  get the dynamic viewport height, older WebViews fall back to `vh`. The shell
  is the only full-viewport element.
- The Command Center wrapper is now also `overflow-hidden`: the page can never
  scroll on the COMMAND tab, no matter what content grows inside.
- The plan header is capped (`max-h-[36%] overflow-y-auto`): a very long plan
  scrolls INSIDE its own card instead of pushing the page. The conversation
  scrolls inside `ChatWindow` (already `flex-1 min-h-0 overflow-y-auto`).
- Result: ChatGPT/Claude behavior — fixed header, fixed input pinned at the
  bottom, only the middle conversation scrolls.

## 2. Boot loading screen (never a blank screen)

New `src/components/BootSplash.jsx` + wired into `App.jsx`: on app open a
branded full-screen overlay shows for ~900 ms (bridging the native splash →
first painted frame), then fades out. Mirrors the app icon: rotating
cyan→violet→pink ring with 6 orbiting nodes, bright core, "JEXI OS"
wordmark, "Booting agent core…" status, shimmer progress bar.

## 3. Why the update never arrived — and how this build fixes it

The APK workflow (`.github/workflows/apk.yml`) only triggers on pushes that
touch `src/**`, `android/**`, `package.json`, `capacitor.config.json`, or the
workflow itself. **Builds B72–B78 were server-only** (`server/**`), so no new
APK was ever built, no new GitHub Release was published, and the in-app update
checker correctly saw nothing newer than the last APK build. This build
touches `src/**`, so the push triggers the APK pipeline → a new
`apk-build-<run>` Release with a strictly higher build number → the app's
`UpdateBanner` appears and the user can update in-app.

## Verification (real output)
```
$ npm run build
✓ built in 20.32s

$ freebuff-preview start → Preview is ready (HTTP 200)
  served bundle contains: "Booting agent core" (BootSplash),
                          "app-shell" (vh fallback),
                          "COMMAND CENTER" (fixed surface)
```
