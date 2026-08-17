# FIXLOG-B93.md — Connection recovery · Twitter news · Source diversity · Vision · Home cards

Build 93 (Aug 17, 2026)

## 1. Dropped-connection recovery (the "result did not return" message)
- Recovery polling window extended **3 min → 10 min** (matches the server's
  result-store TTL) and polls faster (3s). While waiting, the app now shows
  an honest interim note ("JEXI is still working server-side…") instead of
  the scary fallback immediately; the fallback only appears after 10 min
  and explains "continue" / retry. Cause of the drop itself: Render
  redeploys/restarts mid-task — the server-side run keeps going and the
  result lands in the store, so the longer window catches it.

## 2. Twitter/X in the news team (real, no login)
- Nitter instances are dead in 2026 → `twitterLatest` now falls back to a
  **search-engine Twitter scraper** (DuckDuckGo HTML, `site:twitter.com OR
  site:x.com <topic>`), returning REAL tweets with status links. Verified
  live: "AI news" → x.com/AINewsPulse/status/…, @AINewsFeed, etc. News
  goals now include X/Twitter updates alongside BBC/CNN/Google News.

## 3. Research uses many sources (not Wikipedia alone)
- `rankSources` now caps **2 results per domain** and returns up to **10**
  sources (was 6, Wikipedia-dominated). `MAX_SOURCES_TO_READ` default
  5 → 10. Verified: 5 distinct domains (wikipedia, iea, solarreviews, nrel,
  pv-magazine) — Wikipedia capped, never alone.

## 4. Vision fix (camera)
- Root cause: Capacitor WebView silently denies `getUserMedia` without a
  native `onPermissionRequest` grant. MainActivity now grants WebView
  permission requests (camera/mic), asks for runtime CAMERA + RECORD_AUDIO
  at launch, and installs a WebChromeClient that grants the same. The
  manifest already had CAMERA — the missing native grant was the bug.

## 5. Capability cards moved from Command Center → Home
- New `CapabilityCards` component (BUILD AN APP · RESEARCH · STUDY ·
  OPEN A LINK · USE MY EYES · SELF-CHECK) now renders on the **Home page**
  with the quick actions. Removed from the Command Center chat's empty
  state (kept a small hint there).

## Verification
- New test-search-diversity 4/4 · 21-suite sweep green · lint 0 · esbuild
  checks on all JSX · Twitter fallback verified live (real x.com status
  links). CI will run the full build (sandbox RAM limits local bundle).
