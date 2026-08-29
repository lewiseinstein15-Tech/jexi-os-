import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import { loadSettings } from './SettingsManager.js';
import { providerOrder, recordProviderSuccess, recordProviderFailure, configuredProviders, markProviderUnavailable } from './ProviderRouter.js';
import { takeSlot, releaseSlot } from './ProviderRateLimiter.js'; // free-tier pacing
import { queryLocalLLM } from './OfflineAgent.js';
import { appendTimeContext } from './TimeContext.js'; // B104 — every LLM call knows the current date/time (dsh time-context)
import { withRetry } from './RetryPolicy.js'; // B133 — dsh llm-retry: backoff on 429/5xx/network

/**
 * Keys are resolved in this order:
 *  1. Environment variables (GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY / HF_TOKEN) — for Render / serverless
 *  2. settings.json (written by the Settings panel) — for local / self-hosted
 */
export function resolveKeys() {
  const settings = loadSettings();
  return {
    groqKey: process.env.GROQ_API_KEY || settings.groqKey || '',
    geminiKey: process.env.GEMINI_API_KEY || settings.geminiKey || '',
    openrouterKey: process.env.OPENROUTER_API_KEY || settings.openrouterKey || '',
    hfKey: process.env.HF_TOKEN || settings.hfKey || '',
    cerebrasKey: process.env.CEREBRAS_API_KEY || settings.cerebrasKey || '',
    deepinfraKey: process.env.DEEPINFRA_API_KEY || settings.deepinfraKey || '',
    mistralKey: process.env.MISTRAL_API_KEY || settings.mistralKey || '',
    xaiKey: process.env.XAI_API_KEY || settings.xaiKey || '',
    deepseekKey: process.env.DEEPSEEK_API_KEY || settings.deepseekKey || '',
    nvidiaKey: process.env.NVIDIA_API_KEY || settings.nvidiaKey || '',
    sambanovaKey: process.env.SAMBANOVA_API_KEY || settings.sambanovaKey || '',
  };
}

// --- Current, valid model names (verified against Google's docs, Aug 2026).
// gemini-1.5-flash-latest was REMOVED from the API (404) — never use it as primary.
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'; // multimodal, best price-performance
const GEMINI_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-1.5-flash'];

// Groq vision-capable models, tried in order when an image is attached.
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-3.2-11b-vision-preview',
];
const GROQ_TEXT_MODEL = 'llama-3.1-8b-instant';

// Seed-family (ByteDance) + FREE text models via OpenRouter. SeedRealtime
// itself has NO public API yet — it is free only inside the Doubao app — but
// the Seed 2.0 / 1.6 vision models and the free text models below are live
// today. B73: every entry live-verified against openrouter.ai/api/v1/models —
// the old llama-3.3-70b:free / deepseek-chat-v3-0324:free entries were
// REMOVED by OpenRouter (no longer in the model list → instant 404s).
const OPENROUTER_VISION_MODELS = ['bytedance-seed/seed-2.0-mini', 'bytedance-seed/seed-1.6-flash'];
const OPENROUTER_TEXT_MODELS = [
  'bytedance-seed/seed-2.0-mini',            // $0.10/M in — near-free workhorse, proven working
  'nvidia/nemotron-3-super-120b-a12b:free',  // $0 — 120B general model, tool calling, 262k ctx
  'cohere/north-mini-code:free',             // $0 — code-focused, tool calling
  'google/gemma-4-26b-a4b-it:free',          // $0 — general, tool calling
];

// Free text models on the HuggingFace Inference API (HF_TOKEN). Free tier is
// slow — these are a last-resort text provider, gated on the token. B73
// follow-up — free DeepSeek AND free Qwen live here (live-verified via
// router.huggingface.co/hf-inference/models/<id> → HTTP 401 "token needed"
// means the model is served free): DeepSeek's own API has no free tier and
// OpenRouter carries no free DeepSeek/Qwen, but HF serverless serves the
// DeepSeek open-weight releases (deepseek-coder, R1-distill) and Qwen2.5 for
// $0 with the existing HF_TOKEN.
const HF_TEXT_MODELS = [
  'Qwen/Qwen2.5-7B-Instruct',                  // free Qwen — general
  'deepseek-ai/deepseek-coder-6.7b-instruct',  // free DeepSeek — coding
  'Qwen/Qwen2.5-Coder-7B-Instruct',            // free Qwen — coding
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',   // free DeepSeek — reasoning
  'microsoft/phi-4',
  'HuggingFaceH4/zephyr-7b-beta',
  'mistralai/Mistral-7B-Instruct-v0.3',
];

// Free / no-card OpenAI-compatible providers (text only). Each is optional —
// a missing key is skipped entirely by the router; a failing one falls through
// to the next healthy provider and gets a 30s quarantine after 3 failures.
// Current Cerebras free-tier IDs (verified against inference-docs.cerebras.ai):
// gpt-oss-120b is the production flagship; gemma-4-31b is the multimodal preview.
// (llama-3.3-70b and llama3.1-8b were deprecated in 2026 → 404.)
const CEREBRAS_MODELS = ['gpt-oss-120b', 'gemma-4-31b']; // free tier, no card
const DEEPINFRA_MODELS = ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo'];
const MISTRAL_MODELS = ['open-mistral-7b', 'open-mixtral-8x7b']; // Experiment free tier

