import { generateContent, resolveKeys } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';

/**
 * TRANSLATOR — JEXI's language specialist (skill: 19-translator-agent.md).
 * Pattern from andrewyng/translation-agent: draft → critique → revise
 * (a reflection loop) — meaning first, words second.
 */

const LANGUAGES = {
  french: 'French', spanish: 'Spanish', german: 'German', italian: 'Italian',
  portuguese: 'Portuguese', japanese: 'Japanese', korean: 'Korean', chinese: 'Chinese',
  mandarin: 'Chinese', hindi: 'Hindi', arabic: 'Arabic', russian: 'Russian',
  swahili: 'Swahili', dutch: 'Dutch', polish: 'Polish', turkish: 'Turkish',
  english: 'English', yoruba: 'Yoruba', igbo: 'Igbo', hausa: 'Hausa', greek: 'Greek', latin: 'Latin',
};

/** Pure, testable language detection: { target, source? } from a request. */
export function parseLanguages(query) {
  const q = String(query || '');
  const targetMatch = q.match(/\b(?:into|to|in)\s+([a-z]+)\b/i);
  const sourceMatch = q.match(/\bfrom\s+([a-z]+)\b/i);
  const pick = (m) => (m ? LANGUAGES[m[1].toLowerCase()] || m[1] : null);
  return { target: pick(targetMatch), source: pick(sourceMatch) };
}

/** Extract the text to translate (after the directive words). */
export function extractText(query) {
  return String(query || '')
    .replace(/^(?:please\s+)?(?:can you\s+)?translate\s+(?:this|the|that|it|following)?\s*(?:text|passage|message|paragraph|sentence)?\s*/i, '')
    .replace(/\b(?:into|to|in)\s+[a-z]+\s*\??$/i, '')
    .replace(/\bfrom\s+[a-z]+\s*/i, '')
    .trim()
    .replace(/^[:.\-]\s*/, '');
}

export async function runTranslatorAgent({ query, sendEvent }) {
  const { target, source } = parseLanguages(query);
  if (!target) {
    return { success: true, summary: '### 🌍 TRANSLATOR\n\nTell me the target language — e.g. *"translate this to French"*, *"say hello in Swahili"*, or *"translate \\"thank you\\" to Japanese"*.' };
  }

  const text = extractText(query);
  if (!text || text.length < 2) {
    return { success: true, summary: `### 🌍 TRANSLATOR\n\nI need the text to translate into **${target}** — e.g. *"translate \\"good morning\\" to ${target}"* or paste a whole paragraph.` };
  }

  const keys = resolveKeys();
  if (!keys.groqKey && !keys.geminiKey) {
    return { success: true, summary: `### 🌍 TRANSLATOR\n\nTranslation needs my AI brain — add a **Groq or Gemini key** in Settings and I will translate "${text.slice(0, 80)}…" into ${target} with a full reflection pass.` };
  }

  sendEvent?.('log', { agent: 'Translator', message: `🌍 Translating "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}" → ${target}${source ? ` (from ${source})` : ''}` });

  // ONE call, but the model is forced through the draft → critique → revise loop
  // (andrewyng/translation-agent reflection pattern).
  const prompt = `Translate the following text into ${target}${source ? ` (source language: ${source})` : ''}.

TEXT TO TRANSLATE:
"""
${text}
"""

Follow the translation-agent reflection loop INSIDE one response:

## DRAFT
Translate the full text now. Preserve structure (headings, lists, code blocks — code stays untouched). Keep the tone: casual stays casual, formal stays formal.

## CRITIQUE
Now critique your draft like a bilingual editor:
- Literalisms that sound wrong in ${target}
- Culture-specific references needing adaptation
- Numbers, dates, units, names — verify they carried over exactly
- Anything a native speaker would never say

## REVISE
Write the final, corrected translation (the full text again).
Then add ## CHANGED with 2-4 bullets on what you fixed and why.

Rules: never translate code, file names, URLs, or proper nouns; never invent meaning — if ambiguous, translate once and note the alternative in ## CHANGED.`;
  try {
    const reply = await generateContent(prompt, JEXI_SYSTEM_PROMPT, null, { temperature: 0.2 });
    return { success: true, summary: `### 🌍 TRANSLATOR — into ${target}\n\n${reply.slice(0, 8000)}` };
  } catch (e) {
    return { success: false, summary: `### 🌍 TRANSLATOR\n\n⚠ Translation failed: ${e.message}` };
  }
}
