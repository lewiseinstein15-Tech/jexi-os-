/**
 * JEXI OS — Agent Loop (roadmap stage 12: Orchestrator v2 — tool-calling loop).
 *
 * The classic orchestrator runs specialists that WRITE text and JEXI parses
 * it — fine, but the model never gets to actually USE a tool mid-answer. This
 * is the biggest gap vs Grok Build (which assembles context → model → tool
 * dispatch → loop). AgentLoop closes it with a real tool-calling loop:
 *
 *   plan (Planner composes team + auto tool set)
 *   → generate (model may emit a tool call as a ```json block)
 *   → execute (ToolRuntime runs it with permission gates + tool.* events)
 *   → feed results back into context
 *   → repeat (max iterations + call cap)
 *   → finalize (model writes the final answer with real tool evidence)
 *
 * The tool set offered is ALWAYS the auto-selected subset for the intent
 * (AutoTool-style pruning — never the whole catalog).
 */

import { Planner } from './Planner.js';
import { getTool } from './ToolRegistry.js';
import { executeTool, activeToolProfile, TOOL_PROFILES } from './ToolRuntime.js';
import { generateContent } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { preferencesBlock } from './PreferenceLearner.js';
import { providerPreferenceForIntent } from './ModelRouting.js';

const MAX_ITERATIONS = 4;
const MAX_TOOL_CALLS = 8;

/** Planner.analyzeIntent returns a plan (intent/teamSlugs/steps/tools/toolsLine). */
async function safePlan(query, image) {
  try {
    return await Planner.analyzeIntent(query, image ? { image: true } : {});
  } catch (e) {
    return { intent: 'research', teamSlugs: ['researcher'], steps: ['Researcher'], planSummary: 'Analyze and answer', tools: [], toolsLine: '', toolCount: 0 };
  }
}