// Grok (xAI) — OpenAI-compatible at https://api.x.ai/v1. Current flagship
// grok-4.6 (verified against docs.x.ai/developers/models, Aug 2026); aliases
// like grok-4 auto-migrate, and grok-3 stays as a fallback for older keys.
const XAI_MODELS = ['grok-4.6', 'grok-4', 'grok-3'];

// DeepSeek (B66 — primary coding coworker). OpenAI-compatible at
// https://api.deepseek.com. deepseek-chat is the flagship reasoning chat
// model; deepseek-reasoner the chain-of-thought variant.
const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

// Qwen (B66 — memory coworker + coding fallback). B73 live-verified: there is
// NO free Qwen on OpenRouter anymore (qwen3-8b:free and qwen-2.5-72b:free were
// removed) and Groq's only Qwen (qwen3.6-27b) is PAID preview. Free Qwen runs
// through HuggingFace serverless inference (HF_TEXT_MODELS above). This list
// is documentation only — WorkerRouter routes Qwen needs through the HF tier.
export const QWEN_MODELS = ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-Coder-7B-Instruct'];

// B73 — exported so the regression suite can guard the free-model wiring
// (no dead :free models, genuinely-free entries present).
export const OPENROUTER_FREE_TEXT_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'cohere/north-mini-code:free', 'google/gemma-4-26b-a4b-it:free'];
export const HF_FREE_QWEN_MODELS = ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-Coder-7B-Instruct'];
// B73 follow-up — free DeepSeek on the HF serverless tier (live-verified 401).
export const HF_FREE_DEEPSEEK_MODELS = ['deepseek-ai/deepseek-coder-6.7b-instruct', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B'];

// B75 — no-card free AI providers (research: GitHub Models was RETIRED on
// 2026-07-30, so the no-card frontier tier is NVIDIA NIM + SambaNova + the
// already-wired Groq/Gemini/OpenRouter/Mistral/HF).
//
// NVIDIA NIM (build.nvidia.com): free NVIDIA Developer Program key, ~1,000
// inference credits (1 credit ≈ 1 call), 40 RPM, NO credit card. Live-verified
// against integrate.api.nvidia.com/v1/models (102 models) — DeepSeek V4 Flash
// (a FREE DeepSeek!), Llama 3.3, Nemotron 3, Gemma 4.
const NVIDIA_MODELS = [
  'deepseek-ai/deepseek-v4-flash-0731',   // free DeepSeek V4 Flash
  'meta/llama-3.3-70b-instruct',
  'nvidia/nemotron-3-super-120b-a12b',
  'google/gemma-4-31b-it',
];
// SambaNova (cloud.sambanova.ai): free tier, NO credit card, 20 RPM / 200K
// TPD. Live-verified /v1/models — DeepSeek-V3.1/V3.2 are on the free tier
// (another free DeepSeek path), plus Llama 3.3, gpt-oss-120b, MiniMax-M2.7.
const SAMBANOVA_MODELS = [
  'DeepSeek-V3.1',
  'DeepSeek-V3.2',
  'Meta-Llama-3.3-70B-Instruct',
  'gpt-oss-120b',
];

const TIMEOUT_MS = 90000;

// Groq's free embedding model — rides the same GROQ_API_KEY, no extra key.
// Used by MemoryManager for vector recall (TencentDB-Agent-Memory pattern).
const EMBED_MODEL = 'nomic-embed-text-v1.5';
const embedCache = new Map();
const EMBED_CACHE_MAX = 2000;

/**
 * Embed a text with Groq's nomic-embed-text-v1.5 (cached). Returns a number[]
 * or null — null on any failure or when no Groq key is set, so memory retrieval
 * always falls back to keyword matching and never breaks because of embeddings.
 */
export async function embedText(text) {
  const clean = String(text || '').trim().slice(0, 8000);
  if (!clean) return null;
  if (embedCache.has(clean)) return embedCache.get(clean);
  const { groqKey } = resolveKeys();
  if (!groqKey) return null;
  try {
    const groq = new Groq({ apiKey: groqKey });
    const res = await groq.embeddings.create({ model: EMBED_MODEL, input: clean });
    const vec = res?.data?.[0]?.embedding;
    if (Array.isArray(vec) && vec.length) {
      if (embedCache.size >= EMBED_CACHE_MAX) {
        const oldest = embedCache.keys().next().value;
        if (oldest !== undefined) embedCache.delete(oldest);
      }
      embedCache.set(clean, vec);
      return vec;
    }
  } catch (e) {
    // quiet — embeddings are an enhancement, never a hard dependency
  }
  return null;
}

/** Read the MIME type out of a data: URL (camera sends image/jpeg, uploads can be png/webp). */
export function mimeFromDataUrl(dataUrl) {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl || '');
  return m ? m[1] : 'image/png';
}

