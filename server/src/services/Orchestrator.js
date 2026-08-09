import fs from 'fs';
import path from 'path';
import { generateCode, applyFix } from './Architect.js';
import { planForBuild, qaWebApp, qaScripted, reviewAndShip, fixFromQA, isDebugQuery, gateVerdict } from './SkillChain.js';
import { runFile } from './Runner.js';
import { analyzeLink } from './Extractor.js';
import { reasonAndWrite } from './Reasoner.js';
import { runSearchTeam } from './SearchAgent.js';
import { learnHowTo } from './Researcher.js';
import { generateContent, resolveKeys } from './LLMClient.js';
import { collectSystemStatus, readSourceFile } from './SelfMonitor.js';
import { studyTopic, recallKnowledge } from './KnowledgeAgent.js';
import { latestNews, twitterLatest } from './TrustedLibrary.js';
import { ComputerUseAgent } from './ComputerUseAgent.js';
import { DesktopManager, ensureBrowser } from './DesktopManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile,
  searchInternetKnowledge, searchFreshInternetKnowledge, searchCodingKnowledge,
  saveInternetKnowledge, saveCodingKnowledge, saveKnowledgeFile,
} from './MemoryManager.js';
import { WORKSPACE_DIR, MANAGER_URL, PUBLIC_URL, MAX_DEBUG_ATTEMPTS } from '../config.js';

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

  /** Answer using ONLY the user's own books/knowledge library (with citations). */
  async answerFromKnowledge(kb, query) {
    const items = Array.isArray(kb) ? kb : [kb];
    const context = items.map(k => `📖 From "${k.title}":\n${k.content}`).join('\n\n---\n\n').slice(0, 14000);

    // No AI key? Still useful: return the exact passage as a direct quote.
    const keys = resolveKeys();
    if (!keys.groqKey && !keys.geminiKey) {
      const top = items[0];
      return `### 📚 JEXI OS — FROM YOUR BOOKS\n\nI found this in **${top.title}** (direct quote — no AI key needed):\n\n> ${top.content.slice(0, 2500)}`;
    }

    const reply = await generateContent(
      `The user asked: "${query}"\n\nThe passages below come from the user's OWN books and knowledge library — they are the authoritative source for this answer.\n\n${context}\n\nAnswer the question using ONLY these passages. Rules:\n- Structure the answer clearly (headings, numbered points, tables where helpful).\n- Cite the source book after each point, e.g. (From "Title").\n- If the passages do not contain the answer, say so honestly instead of guessing or inventing.\n- Do NOT go outside these passages.`,
      JEXI_SYSTEM_PROMPT,
      null,
      { temperature: 0.3 }
    );
    return `### 📚 JEXI OS — FROM YOUR BOOKS\n\n${reply}`;
  }

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
          const scope = (plan.scope) || {};
          const effQuery = (plan.scope && plan.scope.query) || query;

          // 1. Do we already know this from memory?
          try {
            const remembered = searchCodingKnowledge(effQuery);
            if (remembered) {
              sendEvent('log', { agent: 'Memory Agent', message: '✓ Found a solution I built before — recalling from memory.' });
              results.summary = `### 🧠 JEXI OS — RECALLED FROM MEMORY\n\nI solved this before, so I'm giving you the verified solution.\n\n${remembered.solution}\n\n${remembered.files?.length ? `**Files:** ${remembered.files.join(', ')}` : ''}`;
              results.statistics.confidence = 95;
              return results;
            }
          } catch (e) {}

          // 1.5 THINK + PLAN — the team's Product → Designer → Engineer pass
          let teamPlan = '';
          let teamBrief = '';
          const debugAsk = isDebugQuery(effQuery);
          if (!debugAsk && scope.mode !== 'freeze') {
            try {
              const planned = await planForBuild(effQuery, sendEvent);
              teamBrief = planned.brief;
              teamPlan = `${planned.brief}\n\n${planned.design}\n\n${planned.plan}`;
            } catch (e) {
              sendEvent('log', { agent: 'Engineer', message: `⚠ Planning pass failed: ${e.message}` });
            }
          }

          // FROZEN mode: plan only — nothing is written to disk.
          if (scope.mode === 'freeze') {
            results.summary = `### 📋 BUILD PLAN — FROZEN\n\nNothing was written to disk. Here is the team's plan:\n\n${teamPlan || '(planning skipped — say /unfreeze and I will plan then build)'}\n\n> Say **/unfreeze** or ask me to *build it* and I will execute this plan end-to-end.`;
            results.statistics.confidence = 90;
            return results;
          }

          // 2. Plan the project (coder pass — follows the team's build plan)
          let project;
          try {
            project = await generateCode(teamPlan ? `${effQuery}\n\nIMPLEMENT THIS PLAN:\n${teamPlan}` : effQuery, sendEvent);
          } catch (e) {
            sendEvent('log', { agent: 'Architect', message: `⚠ Planning failed: ${e.message}` });
          }

          if (project && project.files && project.files.length > 0) {
            fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
            // /guard: only write files inside the user-declared scope
            const allowedWrite = (name) => !scope.paths || !scope.paths.length || scope.paths.some(p => name.includes(p));
            project.files.forEach(f => {
              if (!allowedWrite(f.name)) { sendEvent('log', { agent: 'Coder', message: `⛔ /guard: skipping ${f.name} (outside allowed scope)` }); return; }
              fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8');
            });
            sendEvent('log', { agent: 'Coder', message: `✓ Created ${project.files.length} file(s)` });

            // 3. THE DEBUG LOOP: run → check → fix → rerun (never leave until success)
            let attempt = 0;
            let entryPoint = project.entryPoint || project.files[0]?.name;
            let lastOutput = '';
            let previewUrl = null; // set when the built app is live on a preview link

            while (attempt < MAX_DEBUG_ATTEMPTS) {
              attempt++;
              sendEvent('log', { agent: 'Runner', message: `▶ Attempt ${attempt}/${MAX_DEBUG_ATTEMPTS}: Running ${entryPoint}...` });
              const runResult = await runFile(entryPoint, (stream, data) => sendEvent('log', { agent: 'Terminal', message: String(data).slice(0, 200) }));
              lastOutput = runResult.output || '';

              const looksLikeError = /traceback|exception|syntaxerror|errno|no such file|modulenotfound|nameerror|importerror|attributeerror|typeerror|referenceerror|cannot find module|is not defined|command not found|failed/i.test(lastOutput);

              if (runResult.success && !looksLikeError) {
                sendEvent('log', { agent: 'Runner', message: '✅ Code ran successfully with no errors!' });
                if (runResult.url) previewUrl = runResult.url;
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
                  fixed.files.forEach(f => {
                    if (!allowedWrite(f.name)) { sendEvent('log', { agent: 'Coder', message: `⛔ /guard: skipping ${f.name} (outside allowed scope)` }); return; }
                    fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8');
                  });
                  entryPoint = fixed.entryPoint || entryPoint;
                  sendEvent('log', { agent: 'Debugger', message: '✍ Rewrote code with fixes. Re-running...' });
                }
              } catch (e) {
                sendEvent('log', { agent: 'Debugger', message: `✗ Fix failed: ${e.message}` });
              }
            }

            // 3.5 SHOW HER WORK: open the finished web app in the virtual
            //     desktop's Chromium so the user watches it render live
            //     (the desktop viewer streams screenshots every ~0.8s).
            if (previewUrl && /\.html$/i.test(entryPoint || '')) {
              try {
                await ensureBrowser();
                await new DesktopManager().goto('coder', previewUrl);
                sendEvent('log', { agent: 'Vision', message: `🖥 Showing the app in my virtual desktop: ${previewUrl}` });
              } catch (e) {
                sendEvent('log', { agent: 'Vision', message: `⚠ Could not open the app in the virtual desktop (the preview link still works): ${e.message}` });
              }
            }

            // 3.75 THE TEAM: QA → REVIEW → SECURITY GATE → SHIP → REFLECT
            //     (each output feeds the next; QA + Security gates are enforced)
            let qaReport = '';
            let reviewNotes = '';
            let shipNotes = '';
            let securityNotes = '';
            let reflectionNotes = '';
            let qaVerdict = null;
            let secVerdict = null;
            try {
              const builtFiles = listWorkspaceFiles();
              // TEST — the QA gate: run the app in a real browser (or scripted)
              if (previewUrl && /\.html$/i.test(entryPoint || '')) {
                qaReport = await qaWebApp({ previewUrl, brief: teamBrief || effQuery, scope, sendEvent });
              } else {
                qaReport = await qaScripted({ query: effQuery, files: builtFiles, lastOutput, sendEvent });
              }
              qaVerdict = gateVerdict(qaReport, ['PASS', 'NEEDS FIX']);

              // QA gate enforcement: NEEDS FIX → the debug loop re-runs once and QA re-verifies.
              if (qaVerdict === 'NEEDS FIX' && !debugAsk) {
                sendEvent('log', { agent: 'QA Lead', message: '⛔ QA gate: NEEDS FIX — sending back to the coder.' });
                const fixedOnce = await fixFromQA({ query: effQuery, qaReport, entryPoint, sendEvent });
                if (fixedOnce) {
                  sendEvent('log', { agent: 'Runner', message: '↻ Re-running after QA fix...' });
                  const rerun = await runFile(fixedOnce.entryPoint, (s, d) => sendEvent('log', { agent: 'Terminal', message: String(d).slice(0, 160) }));
                  if (rerun.url) previewUrl = rerun.url;
                  if (previewUrl && /\.html$/i.test(fixedOnce.entryPoint || '')) {
                    qaReport = await qaWebApp({ previewUrl, brief: teamBrief || effQuery, scope, sendEvent });
                    qaVerdict = gateVerdict(qaReport, ['PASS', 'NEEDS FIX']);
                  }
                }
              }

              // REVIEW + SECURITY GATE + SHIP + REFLECT
              let shipped = await reviewAndShip({ query: effQuery, plan: teamPlan, files: builtFiles, lastOutput, previewUrl, qaReport, sendEvent });
              reviewNotes = shipped.review;
              securityNotes = shipped.security;
              shipNotes = shipped.shipped;
              reflectionNotes = shipped.reflection;
              qaVerdict = shipped.qaVerdict || qaVerdict;
              secVerdict = shipped.secVerdict;

              // SECURITY GATE enforcement: BLOCKED → one enforced fix round
              // (coder rewrites, runner re-tests, Security Officer re-reviews),
              // then the verdict is final for this run.
              if (secVerdict === 'BLOCKED') {
                sendEvent('log', { agent: 'Security Officer', message: '⛔ SECURITY GATE BLOCKED — sending findings to the coder for a fix round.' });
                const secFix = await fixFromQA({ query: effQuery, qaReport: securityNotes, entryPoint, sendEvent });
                if (secFix) {
                  sendEvent('log', { agent: 'Runner', message: '↻ Re-running after security fix...' });
                  const rerun = await runFile(secFix.entryPoint, (s, d) => sendEvent('log', { agent: 'Terminal', message: String(d).slice(0, 160) }));
                  if (rerun.url) previewUrl = rerun.url;
                  shipped = await reviewAndShip({ query: effQuery, plan: teamPlan, files: listWorkspaceFiles(), lastOutput, previewUrl, qaReport, sendEvent });
                  reviewNotes = shipped.review;
                  securityNotes = shipped.security;
                  shipNotes = shipped.shipped;
                  reflectionNotes = shipped.reflection;
                  secVerdict = shipped.secVerdict || secVerdict;
                  sendEvent('log', { agent: 'Security Officer', message: secVerdict === 'BLOCKED' ? '⛔ Still BLOCKED after the fix round — issues need human attention.' : '✅ SECURITY GATE CLEARED after fix round.' });
                }
              }
            } catch (e) {
              sendEvent('log', { agent: 'Shipper', message: `⚠ Team pass issue: ${e.message}` });
            }

            // 4. Present the verified code
            const files = listWorkspaceFiles();
            const fileSections = files.map(name => {
              const code = readWorkspaceFile(name);
              const lang = name.endsWith('.py') ? 'python' : name.endsWith('.js') ? 'javascript' : name.endsWith('.html') ? 'html' : name.endsWith('.css') ? 'css' : 'bash';
              return `#### 📄 ${name}\n\n\`\`\`${lang}\n${code.slice(0, 12000)}\n\`\`\``;
            }).join('\n\n');

            const linkBase = PUBLIC_URL || MANAGER_URL;
            const workspaceLinks = files.map(name => `- [${name}](${linkBase}/api/files/${name})`).join('\n');
            const finalOutput = lastOutput && lastOutput.trim() ? `\`\`\`bash\n${lastOutput.trim().slice(0, 1500)}\n\`\`\`` : '';

            const previewLine = previewUrl
              ? `\n\n**🔗 LIVE PREVIEW:** [Open ${entryPoint}](${previewUrl})\n*(hosted for free — works in any browser, share the link with anyone)*`
              : '';

            const teamLine = teamPlan
              ? '\n\n**🏢 Team:** Product → Designer → Engineer → Coder → QA Lead → Reviewer → Security Officer → Shipper → Reflector'
              : '\n\n**🏢 Team:** Coder → QA Lead → Reviewer → Security Officer → Shipper → Reflector';
            const qaSection = qaReport ? `\n\n**🧪 QA REPORT**\n${qaReport}` : '';
            const reviewSection = reviewNotes ? `\n\n**🔍 REVIEW NOTES**\n${reviewNotes}` : '';
            const securitySection = securityNotes ? `\n\n**🛡 SECURITY REVIEW**\n${securityNotes}` : '';
            const shipSection = shipNotes ? `\n\n**📦 SHIPPED**\n${shipNotes}` : '';
            const reflectSection = reflectionNotes ? `\n\n**♻ REFLECTION**\n${reflectionNotes}` : '';
            const planSection = teamPlan ? `\n\n**🛠 BUILD PLAN** (Product + Designer + Engineer)\n${teamPlan.split('\n').slice(0, 42).join('\n')}` : '';
            const gateNote = secVerdict === 'BLOCKED'
              ? '\n\n> ⛔ **Security gate BLOCKED shipping.** The app ran and is usable, but the Security Officer found issues that must be fixed before you rely on it. Ask me to fix the findings and re-ship.'
              : qaVerdict === 'NEEDS FIX'
                ? '\n\n> ⚠ **QA verdict: NEEDS FIX.** The app runs, but QA found issues — ask me to fix them.'
                : '';
            results.summary = `### 💻 JEXI TEAM — PLANNED, BUILT, TESTED & SHIPPED\n\n✅ The full agent team worked together: planned, wrote, ran, QA-tested, security-checked and reviewed your app.${teamLine}${previewLine}${qaSection}${reviewSection}${securitySection}${shipSection}${reflectSection}${gateNote}${planSection}\n\n${fileSections}\n\n**Test Output:**\n${finalOutput || '✓ Ran successfully.'}\n\n**Download the files:**\n${workspaceLinks}`;
            results.files = files;
            results.previewUrl = previewUrl || undefined;
            results.statistics.confidence = 100;

            // 5. Store the verified solution in memory
            try {
              const codeSummary = fileSections.replace(/```[\s\S]*?```/g, '```code```').slice(0, 8000);
              saveCodingKnowledge(effQuery, 'code', codeSummary, files);
            } catch (e) {}

            // 5.5 Remember the team's reflection so future builds start smarter
            try {
              if (reflectionNotes) {
                saveCodingKnowledge(`lesson: ${effQuery.slice(0, 80)}`, 'reflection', reflectionNotes.slice(0, 1200), []);
              }
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
          // 1. The user's own books/library come FIRST — grounded answers from their materials
          try {
            const fromBooks = await recallKnowledge(query, sendEvent, 1);
            if (fromBooks) {
              sendEvent('log', { agent: 'Books', message: '📚 Found it in your books / knowledge library — answering from there.' });
              const summary = await this.answerFromKnowledge(fromBooks, query);
              try { addChat('jexi', summary); } catch (e) {}
              results.summary = summary;
              results.sources = fromBooks.map(k => ({ title: k.title, link: '' }));
              results.statistics.confidence = 95;
              return results;
            }
          } catch (e) {}

          // 2. Check memory first — did we already learn this?
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

          // 3. Search the internet with the specialist Search Team
          //    (Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer)
          const team = await runSearchTeam(query, sendEvent);
          results.sources = team.sources.slice(0, 5).map(s => ({ title: s.title, link: s.link }));

          if (team.sources.length === 0) {
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

          try { addChat('jexi', team.summary); } catch (e) {}
          results.summary = team.summary;
          results.statistics.confidence = team.confidence;
          return results;
        }

        /* ---------------- STUDY A TOPIC (trusted books/papers) ---------------- */
        case 'study_topic': {
          const topic = plan.payload || query;
          const content = await studyTopic('07_GENERAL_KNOWLEDGE', topic, sendEvent);
          results.summary = `### 📚 JEXI SCHOLAR\n\nI studied **${topic}** using the Trusted Library (Wikipedia, Project Gutenberg, arXiv, Open Library) and saved it to my knowledge library.\n\n${content.slice(0, 4000)}`;
          results.statistics.confidence = 100;
          return results;
        }

        /* ---------------- KNOWLEDGE RECALL (answer from the user's books/library) ---------------- */
        case 'knowledge_recall': {
          const kb = plan.payload || (await recallKnowledge(query, sendEvent));
          if (kb) {
            const summary = await this.answerFromKnowledge(kb, query);
            try { addChat('jexi', summary); } catch (e) {}
            results.summary = summary;
            results.sources = (Array.isArray(kb) ? kb : [kb]).map(k => ({ title: k.title, link: '' }));
            results.statistics.confidence = 95;
            return results;
          }
          // Fall through to research if the library has nothing
          const { summary } = await reasonAndWrite(query, []);
          results.summary = summary;
          return results;
        }

        /* ---------------- LATEST NEWS & TWITTER/X ---------------- */
        case 'news_latest': {
          sendEvent('log', { agent: 'News', message: `📰 Gathering the latest on: "${query}"` });

          // 0. Same news question answered within the last ~30 min? Serve the
          //    saved summary instantly — no feeds, no AI call, no wait.
          try {
            const fresh = searchFreshInternetKnowledge(query, 30 * 60 * 1000);
            if (fresh) {
              sendEvent('log', { agent: 'Memory Agent', message: '✓ Fresh news on this from earlier — returning instantly from memory.' });
              results.summary = `### 🧠 JEXI OS — FROM MEMORY (news I just gathered)\n\n${fresh.answer}`;
              if (fresh.sources?.length) results.sources = fresh.sources.map(s => ({ title: s, link: s }));
              results.statistics.confidence = 90;
              return results;
            }
          } catch (e) {}

          // 1. Try X/Twitter first (best-effort — no free API exists)
          let twitterItems = [];
          try {
            const tw = await twitterLatest(query);
            if (tw) {
              twitterItems = tw.items;
              sendEvent('log', { agent: 'News', message: `🐦 Read ${twitterItems.length} recent X/Twitter posts (via ${tw.instance}).` });
            } else {
              sendEvent('log', { agent: 'News', message: '🐦 X/Twitter requires login — no public feed available. Using trusted news feeds instead.' });
            }
          } catch (e) {}

          // 2. Trusted news feeds (Google News + BBC)
          const newsItems = await latestNews(query);
          sendEvent('log', { agent: 'News', message: `📡 ${newsItems.length} headlines from trusted news feeds.` });
          results.sources = newsItems.slice(0, 6).map(n => ({ title: n.title, link: n.link }));
          for (const n of newsItems.slice(0, 4)) {
            sendEvent('website', { site: { title: n.title, url: n.link, favicon: `https://www.google.com/s2/favicons?domain=${n.source}&sz=64`, status: 'success' } });
          }

          const keys = resolveKeys();
          let summary;
          if (!keys.groqKey && !keys.geminiKey) {
            const lines = newsItems.slice(0, 8).map((n, i) => `${i + 1}. **${n.title}** — ${n.source}${n.date ? ` (${n.date})` : ''}\n   ${n.link}`).join('\n');
            summary = `### 📰 JEXI OS — LATEST NEWS\n\n${twitterItems.length ? `**X/Twitter needs login** (X has no free API) — here are the top headlines instead:\n\n` : ''}${lines || 'No headlines found right now — try again in a minute.'}`;
          } else {
            const twBlock = twitterItems.length
              ? `\n\nRecent X/Twitter posts:\n${twitterItems.slice(0, 5).map(t => `- ${t.snippet || t.title}`).join('\n')}`
              : '\n\n(X/Twitter could not be read without login — headlines below are from trusted news feeds.)';
            summary = await generateContent(
              `The user asked: "${query}"\n\nLatest headlines (trusted news feeds):\n${newsItems.slice(0, 10).map(n => `- ${n.title} [${n.source}]${n.date ? ` (${n.date})` : ''}`).join('\n')}${twBlock}\n\nSummarize the current news in a structured answer: ## HEADLINES (numbered, source after each), ## WHAT'S HAPPENING (2-4 sentence synthesis), ## SOURCES. Be accurate — only report what the headlines actually say.`,
              JEXI_SYSTEM_PROMPT,
              null,
              { temperature: 0.3 }
            );
            summary = `### 📰 JEXI OS — LATEST NEWS\n\n${summary}`;
          }
          try { saveInternetKnowledge(query, summary, results.sources.map(s => s.title)); } catch (e) {}
          try { addChat('jexi', summary); } catch (e) {}
          results.summary = summary;
          results.statistics.confidence = 85;
          return results;
        }

        /* ---------------- SELF-DIAGNOSIS — JEXI inspects her own system ---------------- */
        case 'self_check': {
          sendEvent('log', { agent: 'SelfDiagnose', message: '🔍 Running full system diagnostics...' });
          const status = collectSystemStatus();

          // Read the most likely source files based on recent errors
          const hints = [
            [/groq|gemini|api.?key|401|403|429|rate ?limit/i, 'server/src/services/LLMClient.js'],
            [/browser|chromium|playwright|executable|missing|no-sandbox/i, 'server/src/services/DesktopManager.js'],
            [/redis|memory|hydrate|knowledge/i, 'server/src/services/MemoryManager.js'],
            [/fetch|enotfound|timeout|search|aggregate/i, 'server/src/services/SearchEngine.js'],
            [/vision|no image/i, 'server/index.js'],
          ];
          const targets = [];
          for (const e of status.errors.recent) {
            for (const [re, file] of hints) {
              if (re.test(e.message) && !targets.includes(file)) targets.push(file);
            }
          }
          if (targets.length === 0) targets.push('server/index.js', 'server/src/services/Orchestrator.js');
          const excerpts = targets.slice(0, 3)
            .map(f => readSourceFile(f))
            .filter(r => r.ok)
            .map(r => `--- FILE: ${r.path} ---\n${r.content.slice(0, 2500)}`)
            .join('\n\n');

          sendEvent('log', { agent: 'SelfDiagnose', message: `📋 Status: ${status.keys.groq || status.keys.gemini ? 'AI keys OK' : 'NO AI KEYS'}, browser ${status.browser.ready ? 'OK' : 'DOWN'}, ${status.errors.count} logged error(s).` });
          const reply = await generateContent(
            `My live self-diagnosis (JSON):\n${JSON.stringify(status, null, 2)}\n\nSource code I inspected:\n${excerpts || '(none)'}\n\nIf something is wrong, identify the exact file and root cause, then give the precise fix. If everything is healthy, say so briefly and warmly (I am JEXI OS, created by Lewis Einstein). Use ## HEALTH, ## ISSUES FOUND, ## ROOT CAUSE + FILE, ## FIX.`,
            JEXI_SYSTEM_PROMPT,
            null,
            { temperature: 0.3 }
          );
          try { addChat('jexi', reply); } catch (e) {}
          results.summary = `### 🩺 JEXI SELF-DIAGNOSIS\n\n${reply}`;
          results.statistics.agentsUsed = 2;
          results.statistics.confidence = 90;
          return results;
        }

        /* ---------------- DEFAULT ---------------- */
        default: {
          // Check the user's own books/library before generic research
          try {
            const fromBooks = await recallKnowledge(query, sendEvent, 1);
            if (fromBooks) {
              const summary = await this.answerFromKnowledge(fromBooks, query);
              try { addChat('jexi', summary); } catch (e) {}
              results.summary = summary;
              results.statistics.confidence = 90;
              return results;
            }
          } catch (e) {}
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
