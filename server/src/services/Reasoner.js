import natural from 'natural';

function getCleanSentences(text) {
  let sents = text.split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 40 && s.length < 400);

  if (sents.length < 3) {
    sents = text.split(/\n|,/)
      .map(s => s.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim())
      .filter(s => s.length > 40 && s.length < 300);
  }

  const GARBAGE_WORDS = ['[music]', 'hello everyone', 'welcome back', 'in this video', 'today we will', 'please subscribe', 'like and share', 'let me know', 'thanks for watching'];
  return sents.filter(s => {
    const lower = s.toLowerCase();
    return !GARBAGE_WORDS.some(g => lower.includes(g));
  });
}

export function reasonAndWrite(query, articles, isSummarization = false) {
  const allText = articles.map(a => a.content).join(' \n\n ');
  let sents = getCleanSentences(allText);
  
  if (sents.length === 0) {
    return {
      summary: "Could not extract enough valid educational content. The sources may be heavily guarded or lack text.",
      sections: [], keyFacts: [], confidence: 20
    };
  }

  const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !natural.stopwords.includes(w));
  const wordFreq = {};
  const words = allText.toLowerCase().split(/\W+/).filter(w => w.length > 5 && !natural.stopwords.includes(w));
  words.forEach(w => wordFreq[w] = (wordFreq[w] || 0) + 1);
  const topWords = Object.entries(wordFreq).sort((a,b) => b[1]-a[1]).slice(0, 15).map(e => e[0]);

  const scoredSents = sents.map(s => {
    let score = 0;
    const lowerS = s.toLowerCase();
    topWords.forEach(w => { if (lowerS.includes(w)) score += 2; });
    queryWords.forEach(w => { if (lowerS.includes(w)) score += 5; });
    return { text: s, score };
  });

  // For Summarization (e.g., a YouTube video), we just want the top points chronologically
  if (isSummarization) {
    const summaryPoints = scoredSents.slice(0, 5).map(s => `* ${s.text}`);
    let markdownSummary = `### 📝 JEXI OS SUMMARY\n\n**Subject:** ${query}\n\n`;
    markdownSummary += `**Key Points Extracted:**\n${summaryPoints.join('\n')}\n\n`;
    return {
      summary: markdownSummary,
      sections: [{ heading: "Summary", content: summaryPoints.join('\n') }],
      keyFacts: summaryPoints,
      confidence: Math.min(95, 70 + (articles.length * 5))
    };
  }

  // For Deep Research, chunk it
  const chunkSize = Math.floor(scoredSents.length / 4) || 1;
  const chunk1 = scoredSents.slice(0, chunkSize);
  const chunk2 = scoredSents.slice(chunkSize, chunkSize * 2);
  const chunk3 = scoredSents.slice(chunkSize * 2, chunkSize * 3);
  const chunk4 = scoredSents.slice(chunkSize * 3);

  const intro = chunk1.sort((a,b)=>b.score-a.score).slice(0, 2).map(s => s.text);
  const concepts = chunk2.sort((a,b)=>b.score-a.score).slice(0, 3).map(s => s.text);
  const details = chunk3.sort((a,b)=>b.score-a.score).slice(0, 3).map(s => s.text);
  const summaryPoints = chunk4.sort((a,b)=>b.score-a.score).slice(0, 2).map(s => s.text);

  let markdownSummary = `# 📚 JEXI OS RESEARCH DOSSIER\n\n`;
  markdownSummary += `**Subject:** ${query}\n\n`;
  markdownSummary += `**Executive Summary:** Based on comprehensive analysis of ${articles.length} documents, this dossier synthesizes the core principles requested.\n\n`;
  
  markdownSummary += `---\n\n## 1. Introduction & Overview\n`;
  markdownSummary += `${intro.join(' ') || 'No specific introduction extracted.'}\n\n`;
  
  markdownSummary += `## 2. Core Concepts & Syntax\n`;
  markdownSummary += `${concepts.map(s => `* ${s}`).join('\n') || 'No core concepts extracted.'}\n\n`;
  
  markdownSummary += `## 3. Deep Dive: Technical Details & Code\n`;
  markdownSummary += `${details.map(s => `* ${s}`).join('\n') || 'No technical details extracted.'}\n\n`;
  
  markdownSummary += `## 4. Summary & Application\n`;
  markdownSummary += `${summaryPoints.join(' ') || 'No summary extracted.'}\n\n`;

  return {
    summary: markdownSummary,
    sections: [
      { heading: "Introduction", content: intro.join(' ') },
      { heading: "Core Concepts", content: concepts.join('\n') },
      { heading: "Deep Dive", content: details.join('\n') },
      { heading: "Summary", content: summaryPoints.join(' ') }
    ],
    keyFacts: concepts,
    confidence: Math.min(98, 60 + (articles.length * 5))
  };
}
