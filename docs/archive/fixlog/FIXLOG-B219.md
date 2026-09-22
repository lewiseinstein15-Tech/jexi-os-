# FIXLOG B219 — provider refresh: stop paying the dead-model tax on every question

**Date:** 2026-09-04 (night) · **Trigger:** user report — "jexi taking a lot of time on understanding the question" + prod log evidence

## What was actually happening (prod logs + live API checks)

Every question walked a provider cascade full of dead endpoints:

1. **Groq retired its ENTIRE llama line.** Live catalog on our key (verified via
   `GET /models`, 2026-09-04): `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
   `qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`, `groq/compound`, `allam-2-7b` —
   **no llama models at all.** But:
   - `GROQ_TEXT_MODEL` default was `llama-3.3-70b-versatile` (404 every first call)
   - `WorkerRouter` research tier hardcoded `llama-3.3-70b-versatile` AND
     `llama-3.1-8b-instant` (retired since B177) — both 404 per call
   - `GROQ_VISION_MODELS` (llama-4-scout, llama-3.2-11b-vision) both dead
   - the existing B177/B199 self-heal (discover + retry once) meant calls
     *worked* — after eating a wasted 404 round-trip first
2. **Gemini free-tier quota (RPM)** exhausted during mission/warmup bursts →
   tryGemini walked primary + BOTH fallback models, each a 429 round-trip
   (same quota bucket — the sibling retries could never help).
3. The planner tier led with `gemini-2.5-flash` — 404 "no longer available to
   new users" per B199's own note.

Net effect: seconds of dead-end round-trips before the first useful token —
exactly the "taking a lot of time on understanding" the user felt.

## Fixes

- **`LLMClient.js`**
  - `GROQ_TEXT_MODEL` default → `openai/gpt-oss-120b` (live flagship)
  - `GROQ_MODEL_PREFERENCE` reordered: gpt-oss-120b → gpt-oss-20b → qwen3.8/3.6 →
    compound → legacy llama patterns (kept for grandfathered keys)
  - **dead-model memo**: a `deadGroqModels` Set — any id that 404s is never
    tried again this process (stale hardcoded ids now cost ONE round-trip total,
    not one per call); `__groqModelHealth()` exposes {deadModels, cached, default}
  - **Gemini quota fast-exit**: on 429/quota/RESOURCE_EXHAUSTED, stop walking
    the sibling models (same RPM bucket) and fall to the next provider
- **`WorkerRouter.js`** — planner leads `gemini-3.6-flash` (current gen);
  researcher leads `openai/gpt-oss-120b` with `openai/gpt-oss-20b` fallback
- **`ModelCoworkers.js`** — roster rotated to the live catalog: Leonardo
  (research lead) takes gpt-oss-120b (keeps legacy llama fragments so old keys
  map to the same person; Oscar entry deduped away), Luna takes gpt-oss-20b,
  the Gemini sisters rotate (Maya=3.6, Mira=3.5, Mila=2.5)
- **`index.js`** — `app.set('trust proxy', 1)`: Render terminates TLS one hop
  ahead, so express-rate-limit now keys on the real client IP from
  X-Forwarded-For (kills the ERR_ERL_UNEXPECTED_X_FORWARDED_FOR warnings)
- **Prod cleanup** — the B217 proof mission (`ms-mtn69b1z-001`) that sat PAUSED
  in the user's mission list ("the app behaved weird") was cancelled via the
  control API: it was our test artifact, not a real mission.

## Test updates (truth changed intentionally)

- `test-incident-b177.js`: picker now prefers gpt-oss over retired llama; source
  literal assert pins the new default `openai/gpt-oss-120b`
- `test-model-coworkers.js`: Maya follows the live default (3.6), 2.5 demoted
  to Mila, gpt-oss-120b → Leonardo
- `test-worker-router.js`: memory worker primary = gemini-3.6-flash; researcher
  primary = groq(openai/gpt-oss-120b)

## Verification

- Affected suites standalone: incident-b177 ✅, model-coworkers ✅, worker-router
  37/37 ✅, llm-models ✅
- **Full `npm test` chain: PASS (exit 0, zero failures)** before push
- Note (honest): `test-b209.js` standalone shows 2 pre-existing failures in
  runtime-team-management ranking — verified UNRELATED to B219 (fails identically
  on a clean tree without these changes; state-isolation quirk of standalone runs;
  the full chain passes it)

## Honest limits

- Model catalogs rot: this fix pins today's truth + keeps the discovery self-heal
  for the NEXT retirement (Groq vision models have no live replacement on this
  key — image work routes to OpenRouter/Gemini, as before, but now skips the
  dead Groq attempts after one 404)
- The dead-model memo and cooldowns are per-process (reset on restart) — by
  design; they're warm-up costs, not correctness
- Gemini quota itself is a free-tier reality (20 RPM bursts): the fix removes
  the WASTED round-trips, not the quota
