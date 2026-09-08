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
 *
 * M4 — the engine is also the budget/token/repo-map UTILITY layer behind
 * the live compiler (PromptAssembly): compileSections() enforces total
 * budgets over ordered prompt sections, and buildRepoMap() renders a
 * bounded workspace tree so coding runs see their own repo.
 */

import fs from 'fs';
import path from 'path';
import { estimateTokens, estimateMessagesTokens } from './TokenMeter.js';

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
  // M4 — enforced in BOTH chars and estimated tokens.
  const over = () => {
    if (chars(messages) > budget.maxChars) return true;
    if (budget.maxTokens && estimateMessagesTokens(messages) > budget.maxTokens) return true;
    return false;
  };
  while (over() && messages.length > 1) {
    const dropped = messages[0].role === 'system' && messages.length > 2 ? messages.splice(1, 1) : messages.splice(0, 1);
    if (dropped.length) trimmed.push(`dropped:${dropped[0].content.slice(0, 40)}`);
  }
  const total = chars(messages);

  return { messages, usage: { chars: total, tokens: estimateMessagesTokens(messages), sections: sections.map((s) => s.name) }, trimmed };
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

const REPO_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo',
  '__pycache__', '.venv', 'venv', 'target', 'out', '.cache', '.parcel-cache',
]);
const REPO_PEEK_FILES = ['package.json', 'README.md', 'README', 'pyproject.toml', 'go.mod', 'Cargo.toml'];

/**
 * M4 — build a BOUNDED repo map for a workspace root: an indented file
 * tree plus short peeks at key manifest files. Pure + offline + safe on
 * missing/unreadable roots (returns '' — never throws).
 *
 * opts: maxDepth (4), maxFiles (120), maxChars (4000), peekChars (600).
 */
export function buildRepoMap(root, opts = {}) {
  try {
    const dir = String(root || '');
    if (!dir || !fs.existsSync(dir)) return '';
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return '';
    const maxDepth = opts.maxDepth ?? 4;
    const maxFiles = opts.maxFiles ?? 120;
    const maxChars = opts.maxChars ?? 4000;
    const peekChars = opts.peekChars ?? 600;
    const lines = [];
    let files = 0;
    let truncated = false;
    const walk = (d, depth, prefix) => {
      if (truncated || depth > maxDepth) return;
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.') || e.name === '.env.example')
          .filter((e) => !REPO_SKIP.has(e.name))
          .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));
        // Keep dotfiles out except the explicit allowlist above.
        entries = entries.filter((e) => !e.name.startsWith('.') || e.name === '.env.example');
      } catch { return; }
      for (const e of entries) {
        if (truncated) return;
        if (++files > maxFiles) { truncated = true; return; }
        lines.push(`${prefix}${e.isDirectory() ? e.name + '/' : e.name}`);
        if (e.isDirectory()) walk(path.join(d, e.name), depth + 1, `${prefix}  `);
      }
    };
    walk(dir, 0, '');
    if (!lines.length) return '';
    let out = `Repo map (${path.basename(dir)}/):\n${lines.join('\n')}`;
    if (truncated) out += `\n… (truncated at ${maxFiles} entries)`;
    for (const key of REPO_PEEK_FILES) {
      try {
        const p = path.join(dir, key);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          const peek = fs.readFileSync(p, 'utf-8').slice(0, peekChars).trim();
          if (peek) out += `\n\n--- ${key} (first ${peekChars} chars) ---\n${peek}`;
          break;
        }
      } catch { /* peek is best-effort */ }
    }
    return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
  } catch {
    return '';
  }
}

// M4 — tiny mtime-keyed repo-map cache (prompt assembly runs every turn).
const REPO_CACHE = new Map();
export function getCachedRepoMap(root, opts = {}) {
  try {
    const dir = String(root || '');
    if (!dir || !fs.existsSync(dir)) return '';
    const mtime = fs.statSync(dir).mtimeMs;
    const key = `${dir}::${opts.maxDepth ?? ''}:${opts.maxFiles ?? ''}:${opts.maxChars ?? ''}`;
    const hit = REPO_CACHE.get(key);
    if (hit && hit.mtime === mtime) return hit.map;
    const map = buildRepoMap(dir, opts);
    REPO_CACHE.set(key, { mtime, map });
    if (REPO_CACHE.size > 8) REPO_CACHE.delete(REPO_CACHE.keys().next().value);
    return map;
  } catch {
    return '';
  }
}

/**
 * M4 — enforce a total budget over ORDERED named sections
 * ([{ name, content, keep?: bool }], highest priority FIRST).
 * Clips each section to its per-section cap, then drops lowest-priority
 * sections until maxChars AND maxTokens hold. `keep` sections are never
 * dropped (clipped at most). Returns { text, trimmed, chars, tokens, kept }.
 */
export function compileSections(named = [], budget = {}) {
  const maxChars = budget.maxChars ?? 24000;
  const maxTokens = budget.maxTokens ?? 8000;
  // Per-section clip fires only when ONE section exceeds the whole budget
  // (pathological); ordinary budgeting works by dropping low-priority
  // sections first. Never wider than the total budget itself.
  const perSection = Math.min(budget.perSection ?? maxChars, maxChars);
  const trimmed = [];
  let sections = (named || [])
    .map((s) => ({ name: s.name, content: String(s.content || '').trim(), keep: !!s.keep }))
    .filter((s) => s.content)
    .map((s) => {
      if (s.content.length > perSection) {
        trimmed.push(`clipped:${s.name}`);
        return { ...s, content: `${s.content.slice(0, perSection)}…` };
      }
      return s;
    });
  const over = (list) => {
    const text = list.map((s) => s.content).join('\n');
    if (text.length > maxChars) return true;
    if (maxTokens && estimateTokens(text) > maxTokens) return true;
    return false;
  };
  while (sections.length > 1 && over(sections)) {
    let idx = -1;
    for (let i = sections.length - 1; i >= 0; i--) {
      if (!sections[i].keep) { idx = i; break; }
    }
    if (idx < 0) break;
    trimmed.push(`dropped:${sections[idx].name}`);
    sections.splice(idx, 1);
  }
  const text = sections.map((s) => s.content).join('\n');
  return { text, trimmed, chars: text.length, tokens: estimateTokens(text), kept: sections.map((s) => s.name) };
}

export const ContextEngine = { assemble, retrieveRelevant, checkpoint, buildRepoMap, getCachedRepoMap, compileSections, DEFAULT_BUDGET };
