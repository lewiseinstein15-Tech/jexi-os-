/**
 * JEXI OS — SimpleTask (B66, Orchestrator-Workers 3a/3c).
 *
 * The SIMPLE fast path: ONE coworker, ONE loop, NO graph construction.
 * Invoked from the chat handler when the planner judged the task SIMPLE
 * (conversation / direct_answer / translate / math_solve). It:
 *   - emits an auditable `orchestrator.classify` event (complexity + reason),
 *   - assigns the coworker by task type via WorkerRouter,
 *   - runs the worker with conversation context + format rules,
 *   - normalizes formatting before returning (Formatting.normalizeFinalAnswer),
 *   - reports failure truthfully — a degraded response says so plainly;
 *     never a raw error dump, never a fake success (3a truthfulness).
 */

import { conversationContext } from './Orchestrator.js';
import { addChat } from './MemoryManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { preferencesBlock } from './PreferenceLearner.js';
import { runWorker, coworkerFor } from './WorkerRouter.js';
import { normalizeFinalAnswer, FORMAT_RULES } from './Formatting.js';

const COWORKER_LABELS = {
  coder: 'Coder (DeepSeek/Qwen)',
  memory: 'Memory (Qwen/Gemini)',
  researcher: 'Researcher (Grok/Groq/OpenRouter)',
};

/**
 * B67 — native tool schemas for the SIMPLE path. The single coworker is
 * offered REAL function-calling tools (declared through the provider's native
 * tool API, executed through the gated ToolRuntime). SIMPLE intents are
 * memory/answer-focused, so the set is memory + profile + knowledge reads and
 * one write — all safe/write_local, so they run autonomously under the
 * default profile, and all inside the conversation/direct_answer allowlist.
 */
const SIMPLE_TOOL_DEFS = [
  { slug: 'memory-recall', name: 'Memory Recall', desc: 'Retrieve remembered facts, preferences and prior answers about the user or a topic.', schema: { query: { type: 'string', required: true, desc: 'What to recall' }, limit: { type: 'number', desc: 'Max matches' } } },
  { slug: 'memory-write', name: 'Memory Write', desc: 'Store a durable fact or preference the user explicitly wants remembered.', schema: { fact: { type: 'string', required: true, desc: 'Fact or preference to store' }, label: { type: 'string', desc: 'Optional label' } } },
  { slug: 'semantic-search', name: 'Semantic Search', desc: 'Hybrid vector + keyword search across all memories.', schema: { query: { type: 'string', required: true, desc: 'Semantic query' }, limit: { type: 'number', desc: 'Max matches' } } },
  { slug: 'profile-read', name: 'Profile Read', desc: 'Read the stored user profile: name, facts, preferences.', schema: {} },
  { slug: 'knowledge-search', name: 'Knowledge Search', desc: 'Search the saved knowledge library and studied topics.', schema: { query: { type: 'string', required: true, desc: 'Search query' } } },
];

/**
 * Run a SIMPLE task end-to-end. Returns the same shape as
 * Orchestrator.executePlan ({ success, summary, statistics, error }).
 */
export async function runSimpleTask(plan, query, sendEvent, opts = {}) {
  const startTime = Date.now();
  if (typeof sendEvent !== 'function') sendEvent = () => {};
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch (e) {} };

  const results = {
    success: true,
    query,
    intent: plan.intent,
    tasks: plan.tasks,
    steps: plan.steps,
    agentResults: {},
    summary: '',
    sources: [],
    statistics: { executionTime: 0, agentsUsed: 1, complexity: 'SIMPLE', confidence: 0 },
  };

  // Auditable classification decision.
  emit('orchestrator.classify', {
    complexity: 'SIMPLE',
    reason: plan.complexityReason || `intent "${plan.intent}" is single-shot`,
    intent: plan.intent,
  });
  emit('log', { agent: 'Orchestrator', message: `🧭 Complexity: SIMPLE — single coworker (${plan.intent}), no graph.` });

  try { addChat('user', query); } catch (e) {}
  const ctx = await conversationContext(query).catch(() => '');
  const role = coworkerFor(plan.intent);
  emit('agent.log', { message: `🧑‍💻 Coworker assigned: ${COWORKER_LABELS[role] || role} (${role}).` });

  const prompt = `The user asked: "${query}"\n\n${ctx ? `Conversation context:\n${ctx.slice(0, 4000)}\n\n` : ''}Answer directly and completely. ${FORMAT_RULES}`;
  const res = await runWorker(role, prompt, JEXI_SYSTEM_PROMPT + preferencesBlock(), {
    temperature: 0.4,
    // B67 — the coworker can really call these tools via native function
    // calling; intent is passed so ToolRuntime enforces the allowlist.
    tools: SIMPLE_TOOL_DEFS,
    intent: plan.intent,
    profile: opts.profile,
    sendEvent: emit,
    confirm: opts.confirm,
    signal: opts.signal,
    maxIterations: opts.maxIterations || 4,
  });
  results.statistics.executionTime = Date.now() - startTime;
  results.statistics.provider = res.provider || null;
  results.statistics.worker = res.worker || role;
  results.statistics.degraded = !!res.degraded;
  results.statistics.toolCalls = (res.toolCalls || []).length;
  results.statistics.iterations = res.iterations || 0;
  if (results.statistics.toolCalls > 0) {
    emit('log', { agent: 'Orchestrator', message: `🔧 Coworker used ${results.statistics.toolCalls} native tool call(s) (${results.statistics.iterations} round${results.statistics.iterations === 1 ? '' : 's'}).` });
  }

  if (res.ok && res.text) {
    const summary = normalizeFinalAnswer(res.text);
    results.summary = summary;
    try { addChat('assistant', summary); } catch (e) {}
    emit('agent.done', {
      answer: summary,
      stats: { complexity: 'SIMPLE', worker: results.statistics.worker, provider: results.statistics.provider, degraded: results.statistics.degraded, durationMs: results.statistics.executionTime },
    });
    return results;
  }

  // Truthful failure — never paper over it, never a bare error string.
  results.success = false;
  results.error = res.text || 'The coworker could not complete the task.';
  results.summary = normalizeFinalAnswer(res.text || results.error);
  emit('log', { agent: 'System', message: `⚠ Coworker ${role} could not complete the task — reported honestly.` });
  emit('agent.done', { answer: results.summary, stats: { complexity: 'SIMPLE', failed: true, durationMs: results.statistics.executionTime } });
  return results;
}
