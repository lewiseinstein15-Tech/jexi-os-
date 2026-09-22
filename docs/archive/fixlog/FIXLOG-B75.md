# FIXLOG-B75 — No-card free AI API keys: research + NVIDIA NIM / SambaNova wired

**Date:** 2026-08-16

## User request
"Go research better options for our problem with API keys — better ways to get
free AI models. No card, no money: just sign in, get an API key, ready to go."

## Research — what actually exists for no-card free AI (live-verified)

| Provider | Free tier | Credit card? | Verified |
|---|---|---|---|
| **NVIDIA NIM** (build.nvidia.com) | ~1,000 inference credits (1 credit ≈ 1 call), 40 RPM, 100+ models incl. **DeepSeek V4 Flash**, Llama, Nemotron, Gemma | ❌ none | ✅ live — `integrate.api.nvidia.com/v1/models` (102 models) + chat endpoint |
| **SambaNova** (cloud.sambanova.ai) | 20 RPM, 200K TPD — **DeepSeek-V3.1 / V3.2 free**, Llama 3.3, gpt-oss-120b, MiniMax | ❌ none | ✅ live — `/v1/models` (6 models) + chat endpoint |
| Groq | free tier (1,000 RPD 2026) | ❌ none | already wired + working |
| Google Gemini (AI Studio) | 1,500 RPD | ❌ none | already wired + working |
| OpenRouter `:free` | ~22 free models, 20 RPM / 50 RPD | ❌ none | already wired + working |
| Mistral "Experiment" | ~1B tokens/month | ❌ none | already wired + working |
| HuggingFace serverless | free tier (slow) — free DeepSeek + Qwen | ❌ none | already wired (B73) |
| **GitHub Models** | free prototyping, GPT/Claude/DeepSeek | ❌ none | ❌ **RETIRED 2026-07-30** — dead, not wired |
| Cerebras | free tier | ⚠️ payment method required | existing key 402s (needs card) |

Also spotted: SiliconFlow (free Qwen3-8B, CN), Zhipu GLM flash (CN), OVHcloud
(anonymous 2 RPM, no key), Ollama Cloud (free tier), Cloudflare Workers AI
(10K neurons/day). The two live-verified, no-friction, no-card additions that
fit JEXI's OpenAI-compatible pattern were **NVIDIA NIM** and **SambaNova**.

## What was wired (additive)

### 1. `server/src/services/LLMClient.js`
- **`tryNvidia`** — OpenAI-compatible at `https://integrate.api.nvidia.com/v1`,
  key `NVIDIA_API_KEY`. Model chain (live-verified IDs):
  `deepseek-ai/deepseek-v4-flash-0731` (free DeepSeek V4 Flash) →
  `meta/llama-3.3-70b-instruct` → `nvidia/nemotron-3-super-120b-a12b` →
  `google/gemma-4-31b-it`. `NVIDIA_API_URL` is a test seam (mock-server hook).
- **`trySambaNova`** — OpenAI-compatible at `https://api.sambanova.ai/v1`, key
  `SAMBANOVA_API_KEY`. Model chain: `DeepSeek-V3.1` → `DeepSeek-V3.2` →
  `Meta-Llama-3.3-70B-Instruct` → `gpt-oss-120b`.
- Both registered in `PROVIDER_CALLS`; keys in `resolveKeys()` (env || settings).

### 2. `server/src/services/ProviderRouter.js`
- `EXTRA_PROVIDERS` += `nvidia`, `sambanova` — both join the free-tier walk
  (before vLLM/HF), auto-probed by `/api/health/providers` when keys are set.
- `ENV_MAP` += `NVIDIA_API_KEY`, `SAMBANOVA_API_KEY`; health names
  "NVIDIA NIM" / "SambaNova".

### 3. `server/src/services/WorkerRouter.js` — coder chain
- `coder` now: `deepseek(deepseek-chat)` → **`nvidia(deepseek-ai/deepseek-v4-flash-0731)`**
  (FREE DeepSeek via NVIDIA, no card) → `cohere/north-mini-code:free` → seed.
  This directly answers the repeated "free DeepSeek" ask: NVIDIA hosts DeepSeek
  V4 Flash on the no-card free tier.

### 4. Tests
- `test-worker-router.js` → **33 checks** (was 27): coder chain free-DeepSeek
  assertion, NVIDIA + SambaNova in the general walk, and a **mock round-trip**
  proving JEXI speaks NVIDIA's API (DeepSeek V4 model ID carried in the request).
- `test-roster-skills.js` — provider snapshot 10 → 12.

## Verification (real output)
```
$ cd server && node test-worker-router.js
✅ coder #2 = nvidia(deepseek-ai/deepseek-v4-flash-0731) — FREE DeepSeek via NVIDIA NIM
✅ NVIDIA NIM (no-card free tier) is in the general provider walk
✅ SambaNova (no-card free DeepSeek) is in the general provider walk
✅ NVIDIA mock hit /v1/chat/completions (got /v1/chat/completions)
✅ NVIDIA mock got the DeepSeek V4 model (got "deepseek-ai/deepseek-v4-flash-0731")
✅ NVIDIA NIM provider round-trip ok (got "deepseek v4 from nvidia")
RESULT: 33 passed, 0 failed

$ cd server && npm test
EXIT=0 · 0 failed
```

## User's to-do (no card, no money — just sign in)
1. **NVIDIA NIM** → build.nvidia.com → sign up (email) → API Keys → Generate →
   paste key in Render as `NVIDIA_API_KEY` → **free DeepSeek V4 + Llama +
   Nemotron**.
2. **SambaNova** (optional, second free DeepSeek path) → cloud.sambanova.ai →
   sign up → `SAMBANOVA_API_KEY` in Render.
3. Redeploy. The app now has **seven** no-card free tiers:
   Groq · Gemini · OpenRouter free · Mistral · HuggingFace (DeepSeek/Qwen) ·
   NVIDIA NIM (DeepSeek V4) · SambaNova (DeepSeek V3) — plus self-hosted vLLM.

## Note
These commits (B72→B75) were already pushed to GitHub (`f50011d..HEAD`), so the
APK builder, Render backend, and GitHub Pages are rebuilding automatically.
