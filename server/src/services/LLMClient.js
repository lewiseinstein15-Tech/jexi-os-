import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import { loadSettings } from './SettingsManager.js';

export async function generateContent(prompt, systemInstruction = "", imageBase64 = null) {
  const settings = loadSettings();

  // 1. Try Groq First (llama-3.1-8b-instant for text, llama-4-scout for vision)
  if (settings.groqKey) {
    try {
      const groq = new Groq({ apiKey: settings.groqKey });
      const messages = [
        { role: "system", content: systemInstruction },
        {
          role: "user",
          content: imageBase64 ? [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageBase64 } }
          ] : prompt
        }
      ];
      
      // Use llama-4-scout for vision, llama-3.1-8b for text
      const model = imageBase64 ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.1-8b-instant";
      
      const chatCompletion = await groq.chat.completions.create({
        messages,
        model,
      });
      return chatCompletion.choices[0]?.message?.content || "";
    } catch (e) {
      console.error("[LLMClient] Groq failed:", e.message);
    }
  }

  // 2. Fallback to Google Gemini
  if (settings.geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(settings.geminiKey);
      // Use 'gemini-1.5-flash-latest' which always points to a working version
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction });
      
      const contentParts = [{ text: prompt }];
      if (imageBase64) {
        contentParts.push({
          inlineData: { data: imageBase64.split(',')[1], mimeType: "image/png" }
        });
      }
      
      const result = await model.generateContent(contentParts);
      return result.response.text();
    } catch (e) {
      console.error("[LLMClient] Gemini failed:", e.message);
      throw new Error(`Both AI providers failed. Last error: ${e.message}`);
    }
  }

  throw new Error("No API keys configured.");
}
