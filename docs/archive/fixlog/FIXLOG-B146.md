# FIXLOG B146 — "I told it to build an app but it said it was unable": build-failure transparency + retry

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

## Root cause
The user asked JEXI to build an app and got "I could not complete the build
right now (AI providers unavailable)." Investigation found:
1. The build pipeline itself works — the full autonomous-coding path through
   the real tool gate (allowlist/sandbox/permission/risk) builds files, runs
   them, verifies (gauntlet section F: 9-file project, server boots, HTTP 200).
2. Live provider health was 3/6 — half the free-tier AI providers were failing
   (rate limits/transients); one build task ran 4.3 minutes before finishing.
3. When ALL providers fail, generateWithToolsLoop throws with the real reasons
   (e.g. "groq: rate-limited | gemini: timeout"). The coding runner caught it,
   but the final answer kept only the vague message — no explanation, no retry.

## The fix (B146)
- Automatic retry ONCE (1.5s cooldown) before giving up — absorbs transient
  rate limits.
- The final answer now reports the REAL provider reasons and tells the user
  what to do (retry in a minute / add a provider key in Settings → System).
- Test updated to the new contract; failure path verified with a deliberately
  invalid key (shows "Details: groq: 401 Invalid API Key ...").

## Verified
- npm test — exit 0, 68 suites green (incl. the 134-check gauntlet).
- eslint — 0 errors.
- Provider health stays observable at /api/metrics (providerHealth).
