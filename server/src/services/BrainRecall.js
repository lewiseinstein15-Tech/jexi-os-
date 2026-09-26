/**
 * JEXI OS — BRAIN RECALL BRIDGE (fix/chat-memory-provider-wiring Part C2,
 * extended by fix/chat-wiring-completion GAP 1: semantica + instincts feed).
 *
 * The Phase-31 wiring (server/src/wiring/phase31-bootstrap.js) builds JEXI's
 * real brain at boot — brain.hot (hot memory), brain.search.hybrid (hybrid
 * recall over the brain index), the semantica graph, instincts (mind/learning)
 * — and registers them as "context sources". AUDIT FINDING (A3): the chat
 * prompt pipeline never collected them. assemblePrompt() maintains its own
 * local section list, collectSources() had zero chat-path callers, and the
 * unique JEXI brain therefore never fed a single chat turn.
 *
 * This bridge is the missing WIRE, not a new brain: it lazily reaches the
 * SAME boot-built instances through the wiring facade and renders a bounded,
 * fail-soft prompt block from FOUR sources:
 *
 *   1. brain.hot.recall({ sourceId: 'chat' })  — hot conversation facts
 *   2. wiring.hybrid.hybrid(query)             — relevant brain pages (scored)
 *   3. wiring.graphQuery(...)                  — semantica ontology nodes
 *   4. mind/learning instinctsSection          — learned instinct patterns
 *
 * Budget (GAP 1): hot 400 → hybrid 500 → semantica 300 → instincts 300 chars,
 * 1500 total. Fail-soft: any source that errors or is empty is SKIPPED —
 * never crashes a turn, never blocks on the brain.
 */

const HOT_SOURCE_ID = 'chat';     // same sourceId the W31 B4 producer registers
const HOT_MAX_FACTS = 4;
let __hotOpSeq = 0; // GAP 2 — per-process monotonic op sequence for chat writes
const HYBRID_TOP_K = 3;
const HYBRID_BUDGET_TOKENS = 400;
const GRAPH_MAX_NODES = 4;
// GAP 1 — per-source prompt budgets (priority order hot → hybrid → semantica → instincts)
export const BRAIN_BUDGETS = { hot: 400, hybrid: 500, semantica: 300, instincts: 300 };
export const BRAIN_TOTAL_BUDGET = 1500;

// ui/decision-layer-rendering (Part 2) — hot-turn durability needs fs + the
// data dir. Static imports are safe here: config.js has no cycle with this
// module, and node:fs/node:path are builtins.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

