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

export async function generateContent(prompt, systemInstruction = '', imageBase64 = null, opts = {}) {
  const { groqKey, geminiKey } = resolveKeys();

  // 1. Try Groq first (fast, free tier)
  if (groqKey) {
    try {
      const groq = new Groq({ apiKey: groqKey });
      const messages = [
        { role: 'system', content: systemInstruction || 'You are JEXI OS, an expert AI operating system.' },
        {
          role: 'user',
          content: imageBase64
            ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageBase64 } }]
            : prompt,
        },
      ];
      const model = imageBase64 ? 'meta-llama/llama-4-scout-17b-16e-instruct' : (opts.model || 'llama-3.1-8b-instant');
      const completion = await groq.chat.completions.create({ messages, model, temperature: opts.temperature ?? 0.4 });
      const text = completion.choices[0]?.message?.content || '';
      if (text) return text.trim();
      console.error('[LLMClient] Groq returned empty response');
    } catch (e) {
      console.error('[LLMClient] Groq failed:', e.message);
    }
  }

  // 2. Fallback to Google Gemini
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({
        model: opts.geminiModel || 'gemini-1.5-flash-latest',
        systemInstruction: systemInstruction || 'You are JEXI OS, an expert AI operating system.',
      });
      const parts = [{ text: prompt }];
      if (imageBase64) {
        parts.push({ inlineData: { data: imageBase64.split(',')[1] || imageBase64, mimeType: 'image/png' } });
      }
      const result = await model.generateContent(parts);
      const text = result.response.text();
      if (text) return text.trim();
      throw new Error('Gemini returned empty response');
    } catch (e) {
      console.error('[LLMClient] Gemini failed:', e.message);
      throw new Error(`Both AI providers failed. Last error: ${e.message}`);
    }
  }

  throw new Error('No API keys configured. Add a Groq or Gemini key in Settings, or set GROQ_API_KEY/GEMINI_API_KEY.');
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
