import { generateContent } from './LLMClient.js';
import { aggregateSearch } from './SearchEngine.js';
import { extractContent } from './Extractor.js';

const MANAGER_URL = 'http://localhost:3001';
const MAX_RAW_TEXT = 15000; // Reduced to 15k to fit API limits

export async function studyTopic(category, topic, sendEvent) {
  sendEvent('log', { agent: 'Scholar', message: `🎓 Deep Aggressive Study Mode Initiated for: "${topic}"` });
  
  const subtopics = getSubtopics(topic);
  sendEvent('log', { agent: 'Scholar', message: `Breaking down into subtopics: ${subtopics.join(', ')}` });
  
  let rawBookText = '';
  let sourcesUsed = [];

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
      
      sendEvent('log', { agent: 'Scholar', message: `Strategy ${s+1}: Searching for ${strategies[s].name}...` });
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

  if (rawBookText.length < 1000) {
    sendEvent('log', { agent: 'Scholar', message: `⚠ All extraction failed. Falling back to AI.` });
    rawBookText = `No external texts extracted. Relying on internal AI knowledge about ${topic}.`;
  } else {
    sendEvent('log', { agent: 'Scholar', message: `✓ Acquisition complete. Total raw text: ${Math.floor(rawBookText.length / 1000)}k chars.` });
  }

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
  await fetch(`${MANAGER_URL}/api/knowledge/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, filename, content: synthesizedKnowledge })
  });

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

export async function recallKnowledge(query, sendEvent) {
  const res = await fetch(`${MANAGER_URL}/api/knowledge/search?query=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (data.length > 0) return data.map(k => `From ${k.title}:\n${k.content}`).join('\n\n---\n\n');
  return null;
}
