# FIXLOG-B72 — "The task hit an unexpected error": dead model + hidden degraded message

**Date:** 2026-08-15

## User report
The app showed `⚠ the task hit an unexpected error — The server is online — tap STOP
and try again`. The backend was online (health green, Redis connected), so this was
a TASK failure, not an outage.

## Diagnosis — evidence, not guesses

**Live metrics** (`/api/metrics`) showed all three recent `chat.task` spans with
`status: "error"`, every one `intent: "conversation"`, each failing in under a
second, with `chat.gate.result: 0`:

```json
{"name":"chat.task","status":"error","durationMs":1044,"traceId":"tr-msuyf56m-1"}
{"name":"chat.task","status":"error","durationMs":554,"traceId":"tr-msv0c0bg-2"}
{"name":"chat.task","status":"error","durationMs":478,"traceId":"tr-msv0e1vd-3"}
```

**Live provider probe** (`/api/health/providers`) — which keys actually work:

| Provider | Live result |
|---|---|
| Groq | ✅ ok |
| Gemini | ✅ ok |
| OpenRouter | ✅ ok (via bytedance-seed/seed-2.0-mini) |
| Mistral | ✅ ok |
| HuggingFace | ❌ fetch failed |
| Cerebras | ❌ HTTP 402 (no payment) |
| DeepInfra | ❌ HTTP 402 / 404 model |
| xAI / Grok | ❌ HTTP 403 (no credits) |
| DeepSeek | ❌ HTTP 402 (insufficient balance) |

**Root cause chain (three compounding bugs):**

1. **Dead primary model.** Conversation tasks route to the **memory coworker**
   (`coworkerFor('conversation')` → `memory`), whose PRIMARY provider was
   `openrouter:qwen/qwen3-8b:free`. Live check of OpenRouter's model list shows
   that model no longer exists — **zero free Qwen models remain**, and only the
   paid `qwen/qwen3-8b` exists. Every conversation task failed on it instantly.

2. **Working providers were silently skipped.** The SIMPLE path always passes
   native tool schemas, so `runWorker` used `generateWithToolsLoop`, which skips
   any provider not in `TOOL_CAPABLE` (`['groq','openrouter','deepseek','xai',
   'cerebras','deepinfra','mistral']`). **Gemini and HuggingFace — two of the
   four working providers — were never attempted** (metrics confirm 0 calls).
   The remaining chain (OpenRouter-dead → DeepInfra-402 → Mistral-tool-path
   failure) all failed → honest degraded result.

3. **The real reason never reached the user.** The `done` event on failure
   carried only `summary` (which held the full degraded-mode message), but the
   frontend's failure branch read only `data.error` and ignored `data.summary` —
   so the user saw the generic "the task hit an unexpected error" instead of the
   actual degraded-mode explanation.

## Fixes (3 files, verified)

### 1. `server/src/services/WorkerRouter.js` — live model + plain-text fallback pass
- **Dead model replaced** in both the memory and coder chains:
  `qwen/qwen3-8b:free` → `bytedance-seed/seed-2.0-mini` (live-verified working).
- **`runWorker` now has a Pass 2:** if native tool calling fails for every
  tool-capable provider (or none were requested), it re-walks the SAME chain
  WITHOUT tools via `generateContentSafe` — so Gemini / HuggingFace / Mistral
  (text-only, not tool-capable) become reachable. Tools are a bonus, never a
  hard requirement: a conversation answer must not die because every
  tool-capable provider is down.

### 2. `src/hooks/useJexiEngine.js` — surface the real reason
The failure branch now falls back to `data.summary` when `data.error` is
missing: `data.error || (data.summary && data.summary.trim()) || generic`.
The user now sees the actual degraded-mode message (which provider failed)
instead of the opaque generic.

### 3. `server/test-worker-router.js` — new regression suite (12 checks)
Guards: no `qwen3-8b:free` anywhere in COWORKERS; memory worker leads with
`openrouter(bytedance-seed/seed-2.0-mini)` + `gemini(gemini-2.5-flash)`;
coder fallback is live; routing semantics unchanged; `workerRoster()` shows the
live models; `runWorker`'s native tool loop still completes end-to-end.
Registered in `server/package.json` test chain.

## Verification (real output)

```
$ cd server && node test-worker-router.js
✅ no qwen/qwen3-8b:free anywhere in COWORKERS (model deleted from OpenRouter)
✅ memory worker primary = openrouter(bytedance-seed/seed-2.0-mini)
✅ memory worker #2 = gemini(gemini-2.5-flash)
✅ coder fallback = openrouter(bytedance-seed/seed-2.0-mini)
✅ conversation → memory worker (unchanged)
✅ runWorker tool loop ok with live chains
RESULT: 12 passed, 0 failed

$ cd server && npm test
EXIT=0 · 27 suites · 0 failed

$ npm run build
✓ built in 17.68s
```

## What the user should know (env/account actions, not code)
Four providers are configured but cannot work until their accounts are funded:
- **DeepSeek** — HTTP 402 Insufficient Balance (coder coworker primary)
- **xAI / Grok** — HTTP 403 team has no credits/licenses
- **DeepInfra** — HTTP 402 no balance (and one model 404 — renamed)
- **Cerebras** — HTTP 402 payment required

Conversation and research now succeed via the working set (Groq, Gemini,
OpenRouter, Mistral). To use the broken ones, top up the account at each
provider and redeploy — no code change needed.
