# FIXLOG-B73 — Free-model audit: DeepSeek/Qwen free tiers researched and applied

**Date:** 2026-08-16

## User request
"Use free models — DeepSeek must have free tier, also Qwen. Check it, research
it, and apply the free models."

## Research — live evidence, not guesses

### 1. DeepSeek: NO free tier exists anywhere JEXI can reach
- **DeepSeek's own API** (`api.deepseek.com`): paid only. `deepseek.ai/pricing`
  states: *"The API is paid, per the token rates listed. There is no permanent
  free API tier, though promotional credits appear from time to time."* New
  accounts get a one-time ~5M-token grant — JEXI's account already consumed it
  (live probe: `HTTP 402 Insufficient Balance`), which is the 402 from B72.
- **OpenRouter** (live query of `openrouter.ai/api/v1/models`, 413 models):
  `free: 19` → **zero free Qwen, zero free DeepSeek**.
- **Groq**: `deepseek-r1-distill-*` models are in Groq's **Deprecated** section
  (deprecation effective June 17, 2026 per console.groq.com/docs/deprecations).

### 2. Qwen: no free Qwen on OpenRouter or Groq anymore
- OpenRouter live list: `qwen/qwen3-8b:free`, `qwen/qwen-2.5-72b-instruct:free`
  are **gone** (the B72 dead model). Groq's only Qwen (`qwen/qwen3.6-27b`) is a
  **PAID preview** ($0.60/$3.00 per 1M).
- **Free Qwen IS real via HuggingFace serverless inference** (already-wired
  provider, `HF_TOKEN`): `Qwen/Qwen2.5-7B-Instruct` and
  `Qwen/Qwen2.5-Coder-7B-Instruct` are on HF's supported Inference Providers
  list (verified on huggingface.co/inference/models).

### 3. What IS genuinely free today (live-verified $0 on OpenRouter, tools supported)
| Model | Context | Tool calling |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b:free` | 262k | ✅ |
| `cohere/north-mini-code:free` (code-focused) | 256k | ✅ |
| `google/gemma-4-26b-a4b-it:free` | 262k | ✅ |

Plus the free tiers already proven working by the B72 live probe: Groq
(`llama-3.1-8b-instant`), Gemini (`gemini-2.5-flash`), and
`bytedance-seed/seed-2.0-mini` at $0.10/M in (~$0.001 per message — near-free).

## Changes applied (3 files + docs)

### 1. `server/src/services/WorkerRouter.js` — free-first chains
- **coder**: `deepseek(deepseek-chat)` [B66 architecture primary — cheap, works
  once the account is topped up; no free tier exists] → **`cohere/north-mini-code:free`**
  [FREE code model] → `bytedance-seed/seed-2.0-mini` [near-free fallback].
- **memory** (conversation path): **`nvidia/nemotron-3-super-120b-a12b:free`**
  [FREE 120B general, tool calling] → `bytedance-seed/seed-2.0-mini` →
  `gemini(gemini-2.5-flash)` [free tier].
- **researcher**: `grok-4.6` → `groq(llama-3.1-8b-instant)` [free tier] →
  `bytedance-seed` → **`google/gemma-4-26b-a4b-it:free`** [FREE fallback].

### 2. `server/src/services/LLMClient.js` — dead entries removed, free Qwen added
- `OPENROUTER_TEXT_MODELS` contained **two dead models** (live-verified NOT in
  OpenRouter's list → every call 404'd before reaching a working model):
  `meta-llama/llama-3.3-70b-instruct:free` and
  `deepseek/deepseek-chat-v3-0324:free`. Replaced with the verified-free list
  above.
- `HF_TEXT_MODELS` now **leads with free Qwen**: `Qwen/Qwen2.5-7B-Instruct`
  (general) and `Qwen/Qwen2.5-Coder-7B-Instruct` (coding) — the genuinely-free
  Qwen path, served by HF serverless inference with the existing `HF_TOKEN`.
- Dead `QWEN_MODELS` constant repointed at the HF-served models (documentation).
- New exports `OPENROUTER_FREE_TEXT_MODELS` / `HF_FREE_QWEN_MODELS` so the
  regression suite can guard the wiring.

### 3. `server/test-worker-router.js` — suite grown 12 → 19 checks
New guards: no dead `:free` entries (llama-3.3-70b / deepseek-chat-v3-0324 /
qwen-2.5-72b) anywhere in COWORKERS; every verified-free OpenRouter model is
wired in; memory leads with nemotron-3-super-120b:free; coder's free code model
is north-mini-code:free; DeepSeek stays the coder primary; free Qwen is served
via HF and the fallback tier reaches HF; roster reflects the free-first chains.

## Verification (real output)

```
$ cd server && node test-worker-router.js
✅ no qwen/qwen3-8b:free anywhere in COWORKERS (model deleted from OpenRouter)
✅ no dead OpenRouter :free entries (llama-3.3-70b / deepseek-chat-v3-0324 / qwen-2.5-72b) in COWORKERS
✅ every verified-free OpenRouter model is wired into COWORKERS
✅ memory worker primary = openrouter(nvidia/nemotron-3-super-120b-a12b:free) — $0
✅ coder #2 = openrouter(cohere/north-mini-code:free) — free code model
✅ free Qwen is served via HuggingFace Inference API (Qwen2.5-7B + Qwen2.5-Coder-7B)
RESULT: 19 passed, 0 failed

$ cd server && npm test
EXIT=0 · 0 failed (full chain — every suite green)
```

## Honest bottom line for the user
- **DeepSeek free tier: does not exist.** It was never free beyond a one-time
  signup credit (already used → HTTP 402). The "free DeepSeek" on OpenRouter
  was removed. Keep `deepseek-chat` as the coder primary — it costs ~$0.30/M
  and starts working the moment the account is topped up. Until then, coding
  tasks succeed for free via `cohere/north-mini-code:free`.
- **Qwen free tier: exists only via HuggingFace** (slow, but genuinely $0 with
  `HF_TOKEN` — already configured). Applied there.
- **New free capacity applied:** nemotron-3-super-120b (memory/conversation),
  north-mini-code (coding), gemma-4-26b (research) — all live-verified $0 with
  tool calling on OpenRouter. The app now runs free-first, with the cheap
  working providers as fallback.
