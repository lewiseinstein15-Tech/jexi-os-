/**
 * ARENA ASTRA REBUILD — Memory Vault (spec Part 19).
 *
 * ONE persistent memory surface over the existing stores (DecisionMemory,
 * MemoryManager, ProjectMemory). Categories:
 *
 *   identity · preferences · projects · technical · missions · decisions ·
 *   experiences · solutions · failures · research · facts · workflows
 *
 * Every record: { id, category, content, source, at, confidence,
 *   scope, reason }. Lifecycle (via MemoryLifecycle): FRESH → AGING →
 * STALE → REVERIFY. The vault never stores every sentence — only useful
 * knowledge (callers decide; `remember()` enforces a quality floor).
 */

import { emit } from './Observer.js';

export const VAULT_CATEGORIES = [
  'identity', 'preferences', 'projects', 'technical', 'missions',
  'decisions', 'experiences', 'solutions', 'failures', 'research',
  'facts', 'workflows',
];

const MIN_CONTENT = 12;
const MAX_CONTENT = 4000;

/**
 * Remember useful knowledge. Returns the stored record or null when the
 * content is too thin to keep (honest no-op, never an error).
 */
export async function remember({ category = 'facts', content = '', source = 'chat', confidence = 0.7, scope = 'global', reason = '' } = {}) {
  const text = String(content || '').trim();
  if (!VAULT_CATEGORIES.includes(category)) category = 'facts';
  if (text.length < MIN_CONTENT) return null; // not worth keeping
  const record = {
    category,
    content: text.slice(0, MAX_CONTENT),
    source: String(source).slice(0, 120),
    at: new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.5)),
    scope: String(scope).slice(0, 120),
    reason: String(reason).slice(0, 300),
  };
  try {
    const { recordDecision } = await import('./DecisionMemory.js');
    // The decision store coerces `type` to a closed enum and drops unknown
    // fields — so the vault category rides in `taskId` (preserved verbatim)
    // and scope rides in `project`.
    const typeFor = { preferences: 'preference', decisions: 'decision', facts: 'fact' }[category] || 'fact';
    const stored = recordDecision({ type: typeFor, content: record.content, source: record.source, project: scope, taskId: `vault:${category}`, confidence: String(record.confidence) });
    emit('memory.stored', { actor: 'MemoryVault', summary: `${category} remembered`, data: { category, source } });
    return { id: stored?.id || null, ...record };
  } catch (e) {
    return { id: null, ...record, persisted: false, error: String(e?.message || e).slice(0, 120) };
  }
}

/** Recall vault records (lifecycle-annotated). Never throws. */
export async function recall({ query = '', category = '', limit = 10 } = {}) {
  const out = [];
  try {
    const { retrieveDecisions } = await import('./DecisionMemory.js');
    const all = retrieveDecisions({ query, limit: 200 }) || [];
    for (const d of all) {
      if (!String(d.taskId || '').startsWith('vault:')) continue;
      if (category && d.taskId !== `vault:${category}`) continue;
      out.push({ id: d.id, category: String(d.taskId).slice(6), content: d.content, at: d.at || d.createdAt, source: d.source, confidence: d.confidence, scope: d.project });
      if (out.length >= limit) break;
    }
  } catch {}
  try {
    const { annotateRecall } = await import('./MemoryLifecycle.js');
    if (typeof annotateRecall === 'function') annotateRecall(out);
  } catch {}
  return out;
}

/** Vault status: counts per category + lifecycle state (honest, live). */
export async function vaultStatus() {
  const byCategory = {};
  let total = 0;
  try {
    const { retrieveDecisions } = await import('./DecisionMemory.js');
    const all = retrieveDecisions({ limit: 5000 }) || [];
    for (const d of all) {
      if (!String(d.taskId || '').startsWith('vault:')) continue;
      const c = String(d.taskId).slice(6);
      byCategory[c] = (byCategory[c] || 0) + 1;
      total += 1;
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 140) };
  }
  let lifecycle = null;
  try {
    const { lifecycleScan } = await import('./MemoryLifecycle.js');
    if (typeof lifecycleScan === 'function') lifecycle = await lifecycleScan();
  } catch {}
  return { ok: true, total, byCategory, lifecycle };
}

export const MemoryVault = { remember, recall, vaultStatus, VAULT_CATEGORIES };
