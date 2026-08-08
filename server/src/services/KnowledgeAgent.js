import { generateContent } from './LLMClient.js';
import { aggregateSearch } from './SearchEngine.js';
import { extractContent } from './Extractor.js';
import { searchTrustedBooks, getTrustedBookText } from './TrustedLibrary.js';
import { saveKnowledgeFile, searchKnowledge } from './MemoryManager.js';
import { MANAGER_URL } from '../config.js';

const MAX_RAW_TEXT = 15000; // Reduced to 15k to fit API limits

export async function studyTopic(category, topic, sendEvent) {
  sendEvent('log', { agent: 'Scholar', message: `🎓 Deep Aggressive Study Mode Initiated for: "${topic}"` });

  const subtopics = getSubtopics(topic);
  sendEvent('log', { agent: 'Scholar', message: `Breaking down into subtopics: ${subtopics.join(', ')}` });

  let rawBookText = '';
  let sourcesUsed = [];

  /* ---- PHASE 1: The TRUSTED LIBRARY (books & papers, like model training data) ---- */
  sendEvent('log', { agent: 'Scholar', message: '📚 Phase 1: Opening the Trusted Library (Wikipedia · Project Gutenberg · arXiv · Open Library)...' });
  const trusted = await searchTrustedBooks(topic);
  sendEvent('log', { agent: 'Scholar', message: `📚 Found ${trusted.length} trusted source(s).` });

  for (const src of trusted) {
    if (rawBookText.length >= MAX_RAW_TEXT) break;
    try {
      sendEvent('log', { agent: 'Scholar', message: `   → Reading ${src.source}: ${src.title.slice(0, 70)}` });
      const text = await getTrustedBookText(src.url, MAX_RAW_TEXT - rawBookText.length);
      if (text && text.length > 200) {
        rawBookText += `\n\n--- EXCERPT FROM ${src.title} (${src.source}) ---\n${text}`;
        sourcesUsed.push(src.url);
        sendEvent('log', { agent: 'Scholar', message: `   ✓ Read ${Math.floor(text.length / 1000)}k chars from ${src.source}.` });
        sendEvent('website', {
          site: {
            title: src.title,
            url: src.url,
            favicon: `https://www.google.com/s2/favicons?domain=${new URL(src.url).hostname}&sz=64`,
            status: 'success',
          },
        });
      } else {
        sendEvent('log', { agent: 'Scholar', message: `   ✗ Not enough readable text (${(text || '').length} chars).` });
      }
    } catch (e) {
      sendEvent('log', { agent: 'Scholar', message: `   ✗ ${src.source} failed: ${String(e.message).substring(0, 60)}` });
    }
  }

  /* ---- PHASE 2: Web fallback (only if the Trusted Library came up short) ---- */
  if (rawBookText.length < 3000) {
    sendEvent('log', { agent: 'Scholar', message: '🌐 Trusted Library was thin — supplementing with web research...' });
    for (const subtopic of subtopics) {
      if (rawBookText.length >= MAX_RAW_TEXT) break;

      sendEvent('log', { agent: 'Scholar', message: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` });
      sendEvent('log', { agent: 'Scholar', message: `STUDYING SUBTOPIC: ${subtopic}` });

      const strategies = [
        { name: 'PDFs & Papers', query: `${subtopic} textbook filetype:pdf` },
        { name: 'University Guides', query: `${subtopic} comprehensive university lecture notes -youtube` }
      ];

      for (let s = 0; s < strategies.length; s++) {
        if (rawBookText.length >= MAX_RAW_TEXT) break;

        sendEvent('log', { agent: 'Scholar', message: `Strategy ${s + 1}: Searching for ${strategies[s].name}...` });
        const sources = await aggregateSearch(strategies[s].query);

        for (const source of sources.slice(0, 2)) {
          if (rawBookText.length >= MAX_RAW_TEXT) break;
          try {
            const hostname = new URL(source.link).hostname;
            sendEvent('log', { agent: 'Scholar', message: `   → Attempting extraction: ${hostname}` });
            const content = await extractContent(source.link);

            if (content.content && content.content.length > 1000) {
              const remainingSpace = MAX_RAW_TEXT - rawBookText.length;
              const chunk = content.content.substring(0, remainingSpace);
              rawBookText += `\n\n--- EXCERPT FROM ${content.title} (${content.method}) ---\n${chunk}`;
              sourcesUsed.push(source.link);
              sendEvent('log', { agent: 'Scholar', message: `   ✓ Extracted ${Math.floor(chunk.length / 1000)}k chars.` });
              sendEvent('website', { site: { title: content.title, url: source.link, favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`, status: 'success' } });
            }
          } catch (e) {
            sendEvent('log', { agent: 'Scholar', message: `   ✗ Extraction failed: ${e.message.substring(0, 50)}` });
          }
        }
      }
    }
  }

  if (rawBookText.length < 1000) {
    sendEvent('log', { agent: 'Scholar', message: `⚠ All extraction failed. Falling back to AI.` });
    rawBookText = `No external texts extracted. Relying on internal AI knowledge about ${topic}.`;
  } else {
    sendEvent('log', { agent: 'Scholar', message: `✓ Acquisition complete. Total raw text: ${Math.floor(rawBookText.length / 1000)}k chars from ${sourcesUsed.length} trusted source(s).` });
  }

  /* ---- PHASE 3: Synthesize into structured, permanent knowledge ---- */
  let synthesizedKnowledge = '';
  let isVerified = false;
  let synthAttempts = 0;

  while (!isVerified && synthAttempts < 2) {
    synthAttempts++;
    sendEvent('log', { agent: 'Scholar', message: `Synthesis Attempt ${synthAttempts}: Condensing ${Math.floor(rawBookText.length / 1000)}k chars into structured knowledge...` });

    const synthPrompt = `Synthesize the following raw text about "${topic}" into a comprehensive, permanent university-level knowledge file.\nInclude: 1. DEFINITIONS, 2. PRINCIPLES & THEORIES, 3. MATHEMATICAL FORMULAS (Use LaTeX: $$ for block, $ for inline), 4. REAL-WORLD APPLICATIONS, 5. COMMON PITFALLS.\nFormat in clean Markdown.\n\nRaw Text:\n${rawBookText}`;
    synthesizedKnowledge = await generateContent(synthPrompt, 'You are an expert AI scholar synthesizing raw book text into structured knowledge.');

    sendEvent('log', { agent: 'Scholar', message: `Verification Gate: Checking quality...` });
    const verifyPrompt = `Does the following text contain structured sections for definitions, principles, formulas, and applications regarding "${topic}"? Answer ONLY "YES" or "NO".\n\nText:\n${synthesizedKnowledge.substring(0, 1000)}`;
    const verification = await generateContent(verifyPrompt, 'You are a strict QA agent. Answer only YES or NO.');

    if (verification.toUpperCase().includes('YES')) {
      isVerified = true;
      sendEvent('log', { agent: 'Scholar', message: `✓ Verification Passed.` });
    } else {
      sendEvent('log', { agent: 'Scholar', message: `✗ Verification Failed. Retrying...` });
    }
  }

  const filename = `${topic.toLowerCase().replace(/\s+/g, '_')}.md`;
  try {
    await fetch(`${MANAGER_URL}/api/knowledge/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, filename, content: synthesizedKnowledge })
    });
  } catch (e) {}
  // Always save locally too — the knowledge library lives inside JEXI's mind
  try { saveKnowledgeFile(category, filename, synthesizedKnowledge); } catch (e) {}

  sendEvent('log', { agent: 'Scholar', message: `✓ Mastered ${topic}. Saved ${synthesizedKnowledge.length} chars to knowledge base.` });
  return synthesizedKnowledge;
}

function getSubtopics(topic) {
  const lowerTopic = topic.toLowerCase();
  if (lowerTopic.includes('calculus')) {
    return ['Limits and Continuity', 'Derivatives and Differentiation', 'Integrals and Integration', 'Applications of Calculus'];
  } else if (lowerTopic.includes('physics')) {
    return ['Classical Mechanics', 'Electromagnetism', 'Thermodynamics', 'Quantum Mechanics'];
  } else if (lowerTopic.includes('algebra')) {
    return ['Linear Equations', 'Quadratic Equations', 'Polynomials', 'Exponents and Logarithms'];
  } else if (lowerTopic.includes('programming') || lowerTopic.includes('python')) {
    return ['Syntax and Basics', 'Data Structures', 'Algorithms', 'Object-Oriented Programming'];
  }
  return [topic];
}

export async function recallKnowledge(query, sendEvent, minScore = 2) {
  // First: search JEXI's own knowledge library (fast, offline) — includes the user's books
  try {
    const local = searchKnowledge(query, minScore);
    if (local.length > 0) {
      return local.map(k => ({ title: k.title, content: k.content, score: k.score, source: k.source || 'library' }));
    }
  } catch (e) {}
  // Fallback: ask the manager service
  try {
    const res = await fetch(`${MANAGER_URL}/api/knowledge/search?query=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (data.length > 0) return data.map(k => ({ title: k.title, content: k.content, score: k.score || 2, source: k.source || 'library' }));
  } catch (e) {}
  return null;
}