/** Extract tool-call objects from model text: ```json blocks or inline {"tool":...}. */
export function extractToolCalls(text) {
  const calls = [];
  const seen = new Set();

  // Fenced json blocks (the documented convention)
  const fences = String(text || '').match(/```json\s*([\s\S]*?)```/g) || [];
  for (const fence of fences) {
    const body = fence.replace(/^```json\s*/, '').replace(/```$/, '').trim();
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.tool && !seen.has(parsed.tool + JSON.stringify(parsed.args || {}))) {
        seen.add(parsed.tool + JSON.stringify(parsed.args || {}));
        calls.push(parsed);
      }
    } catch (e) { /* not json — ignore */ }
  }

  // Inline {"tool": "...", "args": {...}} objects — brace-counted so nested
  // args objects don't truncate the JSON.
  if (!calls.length) {
    const str = String(text || '');
    const starts = [];
    let i = 0;
    while ((i = str.indexOf('{"tool"', i)) !== -1) { starts.push(i); i += 7; }
    for (const start of starts) {
      let depth = 0, end = -1;
      for (let j = start; j < str.length; j++) {
        if (str[j] === '{') depth++;
        else if (str[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
      }
      if (end === -1) continue;
      try {
        const parsed = JSON.parse(str.slice(start, end));
        if (parsed.tool && !seen.has(parsed.tool + JSON.stringify(parsed.args || {}))) {
          seen.add(parsed.tool + JSON.stringify(parsed.args || {}));
          calls.push(parsed);
        }
      } catch (e) { /* ignore */ }
    }
  }

  return calls.slice(0, MAX_TOOL_CALLS);
}

/**
 * Run the tool-calling loop. Streams events via sendEvent:
 *   agent.plan  → { query, intent, team, tools }
 *   agent.log   → { message }            (what the loop is doing)
 *   tool.start  → { tool, name, permission, profile }
 *   tool.result → { tool, ok, durationMs, preview/error }
 *   agent.done  → { answer, stats }
 */
export async function runAgentLoop({ query, image, sendEvent, opts = {} }) {
  const start = Date.now();
  if (typeof sendEvent !== 'function') sendEvent = () => {};
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch (e) {} };
  // Test seam: a caller may inject a deterministic final answer (no LLM keys
  // needed) so isolation/loop behaviour is provable without network calls.
  if (opts.__mockAnswer !== undefined) {
    const mock = String(opts.__mockAnswer);
    emit('agent.done', { answer: mock, stats: { iterations: 1, toolCalls: 0, tools: 0, durationMs: Date.now() - start } });
    return { answer: mock, stats: { toolCalls: 0, tools: 0, durationMs: Date.now() - start } };
  }
  const checkCancelled = () => {
    if (opts.signal && opts.signal.aborted) {
      emit('agent.done', { answer: '', cancelled: true, stats: { cancelled: true, toolCalls: callsMade, tools: tools.length, durationMs: Date.now() - start } });
      return true;
    }
    return false;
  };

  const plan = await safePlan(query, image);
  const team = plan.teamSlugs || [];
  const tools = (plan.tools || []).map((slug) => getTool(slug)).filter(Boolean).slice(0, 12);
  const profile = opts.profile || activeToolProfile();
  const prefer = providerPreferenceForIntent(plan.intent); // stage 24: per-domain model routing

  emit('agent.plan', {
    query, intent: plan.intent,
    team: team.length ? team : plan.steps || [],
    tools: tools.map((t) => ({ slug: t.slug, name: t.name, type: t.type })),
    profile, profileLabel: TOOL_PROFILES[profile]?.label,
  });
  emit('agent.log', { message: `🧠 Plan: ${plan.planSummary || plan.intent}. Loop with ${tools.length} auto-selected tools (profile: ${profile}).` });

  const toolContext = [];   // {tool, args, result} evidence fed back to the model
  let callsMade = 0;
  let finalText = '';

  if (checkCancelled()) return { answer: '', cancelled: true, stats: { cancelled: true, toolCalls: 0, tools: tools.length, durationMs: Date.now() - start } };

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    if (checkCancelled()) return { answer: '', cancelled: true, stats: { cancelled: true, toolCalls: callsMade, tools: tools.length, durationMs: Date.now() - start } };
    const canCall = tools.length > 0 && callsMade < MAX_TOOL_CALLS;

    const prompt = buildPrompt({ query, image, tools, toolContext, iteration: iter, canCall });

    let reply;
    try {
      reply = await generateContent(prompt, JEXI_SYSTEM_PROMPT + preferencesBlock(), image || null, { temperature: 0.3, prefer });
    } catch (e) {
      emit('agent.log', { message: `⚠ Generation failed: ${(e && e.message) || e}. Finishing with what we have.` });
      finalText = String(reply || '');
      break;
    }

    if (!canCall) {
      finalText = String(reply || '');
      break;
    }

    const calls = extractToolCalls(reply);
    if (!calls.length) {
      finalText = String(reply || '');
      break; // model answered directly — done
    }

    emit('agent.log', { message: `🔁 Iteration ${iter}: ${calls.length} tool call(s) requested → executing…` });

    let allFailed = true;
    for (const call of calls) {
      callsMade++;
      const allowedSlugs = new Set(tools.map((t) => t.slug));
      if (!allowedSlugs.has(call.tool)) {
        emit('tool.result', { tool: call.tool, ok: false, error: `Not in the auto-selected tool set for this task (${allowedSlugs.size} tools).` });
        toolContext.push({ tool: call.tool, args: call.args, error: 'Tool not in allowed set' });
        continue;
      }
      const res = await executeTool({ slug: call.tool, args: call.args || {}, profile, sendEvent: emit });
      toolContext.push({ tool: call.tool, args: call.args || {}, ok: res.ok, result: res.result, error: res.error });
      if (res.ok) allFailed = false;
      if (res.blocked) {
        emit('agent.log', { message: `⛔ ${call.tool} blocked by permission profile "${profile}".` });
        break;
      }
    }

    // All calls failed (bad args / no engine / blocked) — stop looping, let the
    // model answer from knowledge rather than burning iterations.
    if (allFailed && callsMade >= MAX_TOOL_CALLS) {
      finalText = String(reply || '');
      break;
    }
  }

  // Final synthesis pass: if we made tool calls but never got a clean answer,
  // generate the final answer with the tool evidence included.
  if (!finalText && toolContext.length) {
    const evidence = toolContext.map((c) => `## Tool: ${c.tool}\n${c.error ? `ERROR: ${c.error}` : c.result}`).join('\n\n');
    try {
      finalText = await generateContent(
        `The user asked: "${query}"\n\nHere is the real evidence gathered from tools:\n\n${evidence.slice(0, 14000)}\n\nWrite the final answer to the user based ONLY on this evidence, structured with headings, LaTeX for math, and code blocks for code. Do not invent facts not in the evidence.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock(),
        image || null,
        { temperature: 0.3, prefer }
      );
    } catch (e) {
      finalText = `Tool evidence collected (${toolContext.length} calls) but final synthesis failed: ${(e && e.message) || e}`;
    }
  }

  finalText = String(finalText || 'I gathered tool results but could not produce a final answer.').trim();

  emit('agent.done', {
    answer: finalText,
    stats: {
      iterations: Math.min(MAX_ITERATIONS, callsMade ? MAX_ITERATIONS : 1),
      toolCalls: callsMade,
      tools: tools.length,
      durationMs: Date.now() - start,
      profile,
    },
  });

  return { answer: finalText, stats: { toolCalls: callsMade, tools: tools.length, durationMs: Date.now() - start } };
}

function buildPrompt({ query, image, tools, toolContext, iteration, canCall }) {
  const toolList = tools.map((t) => `- ${t.slug}: ${t.desc}`).join('\n');

  let context = '';
  if (toolContext.length) {
    context = '\n\nTOOL RESULTS SO FAR (real, verified — use them):\n' + toolContext.map((c) =>
      `### ${c.tool} ${c.args ? JSON.stringify(c.args).slice(0, 200) : ''}\n${c.error ? `ERROR: ${c.error}` : String(c.result || '').slice(0, 2500)}`
    ).join('\n\n').slice(0, 12000);
  }

  const callInstruction = canCall
    ? `\n\nIf you need real data to answer, call a tool from the list below by emitting ONE fenced json block like this:\n\`\`\`json\n{"tool": "web-search", "args": {"query": "..."}}\n\`\`\`\nUse only tools from this list: ${tools.map((t) => t.slug).join(', ')}. Then WAIT — your tool results will be appended and you can continue. If you can answer from knowledge/memory alone, answer directly without a tool call.`
    : '\n\nYou have used all available tool calls. Answer now using the tool results already provided.';

  return `The user asked: "${query}"${image ? '\n(An image was provided — analyze it.)' : ''}\n\nAuto-selected tools for this task:\n${toolList || '(none — answer from knowledge)'}${context}${callInstruction}`;
}
