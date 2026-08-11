import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import { loadSettings } from './SettingsManager.js';

/**
 * Keys are resolved in this order:
 *  1. Environment variables (GROQ_API_KEY / GEMINI_API_KEY) — for Vercel / serverless deploys
 *  2. settings.json (written by the Settings panel) — for local / self-hosted
 */
export function resolveKeys() {
  const settings = loadSettings();
  return {
    groqKey: process.env.GROQ_API_KEY || settings.groqKey || '',
    geminiKey: process.env.GEMINI_API_KEY || settings.geminiKey || '',
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

// Seed-family vision (ByteDance) via OpenRouter — an optional extra provider
// for image understanding, gated on OPENROUTER_API_KEY. SeedRealtime itself
// (the full-duplex audio-visual model) has NO public API yet — it is free only
// inside the Doubao app — but the Seed 2.0 / 1.6 vision models are live today.
const OPENROUTER_VISION_MODELS = ['bytedance-seed/seed-2.0-mini', 'bytedance-seed/seed-1.6-flash'];

async function tryOpenRouter(prompt, system, imageBase64, opts, errors) {
  if (!process.env.OPENROUTER_API_KEY || !imageBase64) return null;
  for (const model of OPENROUTER_VISION_MODELS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageBase64 } },
                ],
              },
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
      // Hard 90s per-attempt timeout — a hung upstream API must never hang
      // the whole chat request forever (the old code had NO timeout at all).
      const completion = await groq.chat.completions.create({
        messages,
        model,
        temperature: opts.temperature ?? 0.4,
        timeout: 90000,
      });
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
      // requestOptions.timeout caps each attempt at 90s (SDK default is 10 min
      // and previously there was NO cap — a hung Gemini call stalled chat).
      const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: system, requestOptions: { timeout: 90000 } });
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

/**
 * Generate text from the best available AI provider.
 * opts.prefer: 'gemini' routes code tasks to Gemini first (much stronger at
 * writing/debugging code); everything else keeps Groq-first (fast, free tier).
 */
export async function generateContent(prompt, systemInstruction = '', imageBase64 = null, opts = {}) {
  const errors = [];
  const system = systemInstruction || 'You are JEXI OS, an expert AI operating system.';
  const preferGemini = opts.prefer === 'gemini';

  if (preferGemini) {
    const geminiText = await tryGemini(prompt, system, imageBase64, opts, errors);
    if (geminiText) return geminiText;
    const groqText = await tryGroq(prompt, system, imageBase64, opts, errors);
    if (groqText) return groqText;
  } else {
    const groqText = await tryGroq(prompt, system, imageBase64, opts, errors);
    if (groqText) return groqText;
    const geminiText = await tryGemini(prompt, system, imageBase64, opts, errors);
    if (geminiText) return geminiText;
  }

  // Optional Seed-family vision (ByteDance) via OpenRouter — tried last, only
  // for images, only when OPENROUTER_API_KEY is set. Makes JEXI's eyes
  // Seed-powered the moment a key exists.
  if (imageBase64) {
    const seedText = await tryOpenRouter(prompt, system, imageBase64, opts, errors);
    if (seedText) return seedText;
  }

  const { groqKey, geminiKey } = resolveKeys();
  if (groqKey || geminiKey || process.env.OPENROUTER_API_KEY) {
    throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
  }
  throw new Error('No API keys configured. Add a Groq, Gemini or OpenRouter key in Settings, or set GROQ_API_KEY/GEMINI_API_KEY/OPENROUTER_API_KEY.');
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
