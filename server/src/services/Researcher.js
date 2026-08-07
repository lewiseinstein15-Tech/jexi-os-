import { aggregateSearch } from './SearchEngine.js';
import { extractContent } from './Extractor.js';
import { generateContent } from './LLMClient.js';
import { MANAGER_URL } from '../config.js';

export async function learnHowTo(query, sendEvent) {
  sendEvent('log', { agent: 'Researcher', message: `🎓 Entering Learning Mode for: "${query}"` });
  sendEvent('log', { agent: 'Researcher', message: `` });
  sendEvent('log', { agent: 'Researcher', message: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` });
  sendEvent('log', { agent: 'Researcher', message: `PHASE 1: Asking AI to teach me...` });
  
  // PHASE 1: Ask the AI to teach us how to do this task
  const teachingPrompt = `I need you to teach me how to: "${query}"

Please provide a comprehensive lesson covering:
1. What this task requires (files, technologies, dependencies)
2. Step-by-step approach to complete it
3. Key code patterns or templates I should use
4. Common mistakes to avoid
5. Best practices for this type of project

Be specific and technical. I am a student AI learning to do this task.`;

  const aiTeaching = await generateContent(teachingPrompt, 'You are a master software engineer teaching an AI student. Provide detailed, technical, and practical guidance.');
  sendEvent('log', { agent: 'Researcher', message: `✓ AI taught me the fundamentals` });
  sendEvent('log', { agent: 'Researcher', message: `   Learned ${aiTeaching.length} characters of knowledge` });
  
  // PHASE 2: Search the web for additional resources
  sendEvent('log', { agent: 'Researcher', message: `` });
  sendEvent('log', { agent: 'Researcher', message: `PHASE 2: Searching the internet for tutorials...` });
  const searchQuery = `how to ${query} tutorial step by step`;
  const sources = await aggregateSearch(searchQuery);
  sendEvent('log', { agent: 'Researcher', message: `✓ Found ${sources.length} web resources` });
  
  // PHASE 3: Visit top websites and read them
  sendEvent('log', { agent: 'Researcher', message: `` });
  sendEvent('log', { agent: 'Researcher', message: `PHASE 3: Reading top websites...` });
  const webKnowledge = [];
  
  for (let i = 0; i < Math.min(sources.length, 4); i++) {
    const source = sources[i];
    try {
      const hostname = new URL(source.link).hostname;
      sendEvent('log', { agent: 'Researcher', message: `   → Visiting ${hostname}...` });
      const content = await extractContent(source.link);
      webKnowledge.push({
        title: content.title,
        content: content.content.substring(0, 3000),
        source: source.link,
        source_name: hostname
      });
      sendEvent('log', { agent: 'Researcher', message: `   ✓ Read ${Math.floor(content.content.length / 1000)}k chars from ${hostname}` });
      sendEvent('website', { site: { 
        title: content.title, 
        url: source.link, 
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`, 
        status: 'success' 
      }});
    } catch (e) {
      sendEvent('log', { agent: 'Researcher', message: `   ✗ Failed to read ${source.link}` });
    }
  }
  
  // PHASE 4: Search YouTube for video tutorials
  sendEvent('log', { agent: 'Researcher', message: `` });
  sendEvent('log', { agent: 'Researcher', message: `PHASE 4: Searching YouTube for video tutorials...` });
  
  let youtubeKnowledge = [];
  try {
    const ytSearch = await aggregateSearch(`${query} tutorial`, 'videos');
    sendEvent('log', { agent: 'Researcher', message: `✓ Found ${ytSearch.length} YouTube videos` });
    
    // Try to extract transcripts from top 2 videos
    for (let i = 0; i < Math.min(ytSearch.length, 2); i++) {
      const video = ytSearch[i];
      try {
        const videoId = extractYouTubeId(video.link);
        if (videoId) {
          sendEvent('log', { agent: 'Researcher', message: `   → Watching YouTube video: ${video.title}...` });
          const transcript = await extractYouTubeTranscript(videoId);
          if (transcript) {
            youtubeKnowledge.push({
              title: video.title,
              transcript: transcript.substring(0, 3000),
              source: video.link
            });
            sendEvent('log', { agent: 'Researcher', message: `   ✓ Learned ${Math.floor(transcript.length / 1000)}k chars from video` });
            sendEvent('website', { site: { 
              title: video.title, 
              url: video.link, 
              favicon: `https://www.google.com/s2/favicons?domain=youtube.com&sz=64`, 
              status: 'success' 
            }});
          }
        }
      } catch (e) {
        sendEvent('log', { agent: 'Researcher', message: `   ✗ Could not extract transcript from video` });
      }
    }
  } catch (e) {
    sendEvent('log', { agent: 'Researcher', message: `✗ YouTube search failed` });
  }
  
  // PHASE 5: Synthesize all knowledge using AI
  sendEvent('log', { agent: 'Researcher', message: `` });
  sendEvent('log', { agent: 'Researcher', message: `PHASE 5: Synthesizing all knowledge...` });
  sendEvent('log', { agent: 'Researcher', message: `   Combining: AI Teaching + Web Research + YouTube` });
  
  const synthesisPrompt = `I have learned about "${query}" from multiple sources. Please synthesize this into a structured knowledge module.

SOURCE 1 - AI TEACHING:
 ${aiTeaching}

SOURCE 2 - WEB RESEARCH:
 ${webKnowledge.map(k => `From ${k.source_name}:\n${k.content}`).join('\n\n---\n\n')}

SOURCE 3 - YOUTUBE TUTORIALS:
 ${youtubeKnowledge.map(k => `Video: ${k.title}\nTranscript: ${k.transcript}`).join('\n\n---\n\n')}

Create a structured knowledge module with these sections:
1. SUMMARY: Brief overview of what this task is
2. REQUIREMENTS: Files, technologies, and dependencies needed
3. APPROACH: Step-by-step approach to complete the task
4. CODE_PATTERNS: Key code snippets or templates to use
5. COMMON_MISTAKES: Pitfalls to avoid
6. BEST_PRACTICES: Recommended approaches
7. SOURCES: List of all sources consulted

Be specific and technical. This knowledge will be used to actually build the project.`;

  const synthesizedKnowledge = await generateContent(synthesisPrompt, 'You are a knowledge synthesis AI. Combine multiple sources into a single, comprehensive knowledge module.');
  
  sendEvent('log', { agent: 'Researcher', message: `✓ Knowledge synthesis complete!` });
  sendEvent('log', { agent: 'Researcher', message: `   Created ${synthesizedKnowledge.length} chars of structured knowledge` });
  sendEvent('log', { agent: 'Researcher', message: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` });
  sendEvent('log', { agent: 'Researcher', message: `🎓 Learning Mode Complete!` });
  
  return {
    knowledge: synthesizedKnowledge,
    sources: sources,
    webContent: webKnowledge,
    youtubeContent: youtubeKnowledge
  };
}

// Helper: Extract YouTube video ID
function extractYouTubeId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Helper: Extract YouTube transcript
async function extractYouTubeTranscript(videoId) {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
    return transcriptData.map(t => t.text).join(' ');
  } catch (e) {
    return null;
  }
}
