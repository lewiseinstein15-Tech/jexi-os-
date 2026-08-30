/**
 * B180 — AGENT PROFILES (Hermes Agent pattern, ported).
 * Every JEXI agent = a profile directory: config.yaml (model, allowed tools,
 * budgets, platforms) + SOUL.md (identity) + an isolated persistent memory
 * store (memory.jsonl, full-text searchable) + a skill store (portable
 * agentskills.io markdown). Hermes maps 1:1 here:
 *   hermes profiles (config.yaml + SOUL.md + memory_store.db)
 *     → server/agents/profiles/<name>/
 *
 * Prompt tiers (hermes stable → context → volatile): SOUL/config are the
 * STABLE tier (cached, byte-identical between runs); skills + memory hits
 * are the CONTEXT tier; task briefs are VOLATILE. assembleAgentPrompt()
 * builds exactly that ordering so provider KV caches stay prefix-stable.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const PROFILES_DIR = path.join(process.cwd(), 'agents', 'profiles');
const STATE_DIR = path.join(DATA_DIR, 'agent-profiles');

/* ── tiny YAML-subset parser (key: value, nested one level, - lists) ── */
export function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const node = stack[stack.length - 1].node;
    const content = line.trim();
    const listItem = content.match(/^-(?:\s+(.*))?$/);
    if (listItem) {
      if (Array.isArray(node)) node.push(listItem[1] !== undefined ? coerce(listItem[1]) : true);
      continue;
    }
    const kv = content.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]; let val = kv[2].replace(/\s+#.*$/, ''); // strip inline comments
    if (!val) { const next = {}; node[key] = next; stack.push({ indent, node: next }); continue; }
    const flow = val.match(/^\[(.*)\]$/);
    if (flow) {
      const items = flow[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => coerce(x));
      node[key] = items;
      continue;
    }
    node[key] = coerce(val);
  }
  // mappings that only hold bare `- item` lines: their keys became {item:true}
  // under a nested block — collapse those to arrays.
  const fix = (n) => {
    for (const k of Object.keys(n || {})) {
      const v = n[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v);
        if (keys.length && keys.every((kk) => v[kk] === true)) n[k] = keys;
        else fix(v);
      }
    }
  };
  fix(root);
  return root;
}
function coerce(v) {
  const s = String(v).trim().replace(/^["']|["']$/g, '');
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

const cache = new Map();

/** Load one profile: { name, displayName, role, config, soul, dir }. */
export function loadProfile(name) {
  const n = String(name || '').trim().toLowerCase();
  if (cache.has(n)) return cache.get(n);
  const dir = path.join(PROFILES_DIR, n);
  const cfgPath = path.join(dir, 'config.yaml');
  const soulPath = path.join(dir, 'SOUL.md');
  if (!fs.existsSync(cfgPath)) return null;
  const profile = {
    name: n,
    dir,
    config: parseSimpleYaml(fs.readFileSync(cfgPath, 'utf-8')),
    soul: fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : '',
  };
  profile.displayName = profile.config.display_name || n;
  profile.role = profile.config.role || 'subordinate';
  cache.set(n, profile);
  return profile;
}

/** All profiles (orchestrator first). */
export function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR)
    .filter((d) => fs.existsSync(path.join(PROFILES_DIR, d, 'config.yaml')))
    .map((d) => loadProfile(d))
    .sort((a, b) => (a.role === 'primary' ? -1 : b.role === 'primary' ? 1 : a.name.localeCompare(b.name)));
}

/* ── per-agent isolated memory (hermes memory_store analog; JSONL + FTS-ish) ── */

function memFile(agent) { return path.join(STATE_DIR, agent, 'memory.jsonl'); }
function skillDir(agent) { return path.join(STATE_DIR, agent, 'skills'); }

/** Append a memory entry { kind, text, meta } to THIS agent's isolated store. */
export function rememberFor(agent, kind, text, meta = {}) {
  const file = memFile(agent);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = { at: new Date().toISOString(), kind, text: String(text || '').slice(0, 4000), meta };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

/** Full-text search over one agent's memory (token score, newest first). */
export function searchMemory(agent, query, { limit = 5 } = {}) {
  const file = memFile(agent);
  if (!fs.existsSync(file)) return [];
  const tokens = String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const hits = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const blob = `${e.kind} ${e.text}`.toLowerCase();
    const score = tokens.reduce((n, t) => n + (blob.includes(t) ? 1 : 0), 0);
    if (score > 0) hits.push({ ...e, score });
  }
  return hits.sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** Read another agent's skill store (share_skills) — read-only. */
export function foreignSkills(agent) {
  const dir = skillDir(agent);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ({ agent, file: f, path: path.join(dir, f) }));
}

/** Hermes prompt-tier assembly: STABLE (soul+config) → CONTEXT (skills+memory) → VOLATILE (brief). */
export function assembleAgentPrompt(name, { brief = '', recall = '' } = {}) {
  const p = loadProfile(name);
  if (!p) return null;
  const stable = `${p.soul}\n\n## Profile config\n- model preference: ${p.config.model?.prefer || 'auto'}\n- allowed tools: ${JSON.stringify(p.config.tools?.allow || [])}\n- iteration budget: ${p.config.budget?.max_iterations || 8}`;
  const context = [
    recall || '',
  ].filter(Boolean).join('\n\n');
  return {
    stable,
    context,
    volatile: brief,
    full: `${stable}\n\n${context ? `## Relevant precedent\n${context}\n\n` : ''}## Task\n${brief}`,
    profile: p,
  };
}
