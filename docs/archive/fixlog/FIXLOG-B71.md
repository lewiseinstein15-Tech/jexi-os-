# FIXLOG-B71 — Blank Android app after update: WebView parse-level incompatibility

## Symptom (user-reported, with screenshot)
After installing build #70, the JEXI OS Android app shows **only the dark dot-grid
background** (the CSS body style) and no UI at all — no top nav, no bottom nav, no
error card. The web app is unaffected.

## Diagnosis (evidence, not guesses)

1. **The APK bundle is byte-identical to the repo code.** Rebuilt locally with the
   exact workflow env vars (`VITE_JEXI_BACKEND_URL`, `VITE_APP_VERSION=apk-build-70`,
   `VITE_BUILD_SHA`) → produced `dist/assets/index-D-DEh08_.js`, **exactly the file
   inside the released APK** (`assets/public/assets/index-D-DEh08_.js`). The build
   pipeline is faithful; nothing was corrupted in the artifact.

2. **The bundle runs fine in a modern engine.** Executed the actual APK bundle inside
   jsdom with Capacitor shims: `IMPORT OK — no module-eval crash` + the full React
   shell renders (`root childNodes: 1`, `RENDERED OK`). So this is **not a code bug**
   in the app logic — it is an environment (WebView) capability issue.

3. **CSS renders but JS never mounts = parse-level failure.** The phone shows the
   stylesheet's background but zero React output and no ErrorBoundary card, which is
   the exact signature of the JS module **failing to parse** before a single line runs.

4. **The shipped bundle required Chrome 80+ just to parse.** Static scan of the APK's
   main bundle found:
   - `??` (nullish coalescing, Chrome 80+) — 21 occurrences in the first 200 KB
   - BigInt literals (`0n` / `1n`, Chrome 67+) — from `VisionPanel.jsx`'s dHash,
     which is statically imported through `ChatWindow` → lands in the **boot chunk**.
   - Vite's default build target is Chrome 87+; the app declares `minSdk 24`
     (Android 7.0, 2016), whose WebView can be far older. A WebView below Chrome 80
     cannot even parse the bundle → blank screen with CSS, no banner, no error.
   - This also retroactively explains why the update banner never appeared on older
     installs: the app was blank before it could ever run the update check.

## Fix (3 files, minimal)

| File | Change |
|---|---|
| `src/components/VisionPanel.jsx` | Replaced BigInt dHash (`0n`/`1n` literals) with a Number-based 56-bit fingerprint as two 32-bit halves (`{hi, lo}`) + SWAR popcount Hamming distance. Same scene-change semantics, no BigInt anywhere. |
| `vite.config.js` | Added `build: { target: 'es2017' }` so esbuild transpiles `??`, `?.()` etc. down to Chrome 58+-parseable syntax. All other config (base `./`, proxy, `server.hmr`) untouched. |
| `src/components/ChatWindow.jsx` | Feature-guarded `ResizeObserver` (Chrome 64+) with a `window.resize` fallback so the boot path never throws on slightly older WebViews. |

## Verification (real output)

```text
$ VITE_JEXI_BACKEND_URL=... VITE_APP_VERSION=apk-build-71 npm run build
✓ built in 18.10s

# new main bundle: dist/assets/index-CcTp1y_-.js

BigInt literals (0n/1n) in bundle: 0          (only match was a React key string "2bz60n")
nullish ?? in first 300KB: 0                  (transpiled away)
es2017 transform of main bundle: OK
es2017 transform across ALL 66 chunks: 0 failures

# boot harness against the NEW bundle (jsdom + Capacitor shims):
IMPORT OK — no module-eval crash.
root childNodes: 1
RENDERED OK
```

Before → after, on the parse floor:

| | Before (B70) | After (B71) |
|---|---|---|
| Nullish `??` in boot chunk | present (Chrome 80+) | transpiled (Chrome 58+) |
| BigInt literals in boot chunk | present (Chrome 67+) | removed |
| Vite build target | default (Chrome 87+) | es2017 (Chrome 58+) |
| ResizeObserver in boot path | unguarded (Chrome 64+) | guarded + resize fallback |

## Honest caveats
- The phone's exact WebView version is unknown (no device access). The evidence —
  CSS-only blank screen + bundle that requires Chrome 80+ — points squarely at
  parse-level incompatibility, and the fix lowers the parse floor by ~20 Chrome
  versions while rendering identically in a modern engine. If the device's WebView
  is *older than Chrome 58*, the remaining gap would need `@vitejs/plugin-legacy`
  (ES5 + SystemJS fallback), which was deliberately not added to keep this change
  minimal — say the word and I'll add it.
- The web build (Pages/Render static) is unaffected: ES2017 output runs everywhere
  modern, just slightly more verbose.
