# FIXLOG-B94.md — Camera/Vision: the REAL fix + native-camera fallback

Build 94 (Aug 17, 2026)

## Root cause of "camera not working" (found by reading Capacitor's source)
Capacitor's own `BridgeWebChromeClient` ALREADY implements `onPermissionRequest`:
when the WebView asks for VIDEO_CAPTURE it requests the runtime CAMERA
permission via its ActivityResult launcher, then grants the WebView request.

My B93 "fix" REPLACED that client with a bare `WebChromeClient` that granted
without ever requesting the runtime permission → getUserMedia still failed
(NotAllowedError), and Capacitor's file-chooser handling was lost too.

## The correct fix
- **MainActivity restored**: NO custom WebChromeClient — Capacitor's client
  (with its proper permission flow) stays in charge. We only:
  1. proactively request CAMERA + RECORD_AUDIO runtime permissions at launch
     (the OS dialog appears immediately, so getUserMedia succeeds first try),
  2. keep the black-screen fix.
- **Native-camera fallback added** (bulletproof): if `getUserMedia` is still
  blocked on a given device, the Eyes panel now shows the REAL error plus
  **↻ RETRY CAMERA** and **📷 TAKE PHOTO** — TAKE PHOTO uses the
  `@capacitor/camera` plugin → opens the phone's real camera app → the photo
  is analyzed by JEXI's vision (and the bottom "ask" button works with the
  photo too). On web it falls back to a file picker.
- The error message now includes the actual error name (NotAllowedError,
  NotFoundError, …) so any remaining issue is diagnosable.

## Files
- android/app/src/main/java/com/jexi/os/MainActivity.java
- src/components/VisionPanel.jsx (camera fallback UI + photo-aware ask)
- package.json (+@capacitor/camera)

## Verification
- esbuild transforms pass; server suites unaffected; CI builds the APK
  (run_number bump → new release).
