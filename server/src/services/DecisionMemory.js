/**
 * JEXI OS — Build 47: Decision Memory.
 *
 * Provenanced memory for decisions + verified facts. Distinct from the
 * existing MemoryManager (which stores facts/preferences/episodes): this store
 * exists so JEXI never INVENT a memory — every entry carries source,
 * confidence, project and timestamp, and conflicting facts are superseded
 * (history kept), never silently overwritten or kept as equal truths.
 *
 * Persisted to DATA_DIR/decision-memory.json.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'decision-memory.json');
const MAX = 400;

let store = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* fresh */ }
  return [];
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) { console.error('[DecisionMemory] persist error:', e.message); }
}

let seq = store.reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);

/** Record a decision/fact with provenance. */
export function recordDecision({ type = 'decision', content, source = 'system', project = '', taskId = '', confidence = 'observed', supersedes = null }) {
  seq += 1;
  const entry = {
    seq,
    id: `dm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    type: ['decision', 'fact', 'requirement', 'correction', 'preference'].includes(type) ? type : 'decision',
    content: String(content || '').slice(0, 800),
    source: String(source || 'system').slice(0, 60),
    project: String(project || '').slice(0, 120),
    taskId: String(taskId || ''),
    confidence: String(confidence || 'observed').slice(0, 20),
    supersedes,
    supersededBy: null,
    createdAt: Date.now(),
  };
  if (supersedes) {
    const old = store.find((e) => e.id === supersedes);
    if (old && !old.supersededBy) old.supersededBy = entry.id;
  }
  store.unshift(entry);
  if (store.length > MAX) store = store.slice(0, MAX);
  persist();
  return entry;
}

/** Words that never identify a subject. */
const STOP_SUBJECTS = new Set([
  'the', 'a', 'an', 'this', 'that', 'it', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'from', 'by', 'as', 'at',
  'was', 'is', 'are', 'were', 'been', 'be', 'does', 'did', 'do', 'has', 'have', 'had', 'uses', 'use', 'using', 'used',
  'now', 'then', 'migrated', 'migrate', 'migration', 'running', 'runs', 'run', 'switched', 'switch', 'replaced', 'replaced',
  'changed', 'change', 'still', 'will', 'would', 'should', 'can', 'could', 'works', 'working', 'built', 'build',
]);

/** Extract the leading subject noun of a memory: "Backend uses Express." → "backend". */
function subjectWord(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ._\-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_SUBJECTS.has(w));
  return words[0] || '';
}

/** Find a live (not superseded) memory that the new content likely contradicts. */
export function findConflict(content, opts = {}) {
  const c = String(content || '').toLowerCase();
  if (!c) return null;
  // The new statement must negate/change something ("migrated to", "no longer",
  // "is now", "use X instead") — a plain statement is never a conflict.
  const negations = /(not|don't|no longer|never|instead|changed to|now use|switch to|removed|use .* instead|is now|migrat(?:e|ed)? to|now runs|replaced|switched|dropped)/i;
  if (!negations.test(c)) return null;
  const newSubject = subjectWord(c);
  if (!newSubject) return null;
  // The OLD memory is the conflict if it talks about the SAME subject
  // ("Backend was migrated to FastAPI" conflicts with "Backend uses Express" —
  // both are about "backend", regardless of the new value).
  const candidates = store
    .filter((e) => !e.supersededBy)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const e of candidates) {
    const oldSubject = subjectWord(e.content || '');
    if (oldSubject && oldSubject === newSubject) return e;
  }
  return null;
}

/** Retrieve live memories, newest first, with optional keyword/type filters. */
export function retrieveDecisions({ query = '', type = '', project = '', limit = 8 } = {}) {
  let out = store.filter((e) => !e.supersededBy);
  if (type) out = out.filter((e) => e.type === type);
  if (project) out = out.filter((e) => e.project === project);
  if (query) {
    const q = String(query).toLowerCase();
    const terms = q.split(/\s+/).filter((t) => t.length > 2);
    out = out
      .map((e) => {
        const hay = `${e.content} ${e.project} ${e.taskId}`.toLowerCase();
        const hits = terms.filter((t) => hay.includes(t)).length;
        return { e, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.e.createdAt - a.e.createdAt)
      .map((x) => x.e);
  }
  return out.slice(0, limit).map((e) => ({ ...e }));
}

export function memoryStats() {
  const live = store.filter((e) => !e.supersededBy).length;
  return { total: store.length, live, superseded: store.length - live, types: countByType() };
}

function countByType() {
  const by = {};
  for (const e of store) by[e.type] = (by[e.type] || 0) + 1;
  return by;
}

export function clearDecisionMemory() {
  store = [];
  persist();
  return { cleared: true };
}
