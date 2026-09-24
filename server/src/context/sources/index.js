/**
 * JEXI OS — Phase 6 Scope C: context manager — sources.
 *
 * A context source is an async producer of one named section. Sources are
 * registered with a priority and a default weight; the builder pulls them
 * (fail-soft — a throwing source yields a skipped note, never a crash), then
 * the allocator budgets the result.
 *
 * Built-in sources cover the real stores already present in the system:
 * mission state, relevant memory, conversation tail, and the instruction.
 */

const sources = new Map();

/**
 * @param {string} name
 * @param {{ produce: (input, ctx) => any|Promise<any>, priority?: number, weight?: number, keep?: boolean, order?: number }} spec
 */
export function registerSource(name, spec = {}) {
  if (typeof spec.produce !== 'function') throw new Error(`context source "${name}" needs a produce function`);
  sources.set(name, {
    name,
    produce: spec.produce,
    priority: Number.isFinite(spec.priority) ? spec.priority : 0,
    weight: Number.isFinite(spec.weight) ? spec.weight : 1,
    keep: !!spec.keep,
    order: Number.isFinite(spec.order) ? spec.order : sources.size,
  });
  return () => sources.delete(name);
}

export function unregisterSource(name) { return sources.delete(name); }
export function listSources() { return [...sources.values()].map((s) => ({ name: s.name, priority: s.priority, weight: s.weight, keep: s.keep })); }
export function getSource(name) { return sources.get(name) || null; }

/** Pull every registered source (or just `only`), fail-soft and parallel. */
export async function collectSources(input = {}, ctx = {}, { only = null } = {}) {
  const chosen = [...sources.values()]
    .filter((s) => (only ? only.includes(s.name) : true))
    .sort((a, b) => a.order - b.order);

  const results = await Promise.all(chosen.map(async (s) => {
    try {
      const content = await s.produce(input, ctx);
      if (content == null) return { name: s.name, content: '', spec: s, skipped: 'empty' };
      return { name: s.name, content: String(content), spec: s };
    } catch (e) {
      return { name: s.name, content: '', spec: s, skipped: (e && e.message) || String(e) };
    }
  }));
  return results;
}

// ── built-in sources ───────────────────────────────────────────────────

registerSource('mission', {
  priority: 30, weight: 2, order: 0,
  produce: (input) => {
    const m = input.mission;
    if (!m) return '';
    const bits = [`Mission: ${m.title || m.id || ''}`];
    if (m.goal || m.objective) bits.push(`Goal: ${m.goal || m.objective}`);
    if (m.progress) bits.push(`Progress: ${m.progress}`);
    if (m.status) bits.push(`Status: ${m.status}`);
    return bits.join('\n');
  },
});

registerSource('memories', {
  priority: 20, weight: 2, order: 1,
  produce: (input) => {
    const raw = input.memories || [];
    if (!raw.length) return '';
    return `Relevant memory:\n${raw.slice(0, 12).map((m) => `- ${typeof m === 'string' ? m : (m.content || m.text || '')}`).join('\n')}`;
  },
});

registerSource('history', {
  priority: 15, weight: 3, order: 2,
  produce: (input) => {
    const hist = input.history || [];
    if (!hist.length) return '';
    const turns = [...hist].reverse().slice(0, 6).reverse()
      .map((h) => `${h.role === 'assistant' ? 'JEXI' : 'Lewis'}: ${h.content || h.text || ''}`);
    return `Recent conversation:\n${turns.join('\n')}`;
  },
});

registerSource('tools', {
  priority: 25, weight: 2, order: 3,
  produce: (input) => {
    const tools = input.tools || [];
    if (!tools.length) return '';
    return `Available tools:\n${tools.slice(0, 24).map((t) => `- ${typeof t === 'string' ? t : `${t.name || t.id}: ${t.description || ''}`}`).join('\n')}`;
  },
});

// Phase 7(C): INSTINCTS recall — continuous learning feeds the prompt. The
// learning subsystem lives at the repo root (learning/, like hooks/) and is
// imported DYNAMICALLY and fail-soft: absent or broken learning/ yields an
// empty section, never a crash. Scoped: project instincts load when they
// match the current task; global instincts are always available.
registerSource('instincts', {
  priority: 22, weight: 2, order: 4,
  produce: async (input) => {
    try {
      const learning = await import('../../../../mind/learning/index.js');
      return await learning.instinctsSection(input);
    } catch {
      return '';
    }
  },
});

registerSource('instruction', {
  priority: 100, weight: 4, keep: true, order: 9,
  produce: (input) => input.instruction || '',
});