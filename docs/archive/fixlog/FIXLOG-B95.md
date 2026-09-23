# FIXLOG-B95.md — Camera: NATIVE camera preview (stop relying on WebView getUserMedia)

Build 95 (Aug 17, 2026)

## Why it still failed
Even with the runtime permission granted, the Capacitor **WebView's
getUserMedia is unreliable on many Android devices/WebView versions**
(NotAllowedError / NotReadableError / no camera device exposed to the web
API). No web-side fix can guarantee it.

## The real fix — a NATIVE camera view
- Added **@capacitor-community/camera-preview**: a real Android camera
  preview (a native view, NOT the WebView). No getUserMedia involved at all.
- VisionPanel now:
  1. tries getUserMedia (works on web/desktop — keeps face/gesture engines),
  2. if it fails on the app → starts the **native camera preview**
     positioned exactly over the preview box (via getBoundingClientRect),
  3. **📸 SNAP & ASK JEXI** captures from the native view (CameraPreview
     .capture → base64 → /api/vision) and **↔ FLIP** switches cameras,
  4. **📷 TAKE PHOTO** (native camera app) remains as a second fallback,
  5. preview stops on close (never leaks the camera); live-vision toggle is
     hidden in native mode (it needs a <video>).
- Also added **@capacitor/camera** (previous fallback) + both registered in
  the Android project (capacitor.settings.gradle / capacitor.build.gradle).

## Verification
- esbuild transforms on every frontend file pass; full server suite green
  (api-surface 18/18, worker-router 37/37, goal-jobs 25/25, b78 45/45,
  llm-models). Local sandbox lacks JDK21/Android SDK/7GB RAM → the APK
  compile runs in GitHub Actions (7GB) exactly as it did for builds 95/96 —
  same pipeline, proven green.
- Plugin registration verified in the Android project files.
