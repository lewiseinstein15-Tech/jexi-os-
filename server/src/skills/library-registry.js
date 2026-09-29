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
        // parseFrontmatter returns { metadata, bodyMarkdown } — the P10 fix
        // reads the REAL metadata level (previously fm.name/fm.description
        // were read off the wrapper, so EVERY entry's description was lost
        // and name matching silently fell back to the directory slug).
        const parsedFm = parseFrontmatter(md) || {};
        const fm = parsedFm.metadata || parsedFm;
        const body = md.replace(/^---[\s\S]*?---/, '');
        const steps = parseSteps(body) || [];
        const machineSteps = steps.filter((s) => s.tool);
        const slug = fm.name || path.basename(path.dirname(p));
        out.push({
          slug,
          dir: path.dirname(p),
          name: fm.name || slug,
          description: String(fm.description || '').slice(0, 300),
          hasSteps: machineSteps.length > 0, // P10 GAP 2 — executable = machine steps with a tool
          stepCount: machineSteps.length,
          executionRoot: String(fm.executionRoot || 'skill').toLowerCase(), // P10 GAP 2 — 'skill' | 'workspace'
        });
      } catch { /* unreadable skill file — skip it */ }
    }
  };
  walk(LIBRARY_DIR);
  __index = out;
  return out;
}

/**
 * Keyword-scored lookup over the library index (name > description).
 * P10 GAP 2 — executable skills (machine `## Steps`) get a scoring bonus so
 * a task that matches both a prose page and an executable skill dispatches
 * the EXECUTABLE one; discovery reports which entries are executable.
 * Name matching is SEGMENT-aware (a term scores on the name when it equals a
 * hyphen-delimited name segment, or is a >=5-char substring — so "for" can
 * never score "bypassing-authentication-with-forced-browsing"); generic
 * stopwords never score at all.
 */
const SKILL_MATCH_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'use', 'when', 'into', 'about', 'what', 'how', 'why', 'who', 'which', 'are', 'was', 'were', 'your', 'you', 'my', 'me', 'our', 'out', 'new', 'set', 'per', 'via', 'not', 'but', 'all', 'can', 'will', 'its', 'it', 'of', 'to', 'in', 'on', 'at', 'by', 'as', 'is', 'a', 'an', 'or', 'if', 'do', 'does', 'did']);

/** A query word hits a name when it IS one of the name's hyphen segments
 * ("hooks" ∈ git|hooks|automation) or a >=5-char substring of the name
 * ("diagnose" ⊂ "diagnosing"). Short generic substrings never score. */
function nameSegmentHit(name, word) {
  const segs = String(name || '').split(/[^a-z0-9]+/).filter(Boolean);
  if (segs.includes(word)) return true;
  return word.length >= 5 && String(name || '').includes(word);
}