async function tryGroq(prompt, system, imageBase64, opts, errors) {
  const { groqKey } = resolveKeys();
  if (!groqKey) return null;
  const groq = new Groq({ apiKey: groqKey });
  const models = imageBase64 ? GROQ_VISION_MODELS : (opts.model ? [opts.model] : [GROQ_TEXT_MODEL]);
  for (const model of models) {
    try {
      const messages = [
        { role: 'system', content: system },
        {
          role: 'user',
          content: imageBase64
            ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageBase64 } }]
            : prompt,
        },
      ];
      const completion = await groq.chat.completions.create(
        {
          messages,
          model,
          temperature: opts.temperature ?? 0.4,
        },
        { timeout: TIMEOUT_MS } // request option — the API rejects 'timeout' inside the body
      );
      const text = completion.choices[0]?.message?.content || '';
      if (text) return text.trim();
      errors.push(`Groq(${model}) returned an empty response`);
    } catch (e) {
      errors.push(`Groq(${model}): ${e.message}`);
      console.error('[LLMClient] Groq failed:', e.message);
    }
  }
  return null;
}

async function tryGemini(prompt, system, imageBase64, opts, errors) {
  const { geminiKey } = resolveKeys();
  if (!geminiKey) return null;
  const genAI = new GoogleGenerativeAI(geminiKey);
  const primary = opts.model || opts.geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const candidates = [primary, ...GEMINI_FALLBACK_MODELS.filter(m => m !== primary)].slice(0, 4);
  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: system, requestOptions: { timeout: TIMEOUT_MS } });
      const parts = [{ text: prompt }];
      if (imageBase64) {
        parts.push({
          inlineData: {
            data: imageBase64.split(',')[1] || imageBase64,
            mimeType: mimeFromDataUrl(imageBase64),
          },
        });
      }
      // B162b — NATIVE Gemini streaming: when the caller wants live deltas,
      // stream them (with provider+model meta so the UI can name the
      // coworker). Falls through to the plain call on any stream failure.
      if (typeof opts.onToken === 'function' && !imageBase64) {
        try {
          const stream = await model.generateContentStream(parts);
          let streamed = '';
          for await (const chunk of stream.stream) {
            const piece = (typeof chunk.text === 'function' ? chunk.text() : '') || '';
            if (!piece) continue;
            streamed += piece;
            try { opts.onToken(piece, { provider: 'gemini', model: modelName }); } catch { /* consumer must never break the stream */ }
          }
          if (streamed.trim()) return streamed.trim();
          errors.push(`Gemini(${modelName}) streamed an empty response`);
        } catch (e) {
          errors.push(`Gemini(${modelName}) stream failed: ${e.message}`);
        }
      }
      const result = await model.generateContent(parts);
      const text = result.response.text();
      if (text) return text.trim();
      errors.push(`Gemini(${modelName}) returned an empty response`);
    } catch (e) {
      errors.push(`Gemini(${modelName}): ${e.message}`);
      console.error('[LLMClient] Gemini failed:', e.message);
    }
  }
  return null;
}

/** OpenRouter — text AND vision (Seed family + free text models). */
async function tryOpenRouter(prompt, system, imageBase64, opts, errors) {
  const { openrouterKey } = resolveKeys();
  if (!openrouterKey) return null;
  const models = imageBase64 ? OPENROUTER_VISION_MODELS : (opts.model ? [opts.model] : OPENROUTER_TEXT_MODELS);
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const content = imageBase64
          ? [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64 } },
            ]
          : prompt;
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openrouterKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content },
            ],
            temperature: opts.temperature ?? 0.4,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          errors.push(`OpenRouter(${model}): HTTP ${res.status} ${body.slice(0, 120)}`);
          continue;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (text) return text.trim();
        errors.push(`OpenRouter(${model}) returned an empty response`);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      errors.push(`OpenRouter(${model}): ${e.message}`);
      console.error('[LLMClient] OpenRouter failed:', e.message);
    }
  }
  return null;
}

/**
 * HuggingFace free Inference API — text only, last-resort provider.
 *
 * B75b — endpoint fix found by the LIVE probe (deployed backend): HF retired
 * the per-model TGI endpoints on the router (`/hf-inference/models/<id>` now
 * returns 400 "Model not supported by provider hf-inference") and replaced
 * them with an OpenAI-compatible gateway at `https://router.huggingface.co/v1`
 * (chat/completions, live-verified 401 = valid endpoint). Free users get a
 * small monthly credit meter (Inference Providers pool). Same model IDs, now
 * through the standard OpenAI-compatible caller.
 */
const tryHuggingFace = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().hfKey, baseUrl: 'https://router.huggingface.co/v1', models: o.model ? [o.model] : HF_TEXT_MODELS, label: 'HuggingFace', providerKey: 'huggingface' }, p, s, img, o, e);

/**
 * Generic OpenAI-compatible chat-completions caller — Cerebras, DeepInfra and
 * Mistral all expose the same REST shape, so one helper serves all three.
 * Text-only (vision stays on Groq/Gemini/OpenRouter).
 */
async function tryOpenAICompat({ key, baseUrl, models, label, providerKey = '' }, prompt, system, imageBase64, opts, errors) {
  if (imageBase64) return null;
  if (!key) return null;
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            temperature: opts.temperature ?? 0.4,
            max_tokens: 1600,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          // 402 payment-required → the account can't use this provider at all.
          // Park it for an hour so it stops slowing down every request.
          if (res.status === 402 && providerKey) markProviderUnavailable(providerKey, 60);
          errors.push(`${label}(${model}): HTTP ${res.status} ${body.slice(0, 120)}`);
          continue;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (text) return text.trim();
        errors.push(`${label}(${model}) returned an empty response`);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      errors.push(`${label}(${model}): ${e.message}`);
      console.error(`[LLMClient] ${label} failed:`, e.message);
    }
  }
  return null;
}

