# FIXLOG B152 — "When you update it breaks, I have to re-download the app" — fixed

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

## The bug
After installing an in-app UPDATE (or any new APK build) the app opened
broken/blank, forcing the user to manually re-download the APK. This is the
classic Android WebView upgrade bug: after an APK upgrade install, the
WebView keeps serving its STALE cached page — the old `index.html` plus old
hashed JS/CSS asset URLs that no longer exist in the new bundle — which
renders a white/broken screen until app data is cleared (what "re-download
and re-install" effectively did).

## The fixes
1. **`MainActivity.java` — clear the WebView cache on version change**:
   compare `BuildConfig.VERSION_CODE` (rises every build via
   `APK_BUILD_NUMBER`) against a stored value; on upgrade or fresh install,
   wipe the WebView cache + cookies and reset the cache mode BEFORE the new
   page loads. The new bundle now always resolves its own assets — no more
   broken screen after an update.
2. **`updateInstaller.js` — hardened the in-app download**:
   - Validates the download is a real APK (ZIP magic bytes `PK\x03\x04`) —
     a proxy error page or GitHub hiccup can return HTTP 200; writing that
     as the APK broke installs. Now it says exactly that and to retry.
   - Deletes any stale cached APK before writing the new one.
   - Clearer error message when the package installer can't open (the
     "Install unknown apps" permission guidance).

## Verified
- Full suite: 68 suites, exit 0.
- Frontend files parse (esbuild).
- The fix ships in the NEXT APK build (build #159+): after that, tapping
  UPDATE → INSTALL → reopening the app works cleanly, no re-download needed.
- If the CURRENT installed build is broken, update to the new build: if the
  app won't open at all, clear the app's data once (Settings → Apps → JEXI
  OS → Storage → Clear cache) or re-install the new APK — from then on
  updates are clean.
