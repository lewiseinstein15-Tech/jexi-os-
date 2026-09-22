# FIXLOG-B74 — vLLM: self-hosted, genuinely-free inference backend

**Date:** 2026-08-16

## User request
"https://github.com/vllm-project/vllm — Check out this one"

## What vLLM is (checked, Aug 2026)
[vLLM](https://github.com/vllm-project/vllm) is the de-facto standard open-source
LLM inference & serving engine (66k+ stars, Apache-2.0, originated at UC
Berkeley's Sky Computing Lab). Key property for JEXI: it ships a **built-in,
drop-in OpenAI-compatible HTTP server** (`vllm serve <model>` →
`POST /v1/chat/completions` on port 8000). That means:

- **Genuinely free inference** — no API key, no per-token cost; you pay only
  for your own hardware (GPU or even CPU).
- **Fits JEXI's existing provider pattern** — OpenAI-compatible callers are
  already how Cerebras/DeepInfra/Mistral/Grok/DeepSeek are wired, so vLLM is
  one more entry in the same shape.

## What was wired (additive, nothing removed)

### 1. `server/src/services/LLMClient.js` — `tryVllm` provider
- OpenAI-compatible POST to `${VLLM_BASE_URL}/chat/completions`
  (default `http://localhost:8000/v1` — vLLM's server port; override via env).
- `VLLM_MODEL` pins the served model name; `VLLM_API_KEY` optional (for
  `vllm serve --api-key`).
- Env read at **call time**, not module load → testable with a mock server.
- Registered in `PROVIDER_CALLS` as `vllm`. Text-only (vision stays hosted).
- Degraded-mode message now mentions `VLLM_BASE_URL` alongside Ollama.

### 2. `server/src/services/ProviderRouter.js` — routing + health
- `providerOrder()` inserts `vllm` right before `huggingface` in all three
  preference orders — so the general path tries it before the slow HF free
  tier, and **huggingface stays last** (test-roster-skills contract intact).
- `ENV_MAP.vllm = 'VLLM_BASE_URL'` — vLLM shows as a real provider in
  `/api/health/providers` when a base URL is set; `testProvider('vllm')`
  probes it.
- Health snapshot names it `vLLM (self-hosted)`.

### 3. `server/src/services/WorkerRouter.js` — fallback tier
- Last-resort tier now `[vllm → huggingface → deepinfra → mistral]`: a
  self-hosted vLLM (fast, free) is tried before the slow HF free tier. When
  nothing is listening, the connection is refused instantly and the walk
  continues — zero effective cost in the normal (hosted-provider) case.

### 4. Tests
- `server/test-worker-router.js` → **27 checks** (was 20): vLLM in the
  general walk, huggingface stays last, vLLM leads the fallback tier, plus a
  **real mock-server round-trip** — a local HTTP server stands in for vLLM,
  and `generateContent({ provider: 'vllm' })` completes with the mock's
  answer, proving JEXI speaks vLLM's API shape.
- `server/test-roster-skills.js` — provider-snapshot count 9 → 10 (vLLM).

## Verification (real output)
```
$ cd server && node test-worker-router.js
✅ vLLM is in the general provider walk
✅ general order keeps huggingface last (vLLM sits just before it)
✅ vLLM leads the last-resort fallback tier (self-hosted free inference)
✅ vLLM mock hit /v1/chat/completions (got /v1/chat/completions)
✅ vLLM request carries the model (got "test-model")
✅ vLLM request carries system+user messages
✅ vLLM provider round-trip ok (got "pong from vLLM")
RESULT: 27 passed, 0 failed

$ cd server && npm test
EXIT=0 · 0 failed (full chain)
```

## What the user does to use it (no code changes needed)
1. Run vLLM on any machine JEXI can reach, e.g.:
   ```bash
   pip install vllm            # or: docker run --gpus all -p 8000:8000 vllm/vllm-openai
   vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
   ```
2. Point JEXI at it: set `VLLM_BASE_URL` (default `http://localhost:8000/v1`
   already works if vLLM runs on the same host), optionally `VLLM_MODEL`.
3. vLLM becomes JEXI's free last-resort tier automatically — and shows up in
   the Models/health screen as "vLLM (self-hosted)".

## Honest positioning
vLLM is not a hosted free tier — it's **free because it's yours**. JEXI now
treats it as the fastest fallback before the slow HuggingFace free tier; the
hosted free providers (Groq / Gemini / OpenRouter free / Mistral) still carry
normal traffic because they need zero hardware. For a machine JEXI itself runs
on, vLLM can also serve as the always-available brain (e.g. after Ollama).
