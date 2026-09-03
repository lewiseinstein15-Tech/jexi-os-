import { generateContent } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { preferencesBlock } from './PreferenceLearner.js';
import { saveInternetKnowledge } from './MemoryManager.js';

/**
 * The Reasoner reframes raw information into a structured answer that
 * directly addresses the user's question, then stores the distilled
 * knowledge in JEXI's mind for next time.
 */
export async function reasonAndWrite(query, sources, opts = {}) {
  const isSummarization = opts.isSummarization || false;
  const memoryContext = opts.memoryContext || '';

  let prompt;
  if (sources && sources.length > 0) {
    const sourceText = sources
      .slice(0, 6)
      .map((s, i) => `SOURCE ${i + 1}: ${s.title || s.source_name || 'Unknown'}\nLink: ${s.link || s.source || ''}\n${String(s.content || s.snippet || '').slice(0, 4000)}`)
      .join('\n\n---\n\n');
    prompt = `The user asked: "${query}"\n\n${memoryContext ? `Relevant conversation memory:\n${memoryContext}\n\n` : ''}I researched and read these sources:\n${sourceText}\n\nReframe and synthesize a clear, well-structured answer that DIRECTLY answers the user's question. Follow JEXI OS formatting rules (## sections, bold key facts, numbered points, sources listed at the end).`;
  } else if (isSummarization) {
    prompt = `Synthesize the following into a structured, directly-answering response for the question: "${query}"\n\n${opts.rawText || ''}`;
  } else {
    prompt = `Answer the user's question clearly and completely: "${query}"\n\n${memoryContext ? `Context from previous conversation (use it only to resolve references — never announce that this continues a conversation, just answer):\n${memoryContext}` : ''}\nFollow JEXI OS formatting rules.`;
  }

  // B200 — live answer streaming (same seam as the search synthesizer).
  const summary = await generateContent(prompt, JEXI_SYSTEM_PROMPT + preferencesBlock(), null, {
    ...(typeof opts.onToken === 'function' ? { onToken: opts.onToken } : {}),
  });

  // Store what we learned so next time JEXI answers from memory
  try {
    const topic = String(query).slice(0, 200);
    saveInternetKnowledge(topic, summary, (sources || []).map(s => s.link || s.source).filter(Boolean));
  } catch (e) {}

  return { summary, confidence: sources && sources.length > 0 ? 92 : 80 };
}