const tryCerebras = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().cerebrasKey, baseUrl: 'https://api.cerebras.ai/v1', models: o.model ? [o.model] : CEREBRAS_MODELS, label: 'Cerebras', providerKey: 'cerebras' }, p, s, img, o, e);
const tryDeepInfra = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().deepinfraKey, baseUrl: 'https://api.deepinfra.com/v1/openai', models: o.model ? [o.model] : DEEPINFRA_MODELS, label: 'DeepInfra', providerKey: 'deepinfra' }, p, s, img, o, e);
const tryMistral = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().mistralKey, baseUrl: 'https://api.mistral.ai/v1', models: o.model ? [o.model] : MISTRAL_MODELS, label: 'Mistral', providerKey: 'mistral' }, p, s, img, o, e);
const tryXai = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().xaiKey, baseUrl: 'https://api.x.ai/v1', models: o.model ? [o.model] : XAI_MODELS, label: 'Grok', providerKey: 'xai' }, p, s, img, o, e);
// B66 — DeepSeek: primary coding coworker (model forced via opts.model).
const tryDeepSeek = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().deepseekKey, baseUrl: 'https://api.deepseek.com/v1', models: o.model ? [o.model] : DEEPSEEK_MODELS, label: 'DeepSeek', providerKey: 'deepseek' }, p, s, img, o, e);
// B75 — NVIDIA NIM: no-card free key, OpenAI-compatible at
// https://integrate.api.nvidia.com/v1 (live-verified endpoint + model IDs).
// NVIDIA_API_URL is a test seam (mirrors VLLM_BASE_URL) so the regression
// suite can point the provider at a mock server.
const tryNvidia = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().nvidiaKey, baseUrl: process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1', models: o.model ? [o.model] : NVIDIA_MODELS, label: 'NVIDIA NIM', providerKey: 'nvidia' }, p, s, img, o, e);
// B75 — SambaNova: no-card free tier (DeepSeek-V3.1/V3.2 free), OpenAI-
// compatible at https://api.sambanova.ai/v1 (live-verified).
const trySambaNova = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().sambanovaKey, baseUrl: 'https://api.sambanova.ai/v1', models: o.model ? [o.model] : SAMBANOVA_MODELS, label: 'SambaNova', providerKey: 'sambanova' }, p, s, img, o, e);

/**
 * vLLM (B74) — self-hosted, OpenAI-compatible inference
 * (github.com/vllm-project/vllm). A local `vllm serve <model>` exposes
 * /v1/chat/completions, so JEXI routes to a genuinely-FREE backend on the
 * user's own hardware — no API key, no per-token cost. Enabled by default at
 * http://localhost:8000/v1 (vLLM's server port); override with VLLM_BASE_URL,
 * pin the served model with VLLM_MODEL, and optionally set VLLM_API_KEY (for
 * `vllm serve --api-key`). Env is read at CALL time (not module load) so
 * tests can point it at a mock server. When nothing listens, the connection
 * is refused instantly and the walk continues — zero effective cost.
 */
async function tryVllm(prompt, system, imageBase64, opts, errors) {
  if (imageBase64) return null; // text-only — vision stays on hosted providers
  const base = String(process.env.VLLM_BASE_URL || 'http://localhost:8000/v1').replace(/\/+$/, '');
  const model = opts.model || process.env.VLLM_MODEL || 'default';
  const apiKey = process.env.VLLM_API_KEY || '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: opts.temperature ?? 0.4,
          max_tokens: 1600,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        errors.push(`vLLM: HTTP ${res.status} ${b.slice(0, 120)}`);
        return null;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (text) return text.trim();
      errors.push('vLLM returned an empty response');
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    errors.push(`vLLM: ${e.message}`);
  }
  return null;
}

const PROVIDER_CALLS = {
  groq: tryGroq,
  gemini: tryGemini,
  openrouter: tryOpenRouter,
  huggingface: tryHuggingFace,
  cerebras: tryCerebras,
  deepinfra: tryDeepInfra,
  mistral: tryMistral,
  xai: tryXai,
  deepseek: tryDeepSeek,
  nvidia: tryNvidia,
  sambanova: trySambaNova,
  vllm: tryVllm,
};

/**
 * Generate text from the best available AI provider, walking the health-aware
 * ProviderRouter order (Groq → Gemini → OpenRouter → HuggingFace by default;
 * Gemini-first for code). Each provider's success/failure updates the router's
 * health state, so a provider that keeps failing drops to the back of the line.
 *
 * B66 — worker selection: `opts.provider` restricts the walk to ONE provider
 * and `opts.model` forces a specific model on it. This is how the
 * Orchestrator-Workers router assigns exact models per coworker (DeepSeek
 * for coding, Qwen for memory, Grok for research…) instead of only
 * reordering a preference list.
 */
/**
 * B150 — streamed plain-text generation (OpenAI-compatible walk). Returns
 * the full text while feeding deltas to onDelta; null when nothing streams.
 */