export function findLibrarySkill(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  // Hyphens split: "pre-commit hooks" → [pre, commit, hooks] — each word can
  // hit the name's own segments or the description text.
  const words = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !SKILL_MATCH_STOPWORDS.has(t));
  if (!words.length) return null;
  let best = null, bestScore = 0, bestNameHit = 0;
  for (const s of librarySkillIndex()) {
    const name = String(s.name || '').toLowerCase();
    const desc = String(s.description || '').toLowerCase();
    let score = 0;
    let nameHit = 0;
    if (q === name) score += 100;
    for (const w of words) {
      if (nameSegmentHit(name, w)) { score += 10; nameHit += 1; }
      if (desc.includes(w)) score += 2;
    }
    if (s.hasSteps) score += 6; // P10 GAP 2 — prefer executable over prose
    // RELEVANCE FLOOR. A description is prose: any single shared word ("test",
    // "scan", "file") hits hundreds of skills. Scoring one 2-point description
    // match and letting the +6 executable bonus promote it meant a real
    // question ("what makes a test suite trustworthy?") was confidently
    // answered with a wireless-penetration document — that skill's name simply
    // ENDS in "test". So a match must either hit the name several times, hit
    // a short name outright, or be the exact name. One stray generic segment in
    // a long name is not evidence of anything.
    const segments = name.split(/[^a-z0-9]+/).filter(Boolean).length;
    const qualifies = q === name || nameHit >= 2 || (nameHit >= 1 && segments <= 3);
    if (qualifies && score > bestScore) { best = s; bestScore = score; bestNameHit = nameHit; }
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
  const { WORKSPACE_DIR } = await import('../config.js');
  // P10 GAP 2 — execution root: frontmatter `executionRoot: workspace` runs
  // the steps against the JEXI workspace (file skills operate on user files);
  // the default root is the skill's own package dir (self-contained steps).
  // Memory always lands in DATA_DIR (never inside the shipped library tree).
  const execRoot = String(skill.executionRoot || 'skill') === 'workspace' ? WORKSPACE_DIR : skill.dir;
  const ctx = {
    root: execRoot,
    memoryFile: path.join(DATA_DIR, 'skills-tools-memory.db'),
  };
  const executed = [];
  let prev = null;
  onEvent?.('start', { slug: skill.slug, steps: steps.length, executable: true, executionRoot: execRoot });
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    const callArgs = resolveArgsDeep(s.args ?? {}, { root: execRoot, args, prev, all: executed });
    onEvent?.('step.start', { index: i, step: s.step, tool: s.tool, args: callArgs });
    let output;
    try {
      output = await domainDispatch(s.tool, callArgs, ctx);
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
  return { ok: true, steps: executed, executionRoot: execRoot };
}

/**
 * P10 GAP 2 — ARGUMENT RESOLUTION SCHEMA for machine-executable `## Steps`:
 *   "$args.<field>"        → the invoking task's args field
 *   "$args.<field>|<dflt>" → ...falling back to <dflt> when absent (so a step
 *                            chain also runs bare, e.g. chat-triggered)
 *   "$root"                → the skill's execution root
 *   "$prev" / "$prev.output[.<path>]" → the previous step's entry / tool
 *                            output / a deep path INTO that output
 * Tokens are resolved BOTH as whole strings (type-preserved — an object stays
 * an object) AND mid-string ("key": "handoff:$args.topic|latest" →
 * "handoff:latest"). Unresolvable tokens pass through verbatim, never nulled.
 */
function lookupArgsField(spec, bag) {
  const pipe = spec.indexOf('|');
  const field = pipe >= 0 ? spec.slice(0, pipe) : spec;
  const dflt = pipe >= 0 ? spec.slice(pipe + 1) : undefined;
  const hit = bag.args[field];
  return (hit !== undefined && hit !== null) ? hit : dflt;
}

function deepGet(obj, dotted) {
  let cur = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function resolveArgsDeep(value, bag) {
  if (typeof value === 'string') {
    // Whole-string tokens resolve type-preserved.
    if (value === '$root') return bag.root;
    if (value === '$prev') return bag.prev;
    if (value.startsWith('$args.')) {
      const v = lookupArgsField(value.slice(6), bag);
      return v !== undefined ? v : value;
    }
    if (value.startsWith('$prev.output')) {
      const rest = value.slice('$prev.output'.length).replace(/^\./, '');
      const v = rest ? deepGet(bag.prev && bag.prev.output, rest) : (bag.prev && bag.prev.output);
      return v !== undefined ? v : value;
    }
    // Mid-string interpolation ("handoff:$args.topic|latest" → "handoff:latest").
    if (value.includes('$')) {
      let out = value.replace(/\$args\.([A-Za-z0-9_]+(?:\|[^$]*)?)/g, (m, spec) => {
        const v = lookupArgsField(spec, bag);
        return v === undefined ? m : String(v);
      });
      out = out.replace(/\$prev\.output((?:\.[A-Za-z0-9_]+)*)/g, (m, dotted) => {
        const v = dotted ? deepGet(bag.prev && bag.prev.output, dotted.slice(1)) : (bag.prev && bag.prev.output);
        if (v === undefined || v === null) return m;
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      });
      out = out.split('$root').join(String(bag.root));
      return out;
    }
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
 * P10 GAP 2 — the invoking task's query rides args implicitly (a step's
 * "$args.query" resolves without the caller having to duplicate it), and a
 * successful steps invocation returns the AGGREGATE of the real tool outputs.
 */
export async function invokeLibrarySkill(query, args = {}, { onEvent } = {}) {
  const t0 = Date.now();
  const skill = findLibrarySkill(query);
  if (!skill) {
    return { ok: false, error: `no library skill matches "${String(query).slice(0, 80)}"`, matched: false };
  }
  const effectiveArgs = { query: String(query), ...args }; // P10 GAP 2 — implicit task query
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
    result = await runLibrarySteps(skill, body, effectiveArgs, ev);
    if (result) mode = result.ok ? 'steps' : 'error';
  } catch (e) {
    result = { ok: false, code: 'RUNNER_ERROR', error: String(e && e.message || e) };
    mode = 'error';
  }

  // P10 GAP 2 — the aggregate: every executed step's REAL tool output, in
  // order, summarised to one readable blob (the skill's total effect).
  // The domain executor wraps engine output as { ok, result, ... } — the
  // aggregate unwraps `.result` when present.
  const aggregate = (mode === 'steps' && result && Array.isArray(result.steps))
    ? result.steps.map((s) => {
        const out = s.output;
        const inner = (out && typeof out === 'object' && out.result !== undefined) ? out.result : out;
        const text = (inner && typeof inner === 'object')
          ? (inner.text !== undefined ? String(inner.text).slice(0, 500) : JSON.stringify(inner).slice(0, 500))
          : String(inner ?? '').slice(0, 500);
        return `[step ${s.index + 1}] ${s.tool} → ${text}`;
      }).join('\n')
    : undefined;

  const entry = {
    kind: 'skill.invoke',
    source: 'library',
    slug: skill.slug,
    mode,
    query: String(query).slice(0, 120),
    args: effectiveArgs,
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
    aggregate,
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
