import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import { loadSettings } from './SettingsManager.js';

export async function generateContent(prompt, systemInstruction = "") {
  const settings = loadSettings();

  // 1. Try Groq First (8b is faster and has better free tier limits)
  if (settings.groqKey) {
    try {
      console.log('[LLMClient] Trying Groq (llama-3.1-8b-instant)...');
      const groq = new Groq({ apiKey: settings.groqKey });
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        model: "llama-3.1-8b-instant",
      });
      const text = chatCompletion.choices[0]?.message?.content || "";
      console.log('[LLMClient] Groq Success!');
      return text;
    } catch (e) {
      console.error("[LLMClient] Groq failed:", e.message);
    }
  }

  // 2. Fallback to Google Gemini
  if (settings.geminiKey) {
    try {
      console.log('[LLMClient] Trying Google Gemini...');
      const genAI = new GoogleGenerativeAI(settings.geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      console.log('[LLMClient] Gemini Success!');
      return text;
    } catch (e) {
      console.error("[LLMClient] Gemini failed:", e.message);
      throw new Error(`Both AI providers failed. Last error: ${e.message}`);
    }
  }

  throw new Error("No API keys configured.");
}
