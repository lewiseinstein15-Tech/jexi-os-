/**
 * B125 — DSH-STYLE RESEARCH RUNNER (DeepSeek Harness `tool-web` mirror).
 *
 * Replaces the multi-agent research pipeline (Query Analyzer → Searcher →
 * Re-ranker → Extractor → Synthesizer) with DSH's model-driven research:
 * the model drives web_search → web_fetch itself in the tool loop, guided
 * by the research skill, and synthesizes a cited answer. Sources collected
 * from web_search results ride the done payload for the UI.
 */

import { generateWithToolsLoop, generateContent } from './LLMClient.js';
import { buildNativeSchemas, executeTool } from './ToolRuntime.js';
import { assemblePrompt } from './PromptAssembly.js';
import { loadSkillForModel } from './SkillDiscovery.js';
import { listPluginTools } from './PluginContext.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';

const MAX_ITERATIONS = 10;
const MAX_SOURCES = 12;

/**
 * Run DSH-style research.
 * @param {object} o
 * @param {string} o.query
 * @param {string} [o.convId]
 * @param {(type:string, data:object)=>void} [o.sendEvent]
 * @param {string} [o.profile]
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{success:boolean, summary:string, sources:object[], statistics:object}>}
 */
export async function runDshResearch({ query, convId = null, sendEvent = () => {}, profile, signal, __mockCompletions, __executeOverride }) {
  const start = Date.now();
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch { /* noop */ } };

  emit('plan', {
    intent: 'research', complexity: 'RESEARCH', steps: ['Web Search', 'Web Fetch', 'Synthesize'],
    roster: ['JEXI Core'], tools: ['web_search', 'web_fetch'], toolsLine: 'web_search · web_fetch',
  });
  emit('log', { agent: 'Researcher', message: '🔎 DSH-style research — I will search, open the best sources myself, and synthesize a cited answer (no pipeline).' });

  // Research tools: ONLY web_search + web_fetch (+ skill-load so the model can
  // pull other skills; subagent for delegating a sub-question). NO registry
  // search engines, no team — exactly DSH's tool-web set.
  const pluginTools = (() => { try { return listPluginTools(); } catch { return []; } })();
  const want = new Set(['web_search', 'web_fetch', 'skill-load', 'subagent']);
  const defs = pluginTools.filter((p) => p && want.has(p.slug));
  const schemas = buildNativeSchemas(defs);

  // The research skill body (progressive) rides the system prompt.
  const skill = loadSkillForModel('research');
  const system = await assemblePrompt({ convId, codeMode: false, presetFlavor: '' })
    + (skill ? `\n## RESEARCH SKILL (loaded)\n${String(skill.content).slice(0, 6000)}\n` : '');

  const sources = new Map();
  const toolContext = [];

  const collectSources = (raw) => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      for (const s of (parsed && parsed.sources) || []) {
        if (s && s.url) sources.set(s.url, { url: s.url, title: s.title || '', snippet: s.snippet || '' });
      }
    } catch { /* noop */ }
  };

  const executeCalls = async (calls) => {
    const out = [];
    for (const call of calls || []) {
      let r;
      if (typeof __executeOverride === 'function') {
        // Test seam: deterministic executor (no network). Returns the SAME
        // array shape the gate path produces.
        const over = await __executeOverride([call]);
        const item = (over && over[0]) || {};
        r = { ok: !/^ERROR/.test(String(item.content || '')), result: item.content, error: null };
      } else {
        r = await executeTool({
          slug: call.name,
          args: call.arguments || {},
          profile,
          sendEvent: emit,
          intent: 'research',
          spillOwner: convId,
        });
      }
      toolContext.push({ tool: call.name, ok: !!r.ok, error: r.error || null });
      if (call.name === 'web_search' && r.ok && r.result) collectSources(r.result);
      const content = r.ok && r.result ? String(r.result).slice(0, 6000) : `ERROR: ${r.error || 'tool returned no output'}`;
      out.push({ tool_call_id: call.id, content });
    }
    return out;
  };

  let finalText = '';
  try {
    const res = await generateWithToolsLoop(
      `The user asked: "${query}"\n\nResearch this thoroughly: search multiple angles, fetch the most authoritative sources, and answer with inline markdown citations.`,
      system,
      schemas,
      { temperature: 0.3, maxIterations: MAX_ITERATIONS, signal, executeToolCalls: executeCalls, __mockCompletions },
    );
    if (res && res.ok && res.text) finalText = res.text;
  } catch (e) {
    emit('log', { agent: 'Researcher', message: `⚠ Research loop failed: ${(e && e.message) || e}` });
  }

  // Synthesis fallback: the loop capped out but sources were gathered —
  // never leave the user with nothing (same guarantee as the main loop).
  if (!finalText && sources.size) {
    try {
      const evidence = [...sources.values()].slice(0, MAX_SOURCES)
        .map((s) => `## ${s.title}\n${s.url}\n${String(s.snippet || '').slice(0, 500)}`)
        .join('\n\n');
      finalText = await generateContent(
        `The user asked: "${query}"\n\nReal search evidence collected:\n\n${evidence.slice(0, 14000)}\n\nWrite the final answer based ONLY on this evidence, with headings, inline markdown citations, and a ## Sources list. Do not invent facts not in the evidence.`,
        JEXI_SYSTEM_PROMPT,
        null,
        { temperature: 0.3 },
      );
    } catch { /* noop */ }
  }

  finalText = String(finalText || '').trim();
  const success = finalText.length > 0;
  if (!success) {
    emit('log', { agent: 'Researcher', message: '⚠ Research could not produce an answer (AI providers unavailable).' });
  } else {
    emit('log', { agent: 'Researcher', message: `🎯 Research complete — ${sources.size} source(s) gathered, answer synthesized with citations.` });
  }

  return {
    success,
    summary: success ? finalText : '### ⚠ JEXI OS\n\nI could not complete the research right now (AI providers unavailable). Please try again in a minute.',
    sources: [...sources.values()].slice(0, MAX_SOURCES),
    statistics: {
      executionTime: Date.now() - start,
      agentsUsed: 1,
      complexity: 'RESEARCH',
      confidence: success ? 85 : 0,
      provider: null,
      toolCalls: toolContext.length,
      sourceCount: sources.size,
    },
  };
}
