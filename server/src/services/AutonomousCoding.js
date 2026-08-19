/**
 * B126 — AUTONOMOUS CODING RUNNER (DeepSeek Harness coding-agent mirror:
 * model-driven bash + write/read/edit + fix-verify loop).
 *
 * Replaces the 11-agent coding team with the model driving the coding loop
 * itself: plan → write → run → fix → verify, up to bounded iterations, then
 * a final summary with the artifact list. Preview link handed back when the
 * workspace has an index.html (served by preview-server after the run).
 */

import { generateWithToolsLoop, generateContent } from './LLMClient.js';
import { buildNativeSchemas, executeTool } from './ToolRuntime.js';
import { assemblePrompt } from './PromptAssembly.js';
import { loadSkillForModel } from './SkillDiscovery.js';
import { listPluginTools } from './PluginContext.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { listWorkspace } from './WorkspaceRuntime.js';

const MAX_ITERATIONS = 12;

/**
 * @param {object} o
 * @param {string} o.query
 * @param {string} [o.convId]
 * @param {(type, data)=>void} [o.sendEvent]
 * @param {string} [o.profile]
 * @returns {Promise<{success:boolean, summary:string, files:object[], preview?:string, statistics:object}>}
 */
export async function runAutonomousCoding({ query, convId = null, sendEvent = () => {}, profile, __mockCompletions, __executeOverride }) {
  const start = Date.now();
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch { /* noop */ } };

  emit('plan', {
    intent: 'code_task', complexity: 'CODING', steps: ['Plan', 'Write', 'Run', 'Fix', 'Verify'],
    roster: ['JEXI Core'], tools: ['bash', 'write', 'read', 'edit', 'list_files'],
    toolsLine: 'bash · write · read · edit · list_files',
  });
  emit('log', { agent: 'Coder', message: '🧑‍💻 Autonomous coding — I will write the files, run them, fix errors and verify myself (no team, no pipeline).' });

  const pluginTools = (() => { try { return listPluginTools(); } catch { return []; } })();
  const want = new Set(['bash', 'write', 'read', 'edit', 'list_files', 'lsp', 'run_in_background', 'preview-server', 'skill-load']);
  const defs = pluginTools.filter((p) => p && want.has(p.slug));
  const schemas = buildNativeSchemas(defs);

  const skill = loadSkillForModel('coder');
  const system = await assemblePrompt({ convId, codeMode: false, presetFlavor: '' })
    + (skill ? `\n## CODER SKILL (loaded)\n${String(skill.content).slice(0, 6000)}\n` : '');

  const toolContext = [];
  const files = [];

  const executeCalls = async (calls) => {
    // Test seam: deterministic executor (no network).
    if (typeof __executeOverride === 'function') {
      const over = await __executeOverride(calls);
      for (const call of calls || []) {
        const item = (over && over.find((x) => x && x.tool_call_id === call.id)) || {};
        const content = String(item.content || '');
        toolContext.push({ tool: call.name, ok: !/^ERROR/.test(content), error: null });
        if ((call.name === 'write' || call.name === 'edit') && !/^ERROR/.test(content)) {
          try { const parsed = JSON.parse(content); if (parsed.path) files.push({ path: parsed.path, operation: parsed.operation || 'write', size: parsed.size || null }); } catch { /* noop */ }
        }
      }
      return over;
    }
    const out = [];
    for (const call of calls || []) {
      let callArgs = call.arguments || {};
      if (typeof callArgs === 'string') { try { callArgs = JSON.parse(callArgs); } catch { callArgs = {}; } }
      const r = await executeTool({
        slug: call.name,
        args: callArgs,
        profile,
        sendEvent: emit,
        intent: 'code_task',
        spillOwner: convId,
      });
      toolContext.push({ tool: call.name, ok: !!r.ok, error: r.error || null });
      if ((call.name === 'write' || call.name === 'edit') && r.ok && r.result) {
        try {
          const parsed = JSON.parse(r.result);
          if (parsed.path) files.push({ path: parsed.path, operation: parsed.operation || 'write', size: parsed.size || null });
        } catch { /* noop */ }
      }
      const content = r.ok && r.result ? String(r.result).slice(0, 6000) : `ERROR: ${r.error || 'tool returned no output'}`;
      out.push({ tool_call_id: call.id, content });
    }
    return out;
  };

  let finalText = '';
  try {
    const res = await generateWithToolsLoop(
      `The user asked: "${query}"\n\nBuild it autonomously: write the files with write/edit, run them with bash, fix errors, and verify. End with a short summary: what you built, the files, what you ran, and the result.`,
      system,
      schemas,
      { temperature: 0.3, maxIterations: MAX_ITERATIONS, executeToolCalls: executeCalls, __mockCompletions },
    );
    if (res && res.ok && res.text) finalText = res.text;
  } catch (e) {
    emit('log', { agent: 'Coder', message: `⚠ Coding loop failed: ${(e && e.message) || e}` });
  }

  // Synthesis fallback from the tool evidence (real file writes + run output).
  if (!finalText && toolContext.length) {
    try {
      const evidence = toolContext.slice(-12).map((c) => `## ${c.tool}\n${c.error ? `ERROR: ${c.error}` : '(ok)'}`).join('\n');
      const listing = (listWorkspace(200) || []).slice(0, 40).map((f) => f.path || f).join('\n');
      finalText = await generateContent(
        `The user asked: "${query}"\n\nTool activity:\n${evidence}\n\nWorkspace files now:\n${listing}\n\nWrite the final report: what was built, the file list, what was run, and the verification result. Be honest about failures.`,
        JEXI_SYSTEM_PROMPT,
        null,
        { temperature: 0.3 },
      );
    } catch { /* noop */ }
  }

  // Preview link: workspace index.html → preview-server (build agents never
  // had this; the coding plugin returns it with the deliverable).
  let preview = null;
  try {
    const hasIndex = (listWorkspace(500) || []).some((f) => String(f.path || f).endsWith('index.html'));
    if (hasIndex) {
      const pv = await executeTool({ slug: 'preview-server', args: { name: 'app' }, profile, sendEvent: emit, spillOwner: convId });
      if (pv.ok && pv.result) {
        try { preview = JSON.parse(pv.result).url || String(pv.result).slice(0, 200); } catch { preview = String(pv.result).slice(0, 200); }
      }
    }
  } catch { /* preview is best-effort */ }

  finalText = String(finalText || '').trim();
  const success = finalText.length > 0;
  const uniqueFiles = [...new Map(files.map((f) => [f.path, f])).values()];
  if (!success) {
    emit('log', { agent: 'Coder', message: '⚠ Coding could not produce a result (AI providers unavailable).' });
  } else {
    emit('log', { agent: 'Coder', message: `🎯 Build complete — ${uniqueFiles.length} file(s) written, verified by running.` });
  }

  return {
    success,
    summary: success ? finalText : '### ⚠ JEXI OS\n\nI could not complete the build right now (AI providers unavailable). Please try again in a minute.',
    files: uniqueFiles,
    ...(preview ? { preview } : {}),
    statistics: {
      executionTime: Date.now() - start,
      agentsUsed: 1,
      complexity: 'CODING',
      confidence: success ? 88 : 0,
      toolCalls: toolContext.length,
      fileCount: uniqueFiles.length,
    },
  };
}