function clip(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function clipBlock(lines, maxChars) {
  if (!lines.length) return '';
  const block = lines.join('\n');
  return block.length > maxChars ? block.slice(0, maxChars - 1) : block;
}

/** Hot-memory facts → prompt lines (fail-soft).
 *  GAP 2 — the read is SESSION-AGNOSTIC: every 'chat' fact is a candidate
 *  (latest first), tagged with its session id, so a brand-new session still
 *  recalls what earlier sessions taught her (cross-session persistence, the
 *  lead's GAP 2 acceptance test). */
async function hotLines(wiring, sessionId) {
  if (!wiring || !wiring.hot || typeof wiring.hot.recall !== 'function') return [];
  try {
    const facts = wiring.hot.recall({ sourceId: HOT_SOURCE_ID });
    return (facts || []).slice(-HOT_MAX_FACTS).map((f) =>
      `- [hot${f.session_id && f.session_id !== 'default' ? `:${f.session_id}` : ''}] ${clip(f.kind || 'fact', 24)}: ${clip(f.fact || f.text || f.title || '', 160)}`
    );
  } catch {
    // recall() validates its args strictly (E_INVALID_ARGUMENT on a bad
    // sourceId/since) — a strict-refusal must never break the turn.
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
 * GAP 1 — semantica ontology feed. The graph stores typed nodes
 * ({id, kind, label, props}); query({}) returns every node id-sorted.
 * Relevance = label tokens that intersect the query's tokens (the graph has
 * no text index — this is the honest keyword overlap it supports). Nodes
 * whose label shares no token with the question are skipped; nothing
 * relevant → nothing injected (never filler).
 */
async function semanticaLines(wiring, query) {
  if (!wiring || typeof wiring.graphQuery !== 'function') return [];
  const q = String(query || '').toLowerCase();
  if (q.length < 4) return [];
  try {
    const nodes = wiring.graphQuery({}) || [];
    if (!nodes.length) return [];
    const qTokens = new Set(q.match(/[a-z0-9_]+/g) || []);
    const relevant = nodes.filter((n) => {
      const toks = String(n.label || '').toLowerCase().match(/[a-z0-9_]+/g) || [];
      return toks.some((t) => t.length >= 3 && qTokens.has(t));
    });
    if (!relevant.length) return [];
    return relevant.slice(0, GRAPH_MAX_NODES).map((n) =>
      `- [graph] ${clip(n.kind || 'node', 24)}: ${clip(n.label, 90)}`
    );
  } catch { return []; }
}

/**
 * GAP 1 — instincts feed. mind/learning keeps learned patterns
 * (error resolutions, user corrections, workarounds…) in append-only JSONL
 * stores; instinctsSection() renders the "INSTINCTS:" block — project
 * instincts matched to the task, global instincts always. Dynamic import +
 * try/catch: an absent or broken learning/ yields an empty section.
 */
async function instinctLines(query) {
  try {
    const learning = await import('../../../mind/learning/index.js');
    const section = await learning.instinctsSection({ task: String(query || '') });
    return section ? [section] : [];
  } catch { return []; }
}

/**
 * GAP 2 — CHAT → BRAIN.HOT WRITE. After every successful turn (SIMPLE and
 * COMPLEX lanes converge on the chat handler's done()), the exchange is
 * recorded into hot memory as a kind:'event' fact under sourceId 'chat'.
 * opSeq is a per-process monotonic sequence (hot.record requires it); the
 * fact id is content+sequence addressed, so a retried identical write is a
 * no-op. Fail-soft: a failed write logs a warning and returns false — it
 * must never fail the turn.
 *
 * ui/decision-layer-rendering (Part 2) — two upgrades:
 *   1. STRUCTURED TURN: the record carries the full {user, assistant, ts,
 *      sessionId} payload alongside the composed fact, so consumers read the
 *      real turn shape instead of parsing "User: X — JEXI: Y".
 *   2. DURABILITY: every chat turn is appended to DATA_DIR/brain-hot-chat.jsonl
 *      (fail-soft, best-effort) and replayed into the in-memory hot store on
 *      first write after a restart. Before this, brain.hot was RAM-only and a
 *      server restart silently lost every recorded conversation turn.
 */
const HOT_PERSIST_LOCK = { replayed: false };

function hotPersistPath() {
  return path.join(DATA_DIR, 'brain-hot-chat.jsonl');
}

/** Replay persisted chat turns into the fresh in-memory hot store (idempotent:
 * content-addressed ids make every replayed record a no-op if already present). */
async function replayHotPersistence(wiring) {
  if (HOT_PERSIST_LOCK.replayed) return;
  HOT_PERSIST_LOCK.replayed = true;
  try {
    const file = hotPersistPath();
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    let maxSeq = __hotOpSeq;
    let restored = 0;
    for (const line of lines.slice(-500)) { // bounded replay — last 500 turns
      let row;
      try { row = JSON.parse(line); } catch { continue; } // skip torn tail lines
      if (!row || !row.fact || row.sourceId !== HOT_SOURCE_ID) continue;
      try {
        await wiring.hot.record({
          fact: row.fact,
          kind: 'event',
          sourceId: HOT_SOURCE_ID,
          sessionId: row.sessionId || 'default',
          opSeq: Number(row.opSeq) || 0,
          evidence: row.evidence || row.fact,
          ...(row.turn ? { turn: row.turn } : {}),
        });
        restored++;
        if (Number(row.opSeq) > maxSeq) maxSeq = Number(row.opSeq);
      } catch { /* skip a bad row — never break the bridge */ }
    }
    __hotOpSeq = maxSeq;
    if (restored) console.log(`[brain] hot persistence: replayed ${restored} chat turn(s) from brain-hot-chat.jsonl`);
  } catch (e) {
    try { console.warn(`[brain] hot replay failed (fail-soft): ${String((e && e.message) || e).slice(0, 120)}`); } catch { /* logging never throws */ }
  }
}

export async function brainHotWriteTurn({ sessionId = null, userMessage = '', assistantAnswer = '' } = {}) {
  try {
    const { wiring } = await import('../wiring/phase31-bootstrap.js');
    if (!wiring || !wiring.hot || typeof wiring.hot.record !== 'function') return false;
    const u = clip(userMessage, 200);
    const a = clip(assistantAnswer, 200);
    if (!u && !a) return false;
    await replayHotPersistence(wiring); // one-shot per process; no-op afterwards
    const ts = new Date().toISOString();
    const opSeq = ++__hotOpSeq;
    wiring.hot.record({
      fact: clip(`User: ${u} — JEXI: ${a}`, 400),
      kind: 'event',
      sourceId: HOT_SOURCE_ID,
      sessionId: sessionId || 'default',
      opSeq,
      evidence: u || a,
      turn: { user: u, assistant: a, ts, sessionId: sessionId || 'default' },
    });
    // DURABILITY — append the structured turn to the JSONL log (fail-soft:
    // a full disk or read-only fs must never fail the chat turn).
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(
        hotPersistPath(),
        JSON.stringify({ fact: clip(`User: ${u} — JEXI: ${a}`, 400), sourceId: HOT_SOURCE_ID, sessionId: sessionId || 'default', opSeq, ts, user: u, assistant: a, turn: { user: u, assistant: a, ts, sessionId: sessionId || 'default' } }) + '\n',
        'utf-8',
      );
    } catch (e) {
      try { console.warn(`[brain] hot persistence skipped (fail-soft): ${String((e && e.message) || e).slice(0, 120)}`); } catch { /* logging never throws */ }
    }
    return true;
  } catch (e) {
    try { console.warn(`[brain] hot write failed (fail-soft): ${String((e && e.message) || e).slice(0, 160)}`); } catch { /* logging never throws */ }
    return false;
  }
}

/**
 * GAP 3 — COORDINATOR PROMPT composition (pure, exported for tests).
 * The graph lane's coordinator (the FIRST specialist node to run for a
 * plan) receives the brain block prepended to its query; every later node
 * sees the original query untouched (wrapCase one-shot — see Orchestrator).
 */
export function withCoordinatorContext(query, brainContext) {
  const bc = String(brainContext || '').trim();
  if (!bc) return String(query || '');
  return `${String(query || '')}\n\n${bc}`;
}

/**
 * Build the bounded recall block. Returns '' when there is nothing to say.
 * @param {object} opts
 * @param {string|null} opts.sessionId  conversation id (hot-memory scope hint)
 * @param {string} opts.query           the user's message (retrieval input)
 * @param {number} [opts.maxChars=1500] hard cap on the injected block
 */
export async function brainRecallBlock({ sessionId = null, query = '', maxChars = BRAIN_TOTAL_BUDGET } = {}) {
  try {
    // Dynamic import: phase31-bootstrap imports PromptAssembly (which the
    // SIMPLE lane already imports) — a static edge here would create an ESM
    // cycle. Lazy resolution at call time is cycle-free and fail-soft.
    const { wiring } = await import('../wiring/phase31-bootstrap.js');
    const [hot, hybrid, semantica, instincts] = await Promise.all([
      hotLines(wiring, sessionId),
      hybridLines(wiring, query),
      semanticaLines(wiring, query),
      instinctLines(query),
    ]);
    const sections = [
      clipBlock(hot, BRAIN_BUDGETS.hot) && `Hot memory (latest facts):\n${clipBlock(hot, BRAIN_BUDGETS.hot)}`,
      clipBlock(hybrid, BRAIN_BUDGETS.hybrid) && `Relevant brain pages (hybrid retrieval):\n${clipBlock(hybrid, BRAIN_BUDGETS.hybrid)}`,
      clipBlock(semantica, BRAIN_BUDGETS.semantica) && `Ontology (semantica graph):\n${clipBlock(semantica, BRAIN_BUDGETS.semantica)}`,
      clipBlock(instincts, BRAIN_BUDGETS.instincts) && `${clipBlock(instincts, BRAIN_BUDGETS.instincts)}`,
    ].filter(Boolean);
    if (!sections.length) return '';
    const block = `Relevant JEXI brain memory (use silently — never mention that you recalled it):\n${sections.join('\n')}`;
    return block.length > maxChars ? block.slice(0, maxChars - 1) : block;
  } catch {
    return ''; // the brain must never break a chat turn
  }
}
