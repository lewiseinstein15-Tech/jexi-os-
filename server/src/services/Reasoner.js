import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';

// Simulating an LLM call with the system prompt injected
export function reasonAndWrite(query, sources, isSummarization = false) {
  // In a real environment, you would pass JEXI_SYSTEM_PROMPT to your LLM API (OpenAI/Zhipu)
  // For example: await openai.chat.completions.create({ messages: [{role: 'system', content: JEXI_SYSTEM_PROMPT}, {role: 'user', content: query}] })
  
  // --- MOCK RESPONSE GENERATOR (To demonstrate formatting) ---
  let response = `### 🧠 JEXI OS ANALYSIS\n\n`;
  
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('math') || lowerQuery.includes('calculate') || lowerQuery.includes('area')) {
    response += `# SOLUTION\n\n## GIVEN\n- Length = 5\n- Width = 10\n\n## FORMULA\nArea = length × width\n\n## WORKING\nStep 1:\nA = 5 × 10\n\nStep 2:\nA = 50\n\n## FINAL ANSWER\nTherefore:\nA = 50 units² ✓`;
  } 
  else if (lowerQuery.includes('code') || lowerQuery.includes('program') || lowerQuery.includes('script')) {
    response += `# SOLUTION\n\n## UNDERSTANDING THE TASK\nYou requested a script. I have generated a robust solution.\n\n## APPROACH\nUsing modular design and error handling.\n\n## CODE\n\`\`\`python\n# JEXI Generated Code\ndef main():\n    print("System Online")\n\nif __name__ == "__main__":\n    main()\n\`\`\`\n\n## TESTING\nRun: \`python main.py\`\n\n## POSSIBLE IMPROVEMENTS\n- Add CLI arguments\n- Implement logging`;
  } 
  else if (sources && sources.length > 0) {
    response += `# RESEARCH RESULTS\n\n## OVERVIEW\n${sources[0]?.content?.substring(0, 150) || 'Information gathered.'}...\n\n## KEY FINDINGS\n📌 Found ${sources.length} relevant sources.\n💡 Synthesized data from multiple APIs.\n\n## DETAILS\n${sources.slice(0, 2).map(s => `- **${s.title}**: ${s.snippet || 'Relevant info'}`).join('\n')}\n\n## SOURCES\n${sources.slice(0, 3).map(s => `Title: ${s.title}\nWebsite: ${new URL(s.link).hostname}\nLink: ${s.link}`).join('\n\n')}`;
  } 
  else {
    response += `## 🧠 EXPLANATION\n\nI have processed your request: "${query}".\n\n💡 **Key Point:** The system is fully operational and ready to execute complex tasks.\n\n→ **Next Step:** Try asking me to solve a math problem, write code, or research a topic!`;
  }

  return {
    summary: response,
    confidence: 95
  };
}
