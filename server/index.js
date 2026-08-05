import express from 'express';
import cors from 'cors';
import { aggregateSearch } from './src/services/SearchEngine.js';
import { extractContent } from './src/services/Extractor.js';
import { reasonAndWrite } from './src/services/Reasoner.js';
import { generateCode } from './src/services/Coder.js';
import { runFile } from './src/services/Runner.js';

const app = express();
app.use(cors());
app.use(express.json());
const cache = new Map();

app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: "No query provided" });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type, data) => res.write(JSON.stringify({ type, ...data }) + '\n');
  const startTime = Date.now();

  try {
    // ===== INTENT 1: APP RUNNER AGENT =====
    const isRunTask = /\b(run|execute|start)\b.*\.(py|js|sh|cpp)/gi.test(query);
    if (isRunTask) {
      sendEvent("log", { agent: "Orchestrator", message: `Execution task detected. Routing to App Runner...` });
      const fileMatch = query.match(/(\w+\.(py|js|sh|cpp))/);
      const fileName = fileMatch ? fileMatch[1] : null;

      if (!fileName) throw new Error("Could not identify file name to run.");

      sendEvent("log", { agent: "App Runner", message: `Preparing to execute ${fileName}...` });
      const result = await runFile(fileName);

      const markdown = `### ▶️ JEXI APP RUNNER\n\n**Executed:** \`${fileName}\`\n\n**Console Output:**\n\`\`\`bash\n${result.output}\n\`\`\``;

      sendEvent("log", { agent: "App Runner", message: result.success ? "✓ Execution completed." : "✗ Execution failed." });
      sendEvent("log", { agent: "Orchestrator", message: "Task Completed." });

      return sendEvent("done", {
        success: true,
        query,
        summary: markdown,
        sources: [],
        statistics: { websitesVisited: 0, pagesRead: 0, searchTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2)), confidence: 100 }
      });
    }

    // ===== INTENT 2: CODING AGENT =====
    const isCodingTask = /write a|code|function|script|program|build a|create a component/gi.test(query);
    if (isCodingTask && !query.includes('research')) {
      sendEvent("log", { agent: "Orchestrator", message: `Coding task detected. Routing to Coding Agent...` });
      sendEvent("log", { agent: "Coding Agent", message: "Analyzing language requirements..." });
      await new Promise(r => setTimeout(r, 1000));
      const codeResult = generateCode(query);
      sendEvent("log", { agent: "Coding Agent", message: `✓ Generated ${codeResult.fileName}.` });
      sendEvent("log", { agent: "Memory Agent", message: "Saving file to jexi-workspace..." });
      sendEvent("log", { agent: "Orchestrator", message: "Task Completed." });
      return sendEvent("done", {
        success: true, query, summary: codeResult.summary, sources: [],
        statistics: { websitesVisited: 0, pagesRead: 0, searchTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2)), confidence: 100 }
      });
    }

    // ===== INTENT 3: SEARCH/RESEARCH AGENT =====
    sendEvent("log", { agent: "Orchestrator", message: `Analyzing request: "${query}"` });
    const urlMatch = query.match(/(https?:\/\/[^\s]+)/);
    let sources = [];

    if (urlMatch) {
      sendEvent("log", { agent: "Orchestrator", message: `Direct URL detected. Bypassing search...` });
      sources = [{ title: 'Direct URL Input', link: urlMatch[0], snippet: '', source: 'Direct' }];
    } else {
      sendEvent("log", { agent: "Search Agent", message: "Querying SearXNG, DuckDuckGo, GitHub..." });
      sources = await aggregateSearch(query);
    }

    if (sources.length === 0) throw new Error("Could not find any sources.");
    sources = sources.slice(0, 8);
    sendEvent("log", { agent: "Search Agent", message: "Initiating concurrent crawlers..." });
    
    const results = await Promise.all(sources.map(async s => {
      if (cache.has(s.link)) return cache.get(s.link);
      try {
        const content = await extractContent(s.link);
        cache.set(s.link, content);
        sendEvent("log", { agent: "Search Agent", message: `✓ Visited ${new URL(s.link).hostname} | Read ${Math.floor(content.length/1000)}k chars.` });
        const visitData = { title: content.title, url: s.link, favicon: `https://www.google.com/s2/favicons?domain=${new URL(s.link).hostname}&sz=64`, wordCount: Math.floor(content.length / 4), status: 'success', method: content.method };
        sendEvent("website", { site: visitData });
        return { ...s, ...content, status: 'success' };
      } catch (err) {
        sendEvent("log", { agent: "Search Agent", message: `✗ Failed ${new URL(s.link).hostname}` });
        return { ...s, status: 'failed', error: err.message };
      }
    }));

    const successfulReads = results.filter(r => r.status === 'success');
    if (successfulReads.length === 0) throw new Error("All sources were blocked.");

    sendEvent("log", { agent: "Orchestrator", message: "Synthesizing response..." });
    const isSummarization = /summarize|summary|transcript|explain this/gi.test(query);
    const reasoning = reasonAndWrite(query, successfulReads, isSummarization);

    sendEvent("log", { agent: "Orchestrator", message: "Task Completed." });
    sendEvent("done", {
      success: true, query, summary: reasoning.summary,
      sources: successfulReads.map(r => ({ title: r.title, link: r.link, snippet: `Read via ${r.method}.`, source: new URL(r.link).hostname })),
      statistics: { websitesVisited: results.length, pagesRead: successfulReads.length, searchTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2)), confidence: reasoning.confidence }
    });

  } catch (error) {
    sendEvent("log", { agent: "System", message: `Critical Error: ${error.message}` });
    sendEvent("done", { success: false, error: error.message });
  } finally {
    res.end();
  }
});

app.listen(3002, '0.0.0.0', () => console.log('🧠 JEXI OS Orchestrator (Search + Coder + Runner) running on port 3002'));
