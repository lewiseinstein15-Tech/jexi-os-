/**
 * ARENA ASTRA REBUILD — Context Engine (spec Part 7).
 *
 * NEVER send the whole conversation + whole memory to every model call.
 * Each model request receives only relevant context:
 *
 *   current task · relevant mission · relevant memories · necessary tools ·
 *   relevant previous results · current instruction · constraints
 *
 * Techniques: task-scoped assembly, budget-capped sections, summarization
 * hooks, checkpoint references, relevant-memory retrieval, result references.
 *
 * Pure assembly + best-effort retrieval. No model calls inside.
 */

const DEFAULT_BUDGET = {
  maxChars: 12000,
  instruction: 2000,
  task: 2500,
  mission: 1500,
  memories: 2500,
  results: 2000,
  tools: 1200,
  constraints: 500,
};

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
function chars(messages) {
  return messages.reduce((n, m) => n + String(m?.content || '').length, 0);
}

/**
 * Assemble the message list for ONE model call.
 *
 * @param {{ instruction: string, task?: object, mission?: object,
 *   memories?: Array, previousResults?: Array, tools?: Array,
 *   constraints?: Array<string>, system?: string, history?: Array }} input
 * @param {{ budget?: object }} opts
 * @returns {{ messages, usage: { chars, sections }, trimmed: string[] }}
 */
export function assemble(input = {}, opts = {}) {
  const budget = { ...DEFAULT_BUDGET, ...(opts.budget || {}) };
  const trimmed = [];
  const sections = [];

  const push = (name, content, cap) => {
    const text = String(content || '').trim();
    if (!text) return;
    const limit = budget[name] ?? cap ?? 1500;
    if (text.length > limit) trimmed.push(name);
    sections.push({ name, content: clip(text, limit) });
  };

  if (input.system) push('system', input.system, 1500);
  if (input.constraints?.length) push('constraints', `Constraints:\n- ${input.constraints.map((c) => clip(c, 200)).join('\n- ')}`, budget.constraints);
  if (input.mission) {
    const m = input.mission;
    push('mission', `Mission: ${clip(m.title || m.id || '', 200)}\nGoal: ${clip(m.goal || m.objective || '', 600)}\nProgress: ${clip(m.progress || '', 300)}`, budget.mission);
  }
  if (input.task) {
    const t = input.task;
    push('task', `Current task: ${clip(t.title || t.id || '', 200)}\nBrief: ${clip(t.brief || t.description || '', 1200)}\nStatus: ${clip(t.status || '', 100)}`, budget.task);
  }
  if (input.memories?.length) {
    const lines = input.memories.slice(0, 12).map((m) => `- ${clip(typeof m === 'string' ? m : (m.content || m.text || JSON.stringify(m)), 220)}`);
    push('memories', `Relevant memory:\n${lines.join('\n')}`, budget.memories);
  }
  if (input.previousResults?.length) {
    const lines = input.previousResults.slice(-6).map((r) => `- ${clip(typeof r === 'string' ? r : (r.summary || r.content || JSON.stringify(r)), 320)}`);
    push('results', `Previous results (referenced, not pasted in full):\n${lines.join('\n')}`, budget.results);
  }
  if (input.tools?.length) {
    const lines = input.tools.slice(0, 20).map((t) => `- ${clip(typeof t === 'string' ? t : `${t.name || t.id}: ${t.description || ''}`, 120)}`);
    push('tools', `Available tools (minimum set):\n${lines.join('\n')}`, budget.tools);
  }
  // Short rolling history: last few turns only, heavily clipped.
  if (input.history?.length) {
    const turns = input.history.slice(-4).map((h) => `${h.role === 'user' ? 'Lewis' : 'JEXI'}: ${clip(h.content || h.text || '', 400)}`);
    push('history', `Recent conversation:\n${turns.join('\n')}`, 1600);
  }
  push('instruction', input.instruction || '', budget.instruction);

  const messages = [];
  const sys = sections.filter((s) => s.name === 'system');
  const rest = sections.filter((s) => s.name !== 'system');
  if (sys.length) messages.push({ role: 'system', content: sys.map((s) => s.content).join('\n\n') });
  // Everything except the live instruction rides as one context user message;
  // the instruction itself is the final user message (recency = attention).
  const ctxParts = rest.filter((s) => s.name !== 'instruction');
  if (ctxParts.length) messages.push({ role: 'user', content: ctxParts.map((s) => s.content).join('\n\n') });
  const instr = rest.find((s) => s.name === 'instruction');
  messages.push({ role: 'user', content: instr ? instr.content : '(no instruction)' });

  // Hard budget: drop oldest context sections first (never the instruction).
  let total = chars(messages);
  while (total > budget.maxChars && messages.length > 1) {
    const dropped = messages[0].role === 'system' && messages.length > 2 ? messages.splice(1, 1) : messages.splice(0, 1);
    if (dropped.length) trimmed.push(`dropped:${dropped[0].content.slice(0, 40)}`);
    total = chars(messages);
  }

  return { messages, usage: { chars: total, sections: sections.map((s) => s.name) }, trimmed };
}

/**
 * Retrieve relevant memories for a task (best-effort over existing stores).
 * Never throws; returns [] when stores are unavailable.
 */
export async function retrieveRelevant({ query = '', missionId = null, limit = 8 } = {}) {
  const out = [];
  try {
    const { retrieveDecisions } = await import('./DecisionMemory.js').catch(() => ({}));
    if (typeof retrieveDecisions === 'function') {
      const found = retrieveDecisions({ query, limit }) || [];
      for (const d of found) out.push({ content: d.content, type: d.type, at: d.at || d.createdAt, source: 'decisions' });
    }
  } catch {}
  try {
    const mm = await import('./MemoryManager.js').catch(() => null);
    if (mm && typeof mm.semanticRecall === 'function' && query) {
      const found = await mm.semanticRecall(query, { limit: Math.max(2, limit - out.length) }).catch(() => []);
      for (const m of Array.isArray(found) ? found : []) out.push({ content: m.content || m.text, source: 'semantic' });
    }
  } catch {}
  void missionId;
  return out.slice(0, limit);
}

/**
 * Checkpoint a long mission: compress prior results into a short reference
 * block (deterministic extractive summary — no model call).
 */
export function checkpoint(results = [], { maxChars = 1500 } = {}) {
  const lines = [];
  for (const r of results.slice(-20)) {
    const s = typeof r === 'string' ? r : (r.summary || r.content || r.title || '');
    const first = String(s).split('\n')[0].trim();
    if (first) lines.push(`- ${clip(first, 160)}`);
  }
  return clip(`Checkpoint (${results.length} results, showing last ${lines.length}):\n${lines.join('\n')}`, maxChars);
}

export const ContextEngine = { assemble, retrieveRelevant, checkpoint, DEFAULT_BUDGET };
