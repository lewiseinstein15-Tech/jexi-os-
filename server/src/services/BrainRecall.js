/**
 * JEXI OS — BRAIN RECALL BRIDGE (fix/chat-memory-provider-wiring, Part C2).
 *
 * The Phase-31 wiring (server/src/wiring/phase31-bootstrap.js) builds JEXI's
 * real brain at boot — brain.hot (hot memory), brain.search.hybrid (hybrid
 * recall over the brain index), semantica graph, instincts observer — and
 * registers them as "context sources". AUDIT FINDING (A3): the chat prompt
 * pipeline never collected them. assemblePrompt() maintains its own local
 * section list, collectSources() had zero chat-path callers, and the unique
 * JEXI brain therefore never fed a single chat turn — JEXI behaved like a
 * generic LLM proxy.
 *
 * This bridge is the missing WIRE, not a new brain: it lazily reaches the
 * SAME boot-built instances through the wiring facade (wiring.hot /
 * wiring.hybrid — server/src/wiring/phase31-bootstrap.js:654-665) and renders
 * a bounded, fail-soft prompt block:
 *
 *   - brain.hot.recall({ sourceId: 'chat', sessionId }) — today's hot facts
 *     for this session (real fact text + evidence).
 *   - wiring.hybrid.hybrid(query, { topK, budgetTokens }) — the most relevant
 *     compiled brain pages/facts for this query, as scored page pointers.
 *
 * Contract: NEVER throws, NEVER blocks a turn, NEVER exceeds maxChars, and
 * returns '' (inject nothing) whenever the brain is unavailable, empty, or
 * the query is too short to recall on. No model calls, no network, no clock
 * assumptions beyond what the brain itself maintains.
 */

const HOT_SOURCE_ID = 'chat';     // same sourceId the W31 B4 producer registers
const HOT_MAX_FACTS = 4;
const HYBRID_TOP_K = 3;
const HYBRID_BUDGET_TOKENS = 400;

function clip(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Hot-memory facts for this session → prompt lines (fail-soft). */
async function hotLines(wiring, sessionId) {
  if (!wiring || !wiring.hot || typeof wiring.hot.recall !== 'function') return [];
  try {
    const facts = wiring.hot.recall({ sourceId: HOT_SOURCE_ID, ...(sessionId ? { sessionId } : {}) });
    return (facts || []).slice(0, HOT_MAX_FACTS).map((f) =>
      `- [hot] ${clip(f.kind || 'fact', 24)}: ${clip(f.fact || f.text || f.title || '', 160)}`
    );
  } catch {
    // recall() validates its args strictly (E_INVALID_ARGUMENT on an empty
    // sourceId, bad `since`…) — a strict-refusal must never break the turn.
    try {
      const meta = wiring.hot.meta({ ...(sessionId ? { sessionId } : {}), sourceId: HOT_SOURCE_ID });
      const facts = meta && meta.brain_hot_memory && meta.brain_hot_memory.facts;
      return (facts || []).slice(0, HOT_MAX_FACTS).map((f) => `- [hot] ${clip(f.kind || 'fact', 24)}: ${clip(f.text || f.title || '', 160)}`);
    } catch { return []; }
  }
}

/** Hybrid brain retrieval for this query → scored pointer lines (fail-soft). */
async function hybridLines(wiring, query) {
  if (!wiring || !wiring.hybrid || typeof wiring.hybrid.hybrid !== 'function') return [];
  const q = String(query || '').trim();
  if (q.length < 4) return []; // greetings/"ok" — nothing worth recalling on
  try {
    const { results } = await wiring.hybrid.hybrid(q, { topK: HYBRID_TOP_K, budgetTokens: HYBRID_BUDGET_TOKENS });
    return (results || []).map((r) =>
      `- [brain] ${clip(r.pageId, 80)}${r.chunkId ? ` · ${clip(r.chunkId, 40)}` : ''} (score ${Number(r.score || 0).toFixed(3)})`
    );
  } catch { return []; }
}

/**
 * Build the bounded recall block. Returns '' when there is nothing to say.
 * @param {object} opts
 * @param {string|null} opts.sessionId  conversation id (hot-memory scope)
 * @param {string} opts.query           the user's message (hybrid retrieval)
 * @param {number} [opts.maxChars=900]  hard cap on the injected block
 */
export async function brainRecallBlock({ sessionId = null, query = '', maxChars = 900 } = {}) {
  try {
    // Dynamic import: phase31-bootstrap imports PromptAssembly (which the
    // SIMPLE lane already imports) — a static edge here would create an ESM
    // cycle. Lazy resolution at call time is cycle-free and fail-soft: if the
    // wiring module or the boot sequence is unavailable, we inject nothing.
    const { wiring } = await import('../wiring/phase31-bootstrap.js');
    const [hot, hybrid] = await Promise.all([hotLines(wiring, sessionId), hybridLines(wiring, query)]);
    const lines = [...hot, ...hybrid];
    if (!lines.length) return '';
    const block = `Relevant JEXI brain memory (use silently — never mention that you recalled it):\n${lines.join('\n')}`;
    return block.length > maxChars ? block.slice(0, maxChars - 1) : block;
  } catch {
    return ''; // the brain must never break a chat turn
  }
}
