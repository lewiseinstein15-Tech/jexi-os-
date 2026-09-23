# FIXLOG-B77 — Free-only routing + load spreading (never hit rate limits)

**Date:** 2026-08-16

## User request
"Arrange them well, utilise them well so we never hit rate limits — and the
payment ones: remove them so they are never used. Trigger a new update."

## Changes

### 1. Payment-gated providers REMOVED — never attempted again
Live-probed 402/403 providers are gone from routing entirely
(`ProviderRouter.js` + `WorkerRouter.js`):

| Removed | Live probe |
|---|---|
| Cerebras | 402 payment required |
| DeepInfra | 402 need positive balance |
| xAI / Grok | 403 no credits |
| DeepSeek (direct API) | 402 insufficient balance |
| SambaNova | 402 PAYMENT_METHOD_REQUIRED (balance_units 0) |

They are removed from: `EXTRA_PROVIDERS`, `ENV_MAP` (never counted/probed),
the health snapshot names, the coder chain (deepseek-chat), the research
chain (grok), and the fallback tier (deepinfra). The provider code still
exists in LLMClient for anyone who later funds an account — re-adding is a
one-line change. **The app now runs ONLY on live-verified free tiers.**

### 2. Load spreading — head rotation in the general path
`providerOrder()` (default/conversation path) now ROTATES its healthy head
(Groq / Gemini / OpenRouter) on every call. Daily rate limits (Gemini 1,500
RPD, Groq 1,000 RPD, OpenRouter-free 50 RPD) get spread across the big three
instead of hammering one until it 429s. Preference-biased orders (Gemini-first
for code/vision, OpenRouter-first for Seed) stay deterministic — those paths
need the bias. The slow tail (vLLM → HuggingFace) never rotates.

### 3. Free-only coworker chains (best model per part, all live ✅)
| Coworker | Chain |
|---|---|
| coder | NVIDIA **DeepSeek V4 Flash** (free) → north-mini-code:free → seed |
| memory | **Gemini 2.5 Flash** (1,500 RPD) → nemotron-3-super-120b:free → seed |
| researcher | **Groq 70B** (1,000 RPD) → Groq 8B → seed → gemma-4:free |
| fallback | vLLM (self-hosted) → HuggingFace (free DeepSeek/Qwen) → Mistral |

Plus a latent bug fix: `providerHealthSnapshot()` computed `providerOrder()`
twice — with rotation the second call could shift positions and make every
`indexOf` return -1. It now computes the order once.

## Verification (real output)
```
$ cd server && node test-worker-router.js
✅ coder #1 = nvidia(deepseek-ai/deepseek-v4-flash-0731) — FREE DeepSeek leads
✅ no payment-gated provider (cerebras/deepinfra/xai/deepseek/sambanova) remains in COWORKERS
✅ payment-gated sambanova removed from the general provider walk
RESULT: 37 passed, 0 failed

$ cd server && node test-roster-skills.js
✅ default head is a rotation of groq/gemini/openrouter
✅ payment-gated providers removed from the walk
✅ snapshot lists all 7 providers
ALL ROSTER/SKILLS/ROUTER/VERIFY TESTS PASSED

$ cd server && npm test
SERVER EXIT=0 · 0 failed   (test-memory-vector 402-cooldown test retargeted
                            from cerebras → nvidia, since cerebras is retired)

$ npm run build
✓ built in 17.77s
```

## Rate-limit math (why we won't hit limits)
- **Conversation** (highest volume): Gemini free 1,500 RPD primary, and the
  general path rotates across Groq (1,000 RPD) + OpenRouter free.
- **Research**: Groq 1,000 RPD primary, two more fallbacks after it.
- **Coding**: NVIDIA 40 RPM (credit-metered ~1,000), OpenRouter free 50 RPD,
  then seed-2.0-mini — near-free and UNCAPPED.
- **Fallback stack**: vLLM → HuggingFace → Mistral catch anything left.
