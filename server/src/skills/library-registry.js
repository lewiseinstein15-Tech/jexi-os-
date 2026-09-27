/**
 * JEXI OS — PHASE 5 P5-1 — skills/library wiring.
 *
 * Before this module, skills/library (1100+ SKILL.md files) was INERT: zero
 * server references, never discovered, never callable. Per
 * docs/AGENT-WIRING-RESEARCH.md §13 pattern 5 ("skills are lazy: a tiny
 * always-on index, the body behind a tool"), this module:
 *
 *   1. DISCOVERS the library at boot — frontmatter (name/description) only,
 *      so the context budget stays bounded (progressive disclosure).
 *   2. MAKES SKILLS CALLABLE — invokeLibrarySkill() resolves a library skill
 *      and dispatches it through the REAL skill executor (machine-executable
 *      `## Steps` run via the domain tool registry; prose skills return their
 *      body honestly as a reference invocation — never faked as executed).
 *   3. LOGS EVERY INVOCATION — DATA_DIR/skills-log.jsonl is the raw tool log
 *      entry simulations assert on.
 *
 * Fail-soft everywhere: a broken library degrades to an empty index without
 * breaking boot or a chat turn.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../config.js';
import { parseFrontmatter, parseSteps } from './catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const LIBRARY_DIR = path.join(REPO_ROOT, 'skills', 'library');

let __index = null; // [{ slug, dir, name, description, hasSteps, stepCount }]

/** Scan + parse every SKILL.md under skills/library (frontmatter only). */
export function librarySkillIndex({ refresh = false } = {}) {
  if (__index && !refresh) return __index;
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== 'SKILL.md') continue;
      try {
        const md = fs.readFileSync(p, 'utf8');
        const fm = parseFrontmatter(md) || {};
        const body = md.replace(/^---[\s\S]*?---/, '');
        const steps = parseSteps(body) || [];
        const slug = fm.name || path.basename(path.dirname(p));
        out.push({
          slug,
          dir: path.dirname(p),
          name: fm.name || slug,
          description: String(fm.description || '').slice(0, 300),
          hasSteps: steps.length > 0,
          stepCount: steps.length,
        });
      } catch { /* unreadable skill file — skip it */ }
    }
  };
  walk(LIBRARY_DIR);
  __index = out;
  return out;
}

/** Keyword-scored lookup over the library index (name > description). */
export function findLibrarySkill(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const terms = q.split(/[^a-z0-9-]+/).filter((t) => t.length > 2);
  let best = null, bestScore = 0;
  for (const s of librarySkillIndex()) {
    const name = String(s.name || '').toLowerCase();
    const desc = String(s.description || '').toLowerCase();
    let score = 0;
    if (q === name) score += 100;
    if (name.includes(q)) score += 40;
    for (const t of terms) {
      if (name.includes(t)) score += 10;
      if (desc.includes(t)) score += 2;
    }
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

/** Append-only invocation log — the raw tool log entry simulations assert on. */
function logInvocation(entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'skills-log.jsonl'), line);
  } catch { /* logging must never break a skill call */ }
}

/**
 * Run a library skill's machine-executable `## Steps` through the REAL
 * domain tool registry (same dispatch contract as src/skills/executor.js —
 * kept local because the executor reads only the builtin/plugin stores).
 */
async function runLibrarySteps(skill, bodyMarkdown, args = {}, onEvent) {
  const steps = (parseSteps(bodyMarkdown) || []).filter((s) => s.tool);
  if (!steps.length) return null; // prose skill — caller falls back to reference mode
  const { domainDispatch } = await import('../tools/domains/executor.js');
  const executed = [];
  let prev = null;
  onEvent?.('start', { slug: skill.slug, steps: steps.length, executable: true });
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    const callArgs = resolveArgsDeep(s.args ?? {}, { root: skill.dir, args, prev, all: executed });
    onEvent?.('step.start', { index: i, step: s.step, tool: s.tool, args: callArgs });
    let output;
    try {
      output = await domainDispatch(s.tool, callArgs, { root: skill.dir });
    } catch (e) {
      output = { ok: false, error: (e && e.message) || String(e) };
    }
    const entry = { index: i, step: s.step, tool: s.tool, args: callArgs, output };
    executed.push(entry);
    prev = entry;
    onEvent?.('step.result', entry);
    if (!output || output.ok === false) {
      return { ok: false, code: 'STEP_FAILED', steps: executed, failedStep: i, output };
    }
  }
  return { ok: true, steps: executed };
}

function resolveArgsDeep(value, bag) {
  if (typeof value === 'string') {
    if (value.startsWith('$args.')) return bag.args[value.slice(6)] ?? value;
    if (value === '$root') return bag.root;
    if (value === '$prev') return bag.prev;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveArgsDeep(v, bag));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveArgsDeep(v, bag);
    return out;
  }
  return value;
}

/**
 * Invoke a library skill by query or slug, through the REAL executor.
 * Returns { ok, mode: 'steps'|'reference', slug, ... } — honest in both modes.
 */
export async function invokeLibrarySkill(query, args = {}, { onEvent } = {}) {
  const t0 = Date.now();
  const skill = findLibrarySkill(query);
  if (!skill) {
    return { ok: false, error: `no library skill matches "${String(query).slice(0, 80)}"`, matched: false };
  }
  let raw = '';
  let body = '';
  try {
    raw = fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8');
    body = raw.replace(/^---[\s\S]*?---/, '');
  } catch { /* unreadable — steps will be empty */ }
  const events = [];
  const ev = (type, payload) => { events.push({ type, payload }); try { onEvent && onEvent(type, payload); } catch { /* listener errors ignored */ } };

  let result = null;
  let mode = 'reference';
  try {
    result = await runLibrarySteps(skill, body, args, ev);
    if (result) mode = result.ok ? 'steps' : 'error';
  } catch (e) {
    result = { ok: false, code: 'RUNNER_ERROR', error: String(e && e.message || e) };
    mode = 'error';
  }

  const entry = {
    kind: 'skill.invoke',
    source: 'library',
    slug: skill.slug,
    mode,
    query: String(query).slice(0, 120),
    args,
    ok: mode === 'steps' || mode === 'reference',
    stepCount: skill.stepCount,
    durationMs: Date.now() - t0,
  };
  logInvocation(entry);
  return {
    ok: entry.ok,
    mode,
    slug: skill.slug,
    description: skill.description,
    stepCount: skill.stepCount,
    steps: mode === 'steps' && result ? result.steps : undefined,
    error: mode === 'error' ? result : undefined,
    body: mode === 'reference' ? body.slice(0, 4000) : undefined,
    events,
    logEntry: entry,
  };
}

/** Stats for self-awareness / roster. */
export function libraryStats() {
  const idx = librarySkillIndex();
  return {
    indexed: idx.length,
    executable: idx.filter((s) => s.hasSteps).length,
    libraryDir: LIBRARY_DIR,
  };
}

/** Boot-time registration — warms the index and reports the real counts. */
export function registerLibrarySkills() {
  try {
    const stats = libraryStats();
    return { ok: true, ...stats, line: `[Skills] library index: ${stats.indexed} SKILL.md files (${stats.executable} machine-executable) — callable via invokeLibrarySkill / POST /api/skills/library/invoke` };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
