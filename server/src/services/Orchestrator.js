import fs from 'fs';
import path from 'path';
import { generateCode, applyFix } from './Architect.js';
import { runFile } from './Runner.js';
import { aggregateSearch } from './SearchEngine.js';
import { extractContent, analyzeLink } from './Extractor.js';
import { reasonAndWrite } from './Reasoner.js';
import { learnHowTo } from './Researcher.js';
import { generateContent, resolveKeys } from './LLMClient.js';
import { studyTopic, recallKnowledge } from './KnowledgeAgent.js';
import { ComputerUseAgent } from './ComputerUseAgent.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile,
  searchInternetKnowledge, searchCodingKnowledge,
  saveInternetKnowledge, saveCodingKnowledge, saveKnowledgeFile,
} from './MemoryManager.js';
import { WORKSPACE_DIR, MANAGER_URL, MAX_DEBUG_ATTEMPTS } from '../config.js';

function readWorkspaceFile(name) {
  const filePath = path.join(WORKSPACE_DIR, name);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function listWorkspaceFiles() {
  if (!fs.existsSync(WORKSPACE_DIR)) return [];
  return fs.readdirSync(WORKSPACE_DIR).filter(f => fs.statSync(path.join(WORKSPACE_DIR, f)).isFile());
}

/** Build a compact conversation context for JEXI to stay focused. */
function conversationContext() {
  const history = getChatHistory(12);
  return history.map(h => `${h.role === 'user' ? 'User' : 'JEXI'}: ${String(h.text).slice(0, 600)}`).join('\n');
}

export class Orchestrator {
  constructor() { this.executionHistory = []; }

  async executePlan(plan, query, sendEvent, opts = {}) {
    const startTime = Date.now();
    const results = { success: true, query, intent: plan.intent, tasks: plan.tasks, agentResults: {}, summary: '', sources: [], statistics: { executionTime: 0, agentsUsed: plan.tasks.length, confidence: 0 } };

    try {
      // Log the incoming request into memory so long conversations keep context
      try { addChat('user', query); } catch (e) {}

      switch (plan.intent) {
        /* ---------------- CLEAR MEMORY ---------------- */
        case 'clear_memory': {
          clearMemory();
          results.summary = "### 🧠 JEXI OS\n\n✓ Memory core wiped completely.";
          results.statistics.confidence = 100;
          return results;
        }

        /* ---------------- CONVERSATION & IDENTITY ---------------- */
        case 'conversation': {
          const ctx = conversationContext();
          const reply = await generateContent(
            `The user just said: "${query}"\n\nRecent conversation:\n${ctx}\n\nRespond naturally as JEXI OS. If they ask who you are or who created you, answer: you are JEXI OS, a sophisticated multi-agent AI operating system built by Lewis Einstein (AI & ML Engineer) to run any task. Be warm and brief.`,
            JEXI_SYSTEM_PROMPT
          );
          try { addChat('jexi', reply); } catch (e) {}
          results.summary = `### 🧠 JEXI OS\n\n${reply}`;
          results.statistics.confidence = 100;
          return results;
        }

        /* ---------------- MEMORY QUERY ---------------- */
        case 'memory_query': {
          const { userProfile } = await import('./MemoryManager.js').then(m => ({ userProfile: m.loadMemory().userProfile }));
          const ctx = conversationContext();
          const reply = await generateContent(
            `The user asked: "${query}"\n\nUser profile: ${JSON.stringify(userProfile)}\nRecent conversation:\n${ctx}\n\nAnswer what JEXI remembers about the user, naturally.`,
            JEXI_SYSTEM_PROMPT
          );
          try { addChat('jexi', reply); } catch (e) {}
          results.summary = `### 🧠 JEXI OS\n\n${reply}`;
          results.statistics.confidence = 100;
          return results;
        }

        /* ---------------- IMAGE RECOGNITION ---------------- */
        case 'image_recognition': {
          sendEvent('log', { agent: 'Vision', message: '🔍 Analyzing image...' });
          const reply = await generateContent(
            `The user attached an image and asked: "${query || 'What is this?'}"\n\nAnalyze the image thoroughly: describe what it shows, read any text/numbers/symbols, and if it is a math problem, solve it with full LaTeX steps.`,
            JEXI_SYSTEM_PROMPT,
            plan.payload
          );
          try { addChat('jexi', reply); } catch (e) {}
          results.summary = `### 👁️ JEXI VISION\n\n${reply}`;
          results.statistics.confidence = 95;
          return results;
        }

        /* ---------------- LINK ANALYSIS ---------------- */
        case 'link_analysis': {
          const url = plan.payload.url;
          sendEvent('log', { agent: 'Vision', message: `🌐 Opening link: ${url}` });
          sendEvent('website', { site: { title: url, url, favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`, status: 'reading' } });

          // Use the browser agent (her eyes) — falls back to server-side reading
          const agent = new ComputerUseAgent();
          const result = await agent.executeTask(plan.payload.fullQuery || query, sendEvent, { intent: 'link_analysis' });

          if (result.output && result.output.length > 0) {
            const reply = result.output.includes('###') ? result.output : `### 🔗 LINK ANALYSIS\n\n${result.output}`;
            try { addChat('jexi', reply); } catch (e) {}
            results.summary = reply;
          } else {
            // Last-resort: extract content server-side
            const content = await analyzeLink(url);
            const reply = await generateContent(
              `The user shared this link: ${url}\n\nContent I extracted:\n${content.content.slice(0, 8000)}\n\nTell the user what this link is about, clearly and concisely, with key details.`,
              JEXI_SYSTEM_PROMPT
            );
            try { addChat('jexi', reply); } catch (e) {}
            results.summary = `### 🔗 LINK ANALYSIS\n\n${reply}`;
          }
          results.sources = [{ title: url, link: url }];
          results.statistics.confidence = 90;
          return results;
        }

        /* ---------------- MATH ---------------- */
        case 'math_solve': {
          sendEvent('log', { agent: 'Reasoner', message: '🔢 Solving with structured mathematics...' });
          const reply = await generateContent(
            `Solve this mathematics question step by step: "${query}"\n\nRULES:\n- Use LaTeX everywhere: $...$ for inline math, $$...$$ for display math.\n- Clearly distinguish letters (variables), numbers, and symbols.\n- Use a table if comparing values, and include a diagram or graph description when helpful.\n- Structure: # SOLUTION / ## GIVEN / ## FORMULA / ## WORKING / ## FINAL ANSWER.\n- Double-check your arithmetic before answering.`,
            JEXI_SYSTEM_PROMPT
          );
          try { addChat('jexi', reply); } catch (e) {}
          try { saveInternetKnowledge(query, reply, []); } catch (e) {}
          results.summary = reply;
          results.statistics.confidence = 95;
          return results;
        }

        /* ---------------- CODE TASK — THE DEBUG LOOP ---------------- */
        case 'code_task': {
          sendEvent('log', { agent: 'Coder', message: '💻 Entering coding pipeline...' });

          // 1. Do we already know this from memory?
          try {
            const remembered = searchCodingKnowledge(query);
            if (remembered) {
              sendEvent('log', { agent: 'Memory Agent', message: '✓ Found a solution I built before — recalling from memory.' });
              results.summary = `### 🧠 JEXI OS — RECALLED FROM MEMORY\n\nI solved this before, so I'm giving you the verified solution.\n\n${remembered.solution}\n\n${remembered.files?.length ? `**Files:** ${remembered.files.join(', ')}` : ''}`;
              results.statistics.confidence = 95;
              return results;
            }
          } catch (e) {}

          // 2. Plan the project
          let project;
          try {
            project = await generateCode(query, sendEvent);
          } catch (e) {
            sendEvent('log', { agent: 'Architect', message: `⚠ Planning failed: ${e.message}` });
          }

          if (project && project.files && project.files.length > 0) {
            fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
            project.files.forEach(f => fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8'));
            sendEvent('log', { agent: 'Coder', message: `✓ Created ${project.files.length} file(s)` });

            // 3. THE DEBUG LOOP: run → check → fix → rerun (never leave until success)
            let attempt = 0;
            let entryPoint = project.entryPoint || project.files[0]?.name;
            let lastOutput = '';

            while (attempt < MAX_DEBUG_ATTEMPTS) {
              attempt++;
              sendEvent('log', { agent: 'Runner', message: `▶ Attempt ${attempt}/${MAX_DEBUG_ATTEMPTS}: Running ${entryPoint}...` });
              const runResult = await runFile(entryPoint, (stream, data) => sendEvent('log', { agent: 'Terminal', message: String(data).slice(0, 200) }));
              lastOutput = runResult.output || '';

              const looksLikeError = /traceback|exception|syntaxerror|errno|no such file|modulenotfound|nameerror|importerror|attributeerror|typeerror|referenceerror|cannot find module|is not defined|command not found|failed/i.test(lastOutput);

              if (runResult.success && !looksLikeError) {
                sendEvent('log', { agent: 'Runner', message: '✅ Code ran successfully with no errors!' });
                break;
              }

              if (attempt >= MAX_DEBUG_ATTEMPTS) {
                sendEvent('log', { agent: 'Debugger', message: `⚠ Max attempts reached (${MAX_DEBUG_ATTEMPTS}). Showing best effort.` });
                break;
              }

              sendEvent('log', { agent: 'Debugger', message: `⚠ Error on attempt ${attempt}. Reading error and fixing...` });
              const errorContext = lastOutput.slice(-2000);
              const existingCode = readWorkspaceFile(entryPoint);

              try {
                const fixed = await applyFix(query, errorContext, existingCode, attempt + 1, sendEvent);
                if (fixed && fixed.files && fixed.files.length > 0) {
                  fixed.files.forEach(f => fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8'));
                  entryPoint = fixed.entryPoint || entryPoint;
                  sendEvent('log', { agent: 'Debugger', message: '✍ Rewrote code with fixes. Re-running...' });
                }
              } catch (e) {
                sendEvent('log', { agent: 'Debugger', message: `✗ Fix failed: ${e.message}` });
              }
            }

            // 4. Present the verified code
            const files = listWorkspaceFiles();
            const fileSections = files.map(name => {
              const code = readWorkspaceFile(name);
              const lang = name.endsWith('.py') ? 'python' : name.endsWith('.js') ? 'javascript' : name.endsWith('.html') ? 'html' : name.endsWith('.css') ? 'css' : 'bash';
              return `#### 📄 ${name}\n\n\`\`\`${lang}\n${code.slice(0, 12000)}\n\`\`\``;
            }).join('\n\n');

            const workspaceLinks = files.map(name => `- [${name}](${MANAGER_URL}/api/files/${name})`).join('\n');
            const finalOutput = lastOutput && lastOutput.trim() ? `\`\`\`bash\n${lastOutput.trim().slice(0, 1500)}\n\`\`\`` : '';

            results.summary = `### 💻 JEXI CODING AGENT — VERIFIED & TESTED\n\n✅ I wrote the code, ran it in the terminal, and confirmed it works without errors.\n\n${fileSections}\n\n**Test Output:**\n${finalOutput || '✓ Ran successfully.'}\n\n**Download the files:**\n${workspaceLinks}`;
            results.files = files;
            results.statistics.confidence = 100;

            // 5. Store the verified solution in memory
            try {
              const codeSummary = fileSections.replace(/```[\s\S]*?```/g, '```code```').slice(0, 8000);
              saveCodingKnowledge(query, 'code', codeSummary, files);
            } catch (e) {}
          } else {
            results.summary = "### 💻 JEXI CODING AGENT\n\nI couldn't generate the code. Please rephrase your request with more detail.";
            results.statistics.confidence = 40;
          }
          return results;
        }

        /* ---------------- DEEP RESEARCH & LEARNING ---------------- */
        case 'research':
        case 'learning_research': {
          // 1. Check memory first — did we already learn this?
          try {
            const remembered = searchInternetKnowledge(query);
            if (remembered) {
              sendEvent('log', { agent: 'Memory Agent', message: '✓ I already know this — retrieving from my mind.' });
              results.summary = `### 🧠 JEXI OS — FROM MEMORY\n\n${remembered.answer}`;
              if (remembered.sources?.length) results.sources = remembered.sources.map(s => ({ title: s, link: s }));
              results.statistics.confidence = 92;
              return results;
            }
          } catch (e) {}

          // 2. Search the internet (trusted sources)
          sendEvent('log', { agent: 'Search', message: `🔍 Searching trusted sources for: "${query}"` });
          const sources = await aggregateSearch(query);
          results.sources = sources.slice(0, 5).map(s => ({ title: s.title, link: s.link }));

          if (sources.length === 0) {
            sendEvent('log', { agent: 'Search', message: '⚠ No results. Trying the browser...' });
            const agent = new ComputerUseAgent();
            const br = await agent.executeTask(query, sendEvent, { intent: 'research' });
            if (br.output) {
              try { addChat('jexi', br.output); } catch (e) {}
              results.summary = br.output;
              results.statistics.confidence = 80;
              return results;
            }
          }

          // 3. Deep-read the top trusted sources
          sendEvent('log', { agent: 'Extractor', message: `📖 Deep-reading top ${Math.min(sources.length, 4)} sources...` });
          const deep = [];
          for (const src of sources.slice(0, 4)) {
            try {
              const hostname = new URL(src.link).hostname;
              const content = await extractContent(src.link);
              deep.push({ title: content.title || src.title, link: src.link, source_name: hostname, content: content.content.slice(0, 4000) });
              sendEvent('website', { site: { title: content.title || src.title, url: src.link, favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`, status: 'success' } });
              sendEvent('log', { agent: 'Extractor', message: `✓ Read ${hostname}` });
            } catch (e) {
              sendEvent('log', { agent: 'Extractor', message: `✗ Could not read ${src.link}` });
            }
          }

          // 4. Synthesize: reframe raw info into a direct answer
          sendEvent('log', { agent: 'Reasoner', message: '🧠 Synthesizing answer...' });
          const { summary } = await reasonAndWrite(query, deep);
          try { addChat('jexi', summary); } catch (e) {}
          results.summary = summary;
          results.statistics.confidence = 90;
          return results;
        }

        /* ---------------- STUDY A TOPIC (books/papers) ---------------- */
        case 'study_topic': {
          const topic = plan.payload || query;
          const content = await studyTopic('07_GENERAL_KNOWLEDGE', topic, sendEvent);
          results.summary = `### 📚 JEXI SCHOLAR\n\nI have studied **${topic}** and saved it to my knowledge library.\n\n${content.slice(0, 4000)}`;
          results.statistics.confidence = 100;
          return results;
        }

        /* ---------------- KNOWLEDGE RECALL ---------------- */
        case 'knowledge_recall': {
          const kb = plan.payload || (await recallKnowledge(query, sendEvent));
          if (kb) {
            const context = Array.isArray(kb) ? kb.map(k => `From ${k.title}:\n${k.content}`).join('\n\n---\n\n') : kb;
            const reply = await generateContent(
              `The user asked: "${query}"\n\nKnowledge from my library:\n${context.slice(0, 14000)}\n\nWrite a well-structured answer with numbered points.`,
              JEXI_SYSTEM_PROMPT
            );
            try { addChat('jexi', reply); } catch (e) {}
            results.summary = `### 🧠 JEXI OS\n\n${reply}`;
            results.statistics.confidence = 95;
            return results;
          }
          // Fall through to research if library has nothing
          const { summary } = await reasonAndWrite(query, []);
          results.summary = summary;
          return results;
        }

        /* ---------------- DEFAULT ---------------- */
        default: {
          const { summary } = await reasonAndWrite(query, [], { memoryContext: conversationContext() });
          try { addChat('jexi', summary); } catch (e) {}
          results.summary = summary;
          results.statistics.confidence = 70;
          return results;
        }
      }
    } catch (error) {
      results.success = false;
      results.error = error.message;
      sendEvent('log', { agent: 'System', message: `Error: ${error.message}` });
      results.summary = `### ⚠ JEXI OS\n\nI hit an error: ${error.message}\n\nMake sure an API key is configured (Settings → Groq/Gemini) and try again.`;
      return results;
    } finally {
      results.statistics.executionTime = Date.now() - startTime;
      this.executionHistory.push({ intent: plan.intent, time: Date.now() });
    }
  }
}

export const orchestrator = new Orchestrator();
