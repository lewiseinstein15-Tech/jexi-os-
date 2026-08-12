import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import { loadSettings } from './SettingsManager.js';
import { providerOrder, recordProviderSuccess, recordProviderFailure, configuredProviders } from './ProviderRouter.js';

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

// Seed-family (ByteDance) + free text models via OpenRouter. SeedRealtime
// itself has NO public API yet — it is free only inside the Doubao app — but
// the Seed 2.0 / 1.6 vision models and free text models are live today.
const OPENROUTER_VISION_MODELS = ['bytedance-seed/seed-2.0-mini', 'bytedance-seed/seed-1.6-flash'];
const OPENROUTER_TEXT_MODELS = ['bytedance-seed/seed-2.0-mini', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free'];

// Free text models on the HuggingFace Inference API (HF_TOKEN). Free tier is
// slow — these are a last-resort text provider, gated on the token.
const HF_TEXT_MODELS = ['microsoft/phi-4', 'HuggingFaceH4/zephyr-7b-beta', 'mistralai/Mistral-7B-Instruct-v0.3'];

// Free / no-card OpenAI-compatible providers (text only). Each is optional —
// a missing key is skipped entirely by the router; a failing one falls through
// to the next healthy provider and gets a 30s quarantine after 3 failures.
// Current Cerebras free-tier IDs (verified against inference-docs.cerebras.ai):
// gpt-oss-120b is the production flagship; gemma-4-31b is the multimodal preview.
// (llama-3.3-70b and llama3.1-8b were deprecated in 2026 → 404.)
const CEREBRAS_MODELS = ['gpt-oss-120b', 'gemma-4-31b']; // free tier, no card
const DEEPINFRA_MODELS = ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo'];
const MISTRAL_MODELS = ['open-mistral-7b', 'open-mixtral-8x7b']; // Experiment free tier

const TIMEOUT_MS = 90000;

/** Read the MIME type out of a data: URL (camera sends image/jpeg, uploads can be png/webp). */
export function mimeFromDataUrl(dataUrl) {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl || '');
  return m ? m[1] : 'image/png';
}

async function tryGroq(prompt, system, imageBase64, opts, errors) {
  const { groqKey } = resolveKeys();
  if (!groqKey) return null;
  const groq = new Groq({ apiKey: groqKey });
  const models = imageBase64 ? GROQ_VISION_MODELS : [opts.model || GROQ_TEXT_MODEL];
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
  const primary = opts.geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
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
  const models = imageBase64 ? OPENROUTER_VISION_MODELS : OPENROUTER_TEXT_MODELS;
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

/** HuggingFace free Inference API — text only, last-resort provider. */
async function tryHuggingFace(prompt, system, imageBase64, opts, errors) {
  if (imageBase64) return null; // HF free tier text-only here
  const { hfKey } = resolveKeys();
  if (!hfKey) return null;
  for (const model of HF_TEXT_MODELS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hfKey}`,
          },
          body: JSON.stringify({ inputs: `${system}\n\n${prompt}`, parameters: { max_new_tokens: 900, temperature: opts.temperature ?? 0.4 } }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          errors.push(`HF(${model}): HTTP ${res.status} ${body.slice(0, 100)}`);
          continue;
        }
        const data = await res.json();
        const text = Array.isArray(data) ? data?.[0]?.generated_text : data?.generated_text;
        if (typeof text === 'string' && text.trim()) {
          // Strip the echoed prompt prefix the inference API sometimes returns.
          return text.trim().replace(new RegExp(`^${system.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').replace(new RegExp(`^${prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').trim().slice(0, 6000) || text.trim().slice(0, 6000);
        }
        errors.push(`HF(${model}) returned an empty response`);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      errors.push(`HF(${model}): ${e.message}`);
      console.error('[LLMClient] HuggingFace failed:', e.message);
    }
  }
  return null;
}

/**
 * Generic OpenAI-compatible chat-completions caller — Cerebras, DeepInfra and
 * Mistral all expose the same REST shape, so one helper serves all three.
 * Text-only (vision stays on Groq/Gemini/OpenRouter).
 */
async function tryOpenAICompat({ key, baseUrl, models, label }, prompt, system, imageBase64, opts, errors) {
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
  tryOpenAICompat({ key: resolveKeys().cerebrasKey, baseUrl: 'https://api.cerebras.ai/v1', models: CEREBRAS_MODELS, label: 'Cerebras' }, p, s, img, o, e);
const tryDeepInfra = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().deepinfraKey, baseUrl: 'https://api.deepinfra.com/v1/openai', models: DEEPINFRA_MODELS, label: 'DeepInfra' }, p, s, img, o, e);
const tryMistral = (p, s, img, o, e) =>
  tryOpenAICompat({ key: resolveKeys().mistralKey, baseUrl: 'https://api.mistral.ai/v1', models: MISTRAL_MODELS, label: 'Mistral' }, p, s, img, o, e);

const PROVIDER_CALLS = {
  groq: tryGroq,
  gemini: tryGemini,
  openrouter: tryOpenRouter,
  huggingface: tryHuggingFace,
  cerebras: tryCerebras,
  deepinfra: tryDeepInfra,
  mistral: tryMistral,
};

/**
 * Generate text from the best available AI provider, walking the health-aware
 * ProviderRouter order (Groq → Gemini → OpenRouter → HuggingFace by default;
 * Gemini-first for code). Each provider's success/failure updates the router's
 * health state, so a provider that keeps failing drops to the back of the line.
 */
export async function generateContent(prompt, systemInstruction = '', imageBase64 = null, opts = {}) {
  const errors = [];
  const system = systemInstruction || 'You are JEXI OS, an expert AI operating system.';

  const prefer = opts.prefer || (imageBase64 ? 'gemini' : '');
  const order = providerOrder(prefer);

  for (const provider of order) {
    const call = PROVIDER_CALLS[provider];
    if (!call) continue;
    try {
      const text = await call(prompt, system, imageBase64, opts, errors);
      if (text) {
        recordProviderSuccess(provider);
        return text;
      }
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
    recordProviderFailure(provider);
  }

  const keys = Object.values(resolveKeys()).filter(Boolean);
  if (keys.length > 0) {
    throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
  }
  throw new Error('No API keys configured. Add a key in Settings (Groq, Gemini, OpenRouter, Cerebras, DeepInfra, Mistral or HuggingFace), or set the matching env var in Render.');
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