async function streamPlainText(prompt, system, opts, onDelta) {
  const errors = [];
  const order = opts.provider ? [opts.provider] : providerOrder(opts.prefer || '');
  for (const provider of order) {
    const cfg = providerToolConfig(provider, opts);
    if (!cfg || !cfg.key) continue;
    const base = cfg.baseUrl || (provider === 'groq' ? 'https://api.groq.com/openai/v1' : null);
    if (!base) continue;
    const slot = await takeSlot(provider);
    if (!slot.ok) { errors.push(`${provider}: ${slot.reason} (rate limiter)`); continue; }
    try {
      const __st0 = Date.now(); // B172 — stream duration feeds speed routing
      const out = await streamOpenAICompletion({
        baseUrl: base, key: cfg.key, model: cfg.models[0],
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        tools: [], temperature: opts.temperature ?? 0.4,
        // B162 — deltas carry the provider+model so the UI can name the coworker
        onDelta: (t) => onDelta(t, { provider, model: cfg.models[0] }), signal: opts.signal,
      });
      out.tookMs = Date.now() - __st0;
      if (out.text) {
        recordProviderSuccess(provider, out.tookMs);
        releaseSlot();
        return out.text;
      }
    } catch (e) { errors.push(`${provider}: ${e.message}`); }
    recordProviderFailure(provider);
    releaseSlot();
  }
  return null;
}

