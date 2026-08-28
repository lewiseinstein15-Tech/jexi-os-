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
import { assemblePrompt } from './PromptAssembly.js'; // B119 — dsh prompt assembly
import { preferencesBlock } from './PreferenceLearner.js';
import { runWorker, coworkerFor, coworkerChain } from './WorkerRouter.js';
import { coworkerName, coworkerLeadName } from './ModelCoworkers.js'; // B162 — named model coworkers
import { listPluginTools } from './PluginContext.js'; // B105 — plugin tools visible to SIMPLE-path coworkers
import { normalizeFinalAnswer, FORMAT_RULES } from './Formatting.js';
import { loadCoworker, orchestratorPromptFragment } from './CoworkerFiles.js'; // B78 — filesystem-native coworker mandates
import { appendEvent } from './EventLog.js'; // B78 — orchestrator decisions are first-class events

const COWORKER_LABELS = {
  coder: 'Coding & GitHub',
  memory: 'Memory & continuity',
  researcher: 'Research & realtime info',
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
  const ctx = await conversationContext(query, opts.convId).catch(() => '');
  const role = coworkerFor(plan.intent);

  // B78 — filesystem-native coworker definitions: the mandate for the
  // assigned coworker is loaded from jexi-agents/coworkers/<role>.md AT the
  // routing point (not baked into a composite prompt). Editing one file
  // changes only that coworker. The orchestrator rules (ORCHESTRATOR.md) are
  // appended to every run.
  const coworkerFile = loadCoworker(role);
  const coworkerMandate = coworkerFile ? `\n\nCOWORKER MANDATE (${coworkerFile.file}):\n${coworkerFile.body.slice(0, 4000)}` : '';
  // B162 — named coworkers: only the PEOPLE name is shown (no model IDs).
  const leadName = coworkerLeadName(role, coworkerChain(role));
  emit('agent.log', { message: `🧑‍💻 ${leadName} joined the task — ${COWORKER_LABELS[role] || role}${coworkerFile ? ` · mandate loaded` : ''}.` });
  try {
    appendEvent('orchestrator_decision', {
      complexity: 'SIMPLE',
      complexityReason: plan.complexityReason || `intent "${plan.intent}" is single-shot`,
      intent: plan.intent,
      classification: 'continue/new',
      coworkers: [role],
      coworkerFiles: coworkerFile ? [coworkerFile.file] : [],
      reasoning: plan.reasoning || '',
      via: 'runSimpleTask',
    });
  } catch (e) {}

  const prompt = `The user asked: "${query}"\n\n${ctx ? `Conversation context:\n${ctx.slice(0, 4000)}\n\n` : ''}Answer directly and completely. ${FORMAT_RULES}`;

  // B157 — LIVE STREAMING + ANSWER PRESERVATION. Every token the coworker
  // emits streams straight to the UI (the answer types itself live, like a
  // real AI system), AND the full streamed text is accumulated here. If the
  // worker's final text ever comes back empty (a provider quirk), the
  // streamed content IS the answer — it must never be discarded in favor of
  // a "no readable summary" notice.
  let streamedAnswer = '';
  let announcedWriter = false;
  const onToken = (t, meta) => {
    const delta = String(t || '');
    if (!delta) return;
    streamedAnswer += delta;
    // B162 — the delta carries the named coworker writing it; once, a visible
    // "✍️ <name> is writing…" step enters the live feed.
    const by = meta ? coworkerName(meta.provider, meta.model) : undefined;
    if (!announcedWriter) {
      announcedWriter = true;
      emit('log', { agent: by || leadName, message: '✍️ is writing your answer…' });
    }
    emit('stream', { text: delta, ...(by ? { by } : {}) });
  };
  // B105 — plugin tools join the SIMPLE-path tool set (weather-now etc.);
  // normalizeTools in LLMClient turns def-shaped lists into provider schemas.
  const coworkerTools = (() => {
    try {
      const plugins = listPluginTools().filter((p) => p && p.slug && !SIMPLE_TOOL_DEFS.some((d) => d.slug === p.slug));
      const extra = SIMPLE_TOOL_DEFS.some((d) => d.slug === 'ask_user_question') ? [] : [{
        slug: 'ask_user_question', name: 'Ask User',
        desc: 'Ask the user a question when you need confirmation or missing information.',
        schema: { questions: { type: 'array', required: true, desc: '[{id, question, header?, options?: [{label, description?}], multi_select?}]' } },
      }];
      return plugins.length ? [...SIMPLE_TOOL_DEFS, ...plugins, ...extra] : [...SIMPLE_TOOL_DEFS, ...extra];
    } catch { return SIMPLE_TOOL_DEFS; }
  })();
  const system = await assemblePrompt({
    convId: opts.convId || null,
    codeMode: opts.codeMode,
    codeTools: coworkerTools,
    presetFlavor: opts.presetFlavor || '',
    includeSessionRefs: false, // conversationContext below already injects them
    includeState: false,       // the coworker focuses on its mandate
    userText: prompt, // B160 — @file mentions → file references
  }) + orchestratorPromptFragment() + coworkerMandate;
  const res = await runWorker(role, prompt, system, {
    temperature: 0.4,
    // B67 — the coworker can really call these tools via native function
    // calling; intent is passed so ToolRuntime enforces the allowlist.
    tools: coworkerTools,
    intent: plan.intent,
    profile: opts.profile,
    sendEvent: emit,
    onToken,
    confirm: opts.confirm,
    signal: opts.signal,
    maxIterations: opts.maxIterations || 4,
    // B99 — code mode (PTC): the coworker may write ONE TypeScript program
    // composing SIMPLE_TOOL_DEFS via run_code (dsh `code` preset).
    codeMode: opts.codeMode,
    // B100 — oversized results spill under this conversation's namespace.
    spillOwner: opts.convId,
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

  // Success = the worker finished AND produced content — the live-streamed
  // text counts (fixes "✅ Task completed — no readable summary": the answer
  // had streamed to the UI and was then thrown away at the done event).
  if (res.ok && ((res.text && res.text.trim()) || streamedAnswer.trim())) {
    const summary = normalizeFinalAnswer(res.text || streamedAnswer);
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
  results.error = (res.text && res.text.trim()) || streamedAnswer.trim() || 'The coworker could not complete the task.';
  results.summary = normalizeFinalAnswer(results.error);
  emit('log', { agent: 'System', message: `⚠ Coworker ${role} could not complete the task — reported honestly.` });
  emit('agent.done', { answer: results.summary, stats: { complexity: 'SIMPLE', failed: true, durationMs: results.statistics.executionTime } });
  return results;
}
