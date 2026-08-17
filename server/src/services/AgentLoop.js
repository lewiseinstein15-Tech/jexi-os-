/**
 * JEXI OS — Agent Loop (roadmap stage 12: Orchestrator v2 — tool-calling loop).
 *
 * B67 — this loop now uses REAL native function calling. The old version made
 * the model emit ```json {"tool": ...} blocks in prose and JEXI parsed them
 * with extractToolCalls — fragile, provider-dependent, and unlike every modern
 * agent runtime. The B67 loop drives the provider's NATIVE tool_calls API
 * (Groq / OpenRouter / DeepSeek / xAI / Cerebras / DeepInfra / Mistral) and
 * executes the declared calls through the same gated ToolRuntime:
 *
 *   plan (Planner composes team + auto tool set)
 *   → generate (provider emits real tool_calls)
 *   → execute (ToolRuntime runs them with permission gates + tool.* events)
 *   → feed results back into the conversation
 *   → repeat (bounded maxIterations)
 *   → final answer written by the model from real tool evidence
 *
 * The tool set offered is ALWAYS the auto-selected, executable subset for the
 * intent (AutoTool-style pruning — never the whole catalog).
 *
 * Event stream (unchanged — /api/agent and SubagentRuntime depend on it):
 *   agent.plan  → { query, intent, team, tools }
 *   agent.log   → { message }
 *   tool.start  → { tool, name, permission, profile }
 *   tool.result → { tool, ok, durationMs, preview/error }
 *   agent.done  → { answer, stats }
 */

import { Planner } from './Planner.js';
import { getTool } from './ToolRegistry.js';
import { buildNativeSchemas, executeTool, activeToolProfile, TOOL_PROFILES, isToolDone } from './ToolRuntime.js';
import { generateWithToolsLoop, generateContent } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { buildSkillCatalog } from './SkillDiscovery.js'; // B98 — dsh-style available-skills catalog (metadata only)
import { preferencesBlock } from './PreferenceLearner.js';
import { providerPreferenceForIntent } from './ModelRouting.js';

// B96 — DeepSeek-Harness-style loop: more steps per turn (the rate limiter
// protects free tiers), with turn/step events streamed like dsh's event log.
const MAX_ITERATIONS = 10;
const MAX_TOOL_CALLS = 20;

/** Planner.analyzeIntent returns a plan (intent/teamSlugs/steps/tools/toolsLine). */
async function safePlan(query, image) {
  try {
    return await Planner.analyzeIntent(query, image ? { image: true } : {});
  } catch (e) {
    return { intent: 'research', teamSlugs: ['researcher'], steps: ['Researcher'], planSummary: 'Analyze and answer', tools: [], toolsLine: '', toolCount: 0 };
  }
}

/**
 * Run the native tool-calling loop. Streams events via sendEvent (see the
 * stream contract at the top). Keeps its call signature — SubagentRuntime
 * and /api/agent call it with { query, image, sendEvent, opts }.
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
      emit('agent.done', { answer: '', cancelled: true, stats: { cancelled: true, toolCalls: callsMade, tools: schemas.length, durationMs: Date.now() - start } });
      return true;
    }
    return false;
  };

  const plan = await safePlan(query, image);
  const team = plan.teamSlugs || [];
  // Only tools with a real executable engine (TOOL_SCHEMAS entry) are offered —
  // buildNativeSchemas drops registry-only tools instead of giving the model
  // routing dead-ends.
  const toolDefs = (plan.tools || []).map((slug) => getTool(slug)).filter(Boolean).slice(0, 12);
  const schemas = buildNativeSchemas(toolDefs);
  const profile = opts.profile || activeToolProfile();
  const prefer = providerPreferenceForIntent(plan.intent); // stage 24: per-domain model routing

  emit('agent.plan', {
    query, intent: plan.intent,
    team: team.length ? team : plan.steps || [],
    tools: toolDefs.map((t) => ({ slug: t.slug, name: t.name, type: t.type })),
    profile, profileLabel: TOOL_PROFILES[profile]?.label,
  });
  emit('agent.log', { message: `🧠 Plan: ${plan.planSummary || plan.intent}. Native tool-calling loop with ${schemas.length} executable tools (profile: ${profile}).` });

  const toolContext = [];   // {tool, args, result} evidence (for the synthesis fallback)
  let callsMade = 0;
  let finalText = '';

  if (checkCancelled()) return { answer: '', cancelled: true, stats: { cancelled: true, toolCalls: 0, tools: schemas.length, durationMs: Date.now() - start } };

  try {
    const res = await generateWithToolsLoop(
      `The user asked: "${query}"${image ? '\n(An image was provided — analyze it.)' : ''}`,
      (opts.systemPromptOverride || JEXI_SYSTEM_PROMPT) + buildSkillCatalog(30) + preferencesBlock(),
      schemas,
      {
        temperature: 0.3,
        prefer,
        signal: opts.signal,
        maxIterations: MAX_ITERATIONS,
        // Execute the model's native tool calls through the gated runtime —
        // the same permission/risk/approval path as every other tool call.
        executeToolCalls: async (calls) => {
          const results = [];
          for (const call of calls) {
            if (callsMade >= MAX_TOOL_CALLS) {
              results.push({ tool_call_id: call.id, content: 'ERROR: tool-call budget exhausted for this task.' });
              continue;
            }
            callsMade++;
            // B96 — dsh-style step events: tool/call + tool/result on the wire.
            try { emit('step/start', { turn: 1, step: callsMade }); } catch (e) {}
            try { emit('tool/call', { callId: call.id, name: call.name, arguments: JSON.stringify(call.arguments || {}).slice(0, 500) }); } catch (e) {}
            const r = await executeTool({ slug: call.name, args: call.arguments || {}, profile, sendEvent: emit, confirm: opts.confirm });
            try { emit('tool/result', { callId: call.id, name: call.name, ok: !!r.ok, error: r.error || null }); } catch (e) {}
            try { emit('step/end', { turn: 1, step: callsMade }); } catch (e) {}
            const done = isToolDone(r);
            toolContext.push({ tool: call.name, args: call.arguments || {}, ok: r.ok, done, error: r.error, result: r.result, paused: r.paused === true || r.approvalRequired === true, blocked: r.blocked === true });
            if (r.paused || r.approvalRequired) {
              emit('agent.log', { message: `⏸ ${call.name} is an external action and needs your approval (real finalized details shown) — waiting for your yes/no before it can run.` });
            }
            if (r.blocked) {
              emit('agent.log', { message: `⛔ ${call.name} blocked by permission profile "${profile}".` });
            }
            if (r.routed) {
              emit('agent.log', { message: `🧭 ${call.name} is routed to its owning agents for the pipeline — it did NOT execute here, so it is not counted as a completed step.` });
            }
            const content = r.ok && r.result ? String(r.result).slice(0, 6000) : `ERROR: ${r.error || 'tool returned no output'}`;
            results.push({ tool_call_id: call.id, content });
          }
          return results;
        },
      }
    );
    finalText = res.ok ? res.text : '';
  } catch (e) {
    emit('agent.log', { message: `⚠ Generation failed: ${(e && e.message) || e}. Finishing with what we have.` });
  }

  // Final synthesis pass: if we made tool calls but never got a clean answer
  // (loop hit its iteration cap), generate the final answer from the real
  // tool evidence instead of leaving the user with nothing.
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
      tools: schemas.length,
      durationMs: Date.now() - start,
      profile,
    },
  });

  return { answer: finalText, stats: { toolCalls: callsMade, tools: schemas.length, durationMs: Date.now() - start } };
}