export async function generateContent(prompt, systemInstruction = '', imageBase64 = null, opts = {}) {
  systemInstruction = appendTimeContext(systemInstruction); // B104 — time context on every call
  // B150 — live token streaming when requested (the UI shows the answer as
  // it is generated instead of a blank wait). Falls back on any failure.
  let streamedAny = false; // B162b — has any delta reached the consumer yet?
  if (typeof opts.onToken === 'function' && !imageBase64) {
    const streamed = await streamPlainText(prompt, systemInstruction, opts, (t, meta) => {
      streamedAny = true;
      opts.onToken(t, meta);
    });
    if (streamed) return streamed;
  }
  const errors = [];
  const system = systemInstruction || 'You are JEXI OS, an expert AI operating system.';

  const prefer = opts.prefer || (imageBase64 ? 'gemini' : '');
  const order = opts.provider ? [opts.provider] : providerOrder(prefer);

  for (const provider of order) {
    const call = PROVIDER_CALLS[provider];
    if (!call) continue;
    // Free-tier pacing: wait for the provider's rate slot (bounded). When
    // throttled for too long, slide to the next healthy provider.
    const slot = await takeSlot(provider);
    if (!slot.ok) {
      errors.push(`${provider}: ${slot.reason} (rate limiter)`);
      continue;
    }
    try {
      const __t0 = Date.now(); // B172 — measure real latency for speed routing
      const text = await call(prompt, system, imageBase64, opts, errors);
      if (text) {
        recordProviderSuccess(provider, Date.now() - __t0);
        releaseSlot();
        // B162b — if this provider answered WITHOUT streaming deltas (SDK
        // paths), emit the whole text once WITH provider+model meta: the UI
        // still gets the ✍️ writer step + named header instead of silence.
        if (typeof opts.onToken === 'function' && !streamedAny) {
          streamedAny = true;
          try { opts.onToken(text, { provider, model: opts.model || null }); } catch { /* never break */ }
        }
        return text;
      }
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
    recordProviderFailure(provider);
    releaseSlot();
  }

  const keys = Object.values(resolveKeys()).filter(Boolean);
  if (keys.length > 0) {
    throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
  }
  throw new Error('No API keys configured. Add a key in Settings (Groq, Gemini, OpenRouter, Cerebras, DeepInfra, Mistral, Grok, DeepSeek or HuggingFace), or set the matching env var in Render.');
}

/** Ask the LLM a yes/no or one-word verification question. */
export async function verifyWithLLM(prompt) {
  try {
    const answer = await generateContent(prompt, 'You are a strict QA agent. Answer only with YES or NO.');
    return String(answer || '').toUpperCase().includes('YES');
  } catch (e) {
    return false;
  }
}

/**
 * LIVE provider test — fire one tiny request through a SINGLE provider and
 * report whether the key actually works end-to-end (configured ≠ working).
 * Never falls through to other providers: this is a direct probe.
 */
export async function testProvider(providerKey) {
  const call = PROVIDER_CALLS[providerKey];
  if (!call) return { provider: providerKey, ok: false, error: 'Unknown provider' };
  const errors = [];
  try {
    const text = await call(
      'Reply with exactly one word: OK',
      'You are a connectivity test. Reply with exactly one word: OK.',
      null,
      { temperature: 0 },
      errors
    );
    if (text) return { provider: providerKey, ok: true, error: '' };
    return { provider: providerKey, ok: false, error: errors.join(' | ') || 'Empty response' };
  } catch (e) {
    return { provider: providerKey, ok: false, error: e.message || String(e) };
  }
}

/** Test every provider that has a key configured (one tiny call each). */
export async function testAllProviders() {
  const configured = configuredProviders();
  const results = await Promise.all(configured.map((k) => testProvider(k)));
  const configuredCount = configured.length;
  const working = results.filter((r) => r.ok).length;
  return { tested: results, configured: configuredCount, working, total: Object.keys(PROVIDER_CALLS).length };
}

/* ------------------------------------------------------------------ */
/* B66 — Orchestrator-Workers: native tool-calling (function calling).  */
/*                                                                     */
/* Replaces the JSON-in-prose tool extraction in AgentLoop.js for the   */
/* orchestrator path: the model declares REAL tool_calls through the    */
/* provider's native API (Groq, OpenRouter, DeepSeek, xAI, Cerebras,    */
/* DeepInfra, Mistral are all OpenAI-compatible; Gemini/HF are text-    */
/* only here and are skipped for tool calling).                        */
/* ------------------------------------------------------------------ */

const TOOL_CAPABLE = new Set(['groq', 'openrouter', 'deepseek', 'xai', 'cerebras', 'deepinfra', 'mistral']);

/**
 * Parse a provider's tool_calls into { id, name, arguments }. The id is
 * KEPT (B67) because a native loop must echo it back as tool_call_id when
 * feeding tool results to the next round.
 */
function parseToolCalls(msg) {
  return (msg?.tool_calls || [])
    .filter((tc) => tc && tc.function)
    .map((tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { /* keep {} */ }
      return { id: tc.id || null, name: tc.function.name || '', arguments: args };
    })
    .filter((tc) => tc.name);
}

/** Per-provider connection config for native tool calling (OpenAI-compatible). */
function providerToolConfig(provider, opts) {
  const keys = resolveKeys();
  return {
    groq: { key: keys.groqKey, baseUrl: null, sdk: true, models: [opts.model || GROQ_TEXT_MODEL] },
    openrouter: { key: keys.openrouterKey, baseUrl: 'https://openrouter.ai/api/v1', models: [opts.model || OPENROUTER_TEXT_MODELS[0]] },
    deepseek: { key: keys.deepseekKey, baseUrl: 'https://api.deepseek.com/v1', models: [opts.model || 'deepseek-chat'] },
    xai: { key: keys.xaiKey, baseUrl: 'https://api.x.ai/v1', models: [opts.model || XAI_MODELS[0]] },
    cerebras: { key: keys.cerebrasKey, baseUrl: 'https://api.cerebras.ai/v1', models: [opts.model || CEREBRAS_MODELS[0]] },
    deepinfra: { key: keys.deepinfraKey, baseUrl: 'https://api.deepinfra.com/v1/openai', models: [opts.model || DEEPINFRA_MODELS[0]] },
    mistral: { key: keys.mistralKey, baseUrl: 'https://api.mistral.ai/v1', models: [opts.model || MISTRAL_MODELS[0]] },
    // B166 — the FREE DeepSeek lanes (email-only signup, no card). The coder
    // chain already leads with these; the tool loop can finally reach them.
    nvidia: { key: keys.nvidiaKey, baseUrl: process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1', models: [opts.model || NVIDIA_MODELS[0]] },
    sambanova: { key: keys.sambanovaKey, baseUrl: 'https://api.sambanova.ai/v1', models: [opts.model || SAMBANOVA_MODELS[0]] },
  }[provider];
}

/**
 * B150 — TOKEN STREAMING (dsh llm/stream mirror): OpenAI-compatible SSE
 * stream for chat/completions. Accumulates text + tool_calls deltas and
 * calls onDelta(text) per chunk so the UI renders the answer live.
 */
async function streamOpenAICompletion({ baseUrl, key, model, messages, tools, temperature, onDelta, signal }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let doneRead = false;
  try {
    const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
        temperature: temperature ?? 0.3,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const b = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${b.slice(0, 120)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    const rawToolCalls = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') { doneRead = true; break; }
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        const delta = json && json.choices && json.choices[0] && json.choices[0].delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          try { onDelta(delta.content); } catch { /* a consumer must never break the stream */ }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? rawToolCalls.length;
            if (!rawToolCalls[idx]) rawToolCalls[idx] = { id: `call_${idx}`, type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) rawToolCalls[idx].id = tc.id;
            if (tc.function && tc.function.name) rawToolCalls[idx].function.name += tc.function.name;
            if (tc.function && tc.function.arguments) rawToolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
      if (doneRead) break;
    }
    const msg = { content: text || null, ...(rawToolCalls.length ? { tool_calls: rawToolCalls } : {}) };
    return { text, toolCalls: parseToolCalls(msg), rawToolCalls, model };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * ONE native tool-calling request against one provider with a full message
 * history. Returns { text, toolCalls, rawToolCalls, model } or throws (the
 * caller decides provider/model fallback). rawToolCalls are the API's own
 * tool_calls objects — replayed verbatim into the next round's messages.
 */
async function chatWithToolsOnce(provider, cfg, model, messages, tools, opts) {
  // B150 — token streaming: when the caller wants live deltas, use the SSE
  // path (every OpenAI-compatible provider, incl. Groq over REST).
  if (typeof opts.onToken === 'function') {
    const base = cfg.baseUrl || (provider === 'groq' ? 'https://api.groq.com/openai/v1' : null);
    if (base && cfg.key) {
      return streamOpenAICompletion({
        baseUrl: base, key: cfg.key, model, messages, tools,
        temperature: opts.temperature,
        // B162 — deltas carry the provider+model so the UI can name the coworker
        onDelta: (t) => opts.onToken(t, { provider, model }), signal: opts.signal,
      });
    }
  }
  if (cfg.sdk) {
    const groq = new Groq({ apiKey: cfg.key });
    const completion = await groq.chat.completions.create(
      { messages, model, tools, tool_choice: 'auto', temperature: opts.temperature ?? 0.3 },
      { timeout: TIMEOUT_MS }
    );
    const msg = completion.choices?.[0]?.message;
    return { text: (msg && msg.content) || '', toolCalls: parseToolCalls(msg), rawToolCalls: msg?.tool_calls || [], model };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await withRetry(() => fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: opts.temperature ?? 0.3 }),
      signal: controller.signal,
    }), { attempts: 3 });
    if (!res.ok) {
      const b = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${b.slice(0, 120)}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    return { text: (msg && msg.content) || '', toolCalls: parseToolCalls(msg), rawToolCalls: msg?.tool_calls || [], model };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * B67 — the REAL native tool loop for one provider. Round after round:
 *   generate (provider may emit tool_calls) → execute (opts.executeToolCalls)
 *   → feed results back → generate again — until the model answers directly
 *   or the bounded maxIterations is reached. If the provider fails, null is
 *   returned so the caller's provider walk falls through to the next one
 *   (B66 3e graceful degradation, now inside tool calling too).
 */
async function runToolLoopForProvider(provider, messages, tools, opts, errors) {
  const cfg = providerToolConfig(provider, opts);
  if (!cfg || !cfg.key) return null;
  const maxIter = Math.max(1, opts.maxIterations || 6);
  let model = null;
  const allCalls = [];
  let finalText = '';
  let iterations = 0;

  for (let i = 0; i < maxIter; i++) {
    if (opts.signal && opts.signal.aborted) break;
    iterations++;
    // First round picks the first working model; later rounds pin it so the
    // loop doesn't hop mid-conversation (tool results stay coherent).
    const candidates = model ? [model] : cfg.models;
    let round = null;
    let lastErr = null;
    for (const m of candidates) {
      try {
        round = await chatWithToolsOnce(provider, cfg, m, messages, tools, { ...opts, onToken: opts.onToken });
        model = m;
        break;
      } catch (e) {
        lastErr = e;
        errors.push(`${provider}(${m}): ${e.message}`);
      }
    }
    if (!round) {
      errors.push(`${provider}: ${(lastErr && lastErr.message) || 'all models failed'}`);
      return null; // provider failed → outer walk tries the next provider
    }

    if (!round.toolCalls.length) {
      finalText = round.text;
      break; // model answered directly — loop done
    }

    allCalls.push(...round.toolCalls);
    const results = typeof opts.executeToolCalls === 'function'
      ? await opts.executeToolCalls(round.toolCalls).catch((e) => [{ tool_call_id: null, content: `EXECUTION ERROR: ${(e && e.message) || e}` }])
      : [];

    // Feed the assistant's tool_calls and the real results back as messages.
    messages.push({ role: 'assistant', content: round.text || null, tool_calls: round.rawToolCalls });
    for (const r of results) {
      messages.push({ role: 'tool', tool_call_id: r.tool_call_id || `call_${allCalls.length}`, content: String(r.content ?? '').slice(0, 12000) });
    }
    // Nothing executed (no executor / all calls failed) — stop looping instead
    // of letting the model re-call tools forever.
    if (!results.length) { finalText = String(round.text || ''); break; }
  }

  if (!finalText && !allCalls.length) return null;
  return { text: String(finalText || '').trim(), toolCalls: allCalls, model, iterations };
}

/**
 * Native function-calling LOOP (B67). `tools` are OpenAI-style schemas:
 *   [{ type: 'function', function: { name, description, parameters } }]
 * `opts.executeToolCalls(calls)` runs the declared tool calls for real and
 * returns [{ tool_call_id, content }] which are fed back to the model; the
 * loop repeats until the model answers directly or maxIterations (default 6).
 * Returns { ok, provider, model, text, toolCalls: [{id,name,arguments}], iterations }.
 * `opts.provider` pins the walk to one provider (worker assignment); otherwise
 * the health-aware order is used, skipping non-tool providers.
 * Test seam (same pattern as AgentLoop's __mockAnswer): `opts.__mockCompletions`
 * is an array of { text, toolCalls } rounds that drive the loop deterministically.
 */
/**
 * B105 — accept BOTH OpenAI-style schemas and JEXI def-shaped tools
 * ({ slug, name, desc, schema|args }): providers only accept the OpenAI
 * shape, and def-shaped lists (SIMPLE_TOOL_DEFS, plugin tools) were being
 * sent raw — silently killing tool calling in those paths.
 */
export function normalizeTools(tools) {
  return (tools || [])
    .map((t) => {
      if (!t) return null;
      if (t.type === 'function' && t.function) return t; // already OpenAI-shaped
      if (!t.slug) return null;
      const schema = t.schema || t.args;
      const properties = {};
      const required = [];
      for (const [k, spec] of Object.entries(schema || {})) {
        const type = spec && spec.type === 'number' ? 'number' : spec && spec.type === 'array' ? 'array' : spec && spec.type === 'object' ? 'object' : 'string';
        properties[k] = { type, description: (spec && spec.desc) || '' };
        if (spec && spec.required) required.push(k);
      }
      return {
        type: 'function',
        function: {
          name: t.slug,
          description: String(t.desc || t.name || t.slug).slice(0, 500),
          parameters: { type: 'object', properties, required },
        },
      };
    })
    .filter(Boolean);
}

export async function generateWithToolsLoop(prompt, systemInstruction = '', tools = [], opts = {}) {
  systemInstruction = appendTimeContext(systemInstruction); // B104 — time context on every call
  tools = normalizeTools(tools); // B105 — def-shaped tool lists become provider-ready schemas
  const errors = [];
  const system = systemInstruction || 'You are JEXI OS, an expert AI operating system.';

  if (Array.isArray(opts.__mockCompletions) && opts.__mockCompletions.length) {
    const allCalls = [];
    let finalText = '';
    let iterations = 0;
    for (const round of opts.__mockCompletions) {
      iterations++;
      if (Array.isArray(round.toolCalls) && round.toolCalls.length) {
        allCalls.push(...round.toolCalls);
        const results = typeof opts.executeToolCalls === 'function' ? await opts.executeToolCalls(round.toolCalls) : [];
        if (!results.length) { finalText = String(round.text || ''); break; }
      } else {
        finalText = String(round.text || '');
        break;
      }
    }
    return { ok: true, provider: 'mock', model: null, text: String(finalText || '').trim(), toolCalls: allCalls, iterations };
  }

  const order = opts.provider ? [opts.provider] : providerOrder(opts.prefer || '');
  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  for (const provider of order) {
    if (!TOOL_CAPABLE.has(provider)) continue;
    // Free-tier pacing (same as generateContent).
    const slot = await takeSlot(provider);
    if (!slot.ok) {
      errors.push(`${provider}: ${slot.reason} (rate limiter)`);
      continue;
    }
    try {
      const res = await runToolLoopForProvider(provider, messages, tools, opts, errors);
      if (res) {
        recordProviderSuccess(provider);
        releaseSlot();
        return { ok: true, provider, model: res.model || null, text: res.text, toolCalls: res.toolCalls, iterations: res.iterations };
      }
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
    recordProviderFailure(provider);
    releaseSlot();
  }

  // B92 — PLAIN-TEXT FALLBACK: tool calling failed (rate limits, cooldowns,
  // provider quirks). For most tasks the tools are an enhancement, not a
  // requirement — a direct answer is far better than a hard failure. Retry
  // the walk with NO tools (plain generation) and mark it so callers know.
  if (opts.fallbackToPlainText !== false) {
    const fallbackErrors = [];
    for (const provider of order) {
      const call = PROVIDER_CALLS[provider];
      if (!call) continue;
      const slot = await takeSlot(provider);
      if (!slot.ok) { fallbackErrors.push(`${provider}: ${slot.reason} (rate limiter)`); continue; }
      try {
        const text = await call(prompt, system, null, { ...opts, prefer: opts.prefer }, fallbackErrors);
        if (text) {
          recordProviderSuccess(provider);
          releaseSlot();
          return { ok: true, provider, model: null, text: String(text).trim(), toolCalls: [], iterations: 1, fallback: 'plain-text' };
        }
      } catch (e) {
        fallbackErrors.push(`${provider}: ${e.message}`);
      }
      recordProviderFailure(provider);
      releaseSlot();
    }
  }

  throw new Error(`All AI providers failed for tool calling. ${errors.join(' | ') || 'no tool-capable provider configured'}`);
}

/**
 * Native function-calling generation (single round). Kept as a thin wrapper
 * over the loop for callers that only need one shot — the loop with
 * maxIterations 1 and no executor returns toolCalls un-executed, same
 * contract as before.
 */
export async function generateWithTools(prompt, systemInstruction = '', tools = [], opts = {}) {
  return generateWithToolsLoop(prompt, systemInstruction, tools, { ...opts, maxIterations: 1 });
}

/* ------------------------------------------------------------------ */
/* B66 — graceful degradation. generateContentSafe NEVER throws: on a   */
/* total provider failure it tries the local backend (OfflineAgent,     */
/* OLLAMA_BASE_URL) and only then returns an honest, readable degraded  */
/* message instead of a raw "All AI providers failed" error.            */
/* ------------------------------------------------------------------ */

function honestDegradedMessage(reason) {
  const r = String(reason || '').slice(0, 400);
  return `### ⚠ JEXI OS — degraded mode\n\nI'm having trouble reaching my usual AI resources right now${r ? ` (${r})` : ''}. This means I can't produce a full, thoughtful answer at the moment — no provider completed the request.\n\nWhat you can do:\n- Try again in a minute or two — rate limits and temporary outages usually clear quickly.\n- Check that your model keys are valid in **Settings → Models** (and the matching env vars on Render).\n- If you run a local model (Ollama), set \`OLLAMA_BASE_URL\`, or a self-hosted **vLLM** server with \`VLLM_BASE_URL\` (default http://localhost:8000/v1) — I'll route through it automatically.\n\nI'm not going to guess or pretend — that's the honest status right now.`;
}

/**
 * Never-throw generateContent. Returns { ok, text, degraded } — on total
 * failure: { ok: false, degraded: true, error, text: honestDegradedMessage }.
 */
export async function generateContentSafe(prompt, systemInstruction = '', imageBase64 = null, opts = {}) {
  try {
    const text = await generateContent(prompt, systemInstruction, imageBase64, opts);
    return { ok: true, text: String(text || '').trim(), degraded: false };
  } catch (e) {
    const reason = (e && e.message) || String(e);
    try {
      const local = await queryLocalLLM(String(prompt || '').slice(0, 6000), {});
      if (local && local.ok && local.text) {
        return { ok: true, text: String(local.text).trim(), degraded: true, local: true, provider: 'local' };
      }
    } catch (err) { /* fall through to the honest message */ }
    return { ok: false, degraded: true, error: reason, text: honestDegradedMessage(reason) };
  }
}
