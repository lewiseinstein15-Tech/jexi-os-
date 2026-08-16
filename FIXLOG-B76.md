# FIXLOG-B76 — Live provider test + best-model-per-part selection

**Date:** 2026-08-16

## User request
"Done creating those api keys — now test them and choose the best models for
each part."

## Live test — real keys, real endpoint (deployed backend probe)

Probed `https://jexi-os-brain.onrender.com/api/health/providers` (fires one
tiny request through every configured provider) while the old build was live:

| Provider | Result | Meaning |
|---|---|---|
| Groq | ✅ OK | working |
| Gemini | ✅ OK | working |
| OpenRouter | ✅ OK | working |
| Mistral | ✅ OK | working |
| HuggingFace | ❌ HTTP 400 "Model not supported by provider hf-inference" | **endpoint changed** — HF retired the per-model TGI router path |
| Cerebras | ❌ 402 payment required | needs billing tab |
| DeepInfra | ❌ 402 need positive balance | needs top-up |
| xAI / Grok | ❌ 403 no credits/licenses | needs purchase |
| DeepSeek | ❌ 402 insufficient balance | needs top-up |

NVIDIA NIM / SambaNova keys can't be live-probed yet: the deployed build is
still pre-B75 (providers exist in code, not yet on the server) and the keys
need to reach the Render env. **Both endpoints + model catalogs are verified**
(`integrate.api.nvidia.com/v1/models` = 102 models incl. DeepSeek V4 Flash;
`api.sambanova.ai/v1/models` = DeepSeek-V3.1/V3.2 free).

## Best model per part (evidence-based)

| Coworker | Before (B73) | After (B76) | Why |
|---|---|---|---|
| **Memory / conversation** | nemotron-3-super-120b:free → seed → gemini | **gemini-2.5-flash → nemotron:free → seed** | Gemini live ✅ and its free tier is 1,500 RPD vs OpenRouter-free's 50 RPD — chat is the highest-volume path and can't live on a 50/day cap |
| **Researcher** | grok → groq 8b → seed → gemma | **groq llama-3.3-70b-versatile → groq 8b → seed → gemma → grok** | Groq 70B live ✅, on Groq's free tier (1,000 RPD), far better research quality; Grok (403) moved last so it never slows a task until funded |
| **Coder** | deepseek-chat → nvidia v4-flash → north-mini-code:free → seed | unchanged (B75) | free DeepSeek V4 via NVIDIA once the key lands |
| **Fallback** | vllm → huggingface → deepinfra → mistral | unchanged | mistral live ✅ |

## Fixes found by the live test

1. **HuggingFace endpoint fix** (`LLMClient.js`): HF retired
   `router.huggingface.co/hf-inference/models/<id>` (now 400 "Model not
   supported by provider hf-inference") in favour of an OpenAI-compatible
   gateway at `https://router.huggingface.co/v1/chat/completions`
   (live-verified 401 = valid). `tryHuggingFace` now uses the standard
   OpenAI-compatible caller against that URL — same free DeepSeek/Qwen models.
2. **In-app key entry for the new providers** (`SettingsPanel.jsx` +
   `server/index.js` `/api/settings/status`): NVIDIA NIM + SambaNova key
   fields, so the no-card keys can be pasted in the app (not only Render env).

## Verification (real output)
```
$ cd server && node test-worker-router.js
✅ memory worker primary = gemini(gemini-2.5-flash) — free tier, 1,500 RPD
✅ researcher primary = groq(llama-3.3-70b-versatile) — free tier
✅ grok stays reachable but last among the research providers
RESULT: 35 passed, 0 failed

$ cd server && npm test
SERVER EXIT=0 · 0 failed

$ npm run build
✓ built in 18.09s
```

## User's to-do (the keys are made — now point JEXI at them)
1. Render dashboard → jexi-os-brain → Environment → add:
   `NVIDIA_API_KEY` (from build.nvidia.com → API Keys) and
   `SAMBANOVA_API_KEY` (from cloud.sambanova.ai → API keys).
   (Or paste both into the app: Settings → the two new key fields.)
2. Deploy (Manual Deploy → Deploy latest commit — the B75/B76 code is pushed).
3. Tell me — I'll re-run the live probe and confirm the two new free tiers
   (DeepSeek V4 Flash via NVIDIA, DeepSeek V3 via SambaNova) show ✅.
