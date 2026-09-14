/**
 * JEXI OS — SKILLS — executor (Scope C).
 *
 * An executable SKILL.md's `## Steps` block is a real procedure: every step
 * names a REAL tool from the tool registry (Scope A's domain registry, the
 * same `domainDispatch` ToolRuntime uses) and passes REAL args. This module
 * parses those steps, executes each one through the registry, and returns a
 * structured result — the executor, not a wall of prompt text.
 *
 *   const { findSkillFor, executeSkillBySlug } = await import('./skills/executor.js');
 *   const slug = findSkillFor('test output shows failures'); // catalog trigger
 *   const result = await executeSkillBySlug(slug, {
 *     root: '/path/to/project',
 *     args: { file: 'src/add.test.js', module: 'src/add.js' },
 *     onEvent: (type, payload) => console.log(type, payload),
 *   });
 *
 * Step args are JSON. Values may be templates:
 *   "$root"           → the execute root (ctx.root)
 *   "$args.<name>"    → a caller-supplied argument (passed via execute args)
 *   "$prev"           → the full output of the previous step
 *   "$prev.result.x"  → a field inside the previous step's tool output
 *
 * A step that fails (unknown tool, schema error, engine error — `ok:false`
 * on the ToolResult wrapper) aborts the run with a structured failure naming
 * the step. A tool that legitimately REPORTS a failing test (test_run →
 * status:'fail' inside result) is a successful tool call — the executor
 * captured the evidence; it does not treat evidence as an executor crash.
 */

import { readSkill } from './loader.js';
import { catalog } from './catalog.js';

/**
 * Resolve template values in step args against the run bag
 * ({ root, args, prev, all, byIndex }).
 */
export function resolveArg(value, bag) {
  if (typeof value === 'string') {
    const v = value.trim();
    if (v === '$root') return bag.root;
    if (v === '$prev') return bag.prev && bag.prev.output;
    const mPrev = /^\$prev\.(.+)$/.exec(v);
    if (mPrev) return getPath(bag.prev && bag.prev.output, mPrev[1]);
    const mArgs = /^\$args\.([A-Za-z0-9_]+)$/.exec(v);
    if (mArgs) return bag.args ? bag.args[mArgs[1]] : undefined;
    // Inline substitution inside a larger string.
    return value
      .replace(/\$prev\.([A-Za-z0-9_.]+)/g, (mm, p) => {
        const got = bag.prev && bag.prev.output ? getPath(bag.prev.output, p) : undefined;
        return got === undefined || got === null ? mm : String(got);
      })
      .replace(/\$args\.([A-Za-z0-9_]+)/g, (mm, p) => {
        const got = bag.args ? bag.args[p] : undefined;
        return got === undefined || got === null ? mm : String(got);
      })
      .replace(/\$root/g, String(bag.root));
  }
  if (Array.isArray(value)) return value.map((x) => resolveArg(x, bag));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(value)) out[k] = resolveArg(x, bag);
    return out;
  }
  return value;
}

/** Deep dot-path getter (e.g. "result.stdout"). */
function getPath(obj, dotPath) {
  let cur = obj;
  for (const seg of String(dotPath).split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Default dispatch: the real Scope-A domain registry used by ToolRuntime. */
async function defaultDispatch(tool, args, ctx) {
  const { domainDispatch } = await import('../tools/domains/executor.js');
  return domainDispatch(tool, args, ctx);
}

const summarize = (e) => ({
  index: e.index,
  step: e.step,
  tool: e.tool,
  ok: !!(e.output && e.output.ok !== false),
  args: e.args,
  output: e.output,
});

/**
 * Execute a skill's parsed `## Steps` procedure.
 *
 * @param {object} opts
 *   slug     — skill slug (on-disk dir under the skills store)
 *   root     — workspace root passed to every tool (ctx.root)
 *   args     — caller-supplied values referenced via `$args.<name>`
 *   onEvent  — (type, payload) progress: 'start' | 'step.start' |
 *              'step.result' | 'done' | 'error'
 *   toolDispatch — override (tool, args, ctx) => Promise<ToolResult-like>;
 *              defaults to the real domainDispatch.
 */
export async function executeSkill({ slug, root, args = {}, onEvent, toolDispatch } = {}) {
  const skill = readSkill(slug);
  if (!skill) {
    const failure = { ok: false, slug, error: { code: 'SKILL_NOT_FOUND', message: `skill "${slug}" not found` } };
    onEvent?.('error', failure);
    return failure;
  }
  const steps = skill.steps.filter((s) => s.tool);
  if (!steps.length) {
    const failure = {
      ok: false, slug, skill: skill.name,
      error: { code: 'NOT_EXECUTABLE', message: 'skill has no machine-executable ## Steps (free-form text only)' },
    };
    onEvent?.('error', failure);
    return failure;
  }
  const dispatch = typeof toolDispatch === 'function' ? toolDispatch : defaultDispatch;
  const rootDir = root || process.cwd();
  const bag = { root: rootDir, args, prev: null, all: [], byIndex: {} };
  const executed = [];
  onEvent?.('start', { slug, skill: skill.name, steps: steps.length, executable: true });

  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    const callArgs = resolveArg(s.args ?? {}, bag);
    onEvent?.('step.start', { index: i, step: s.step, tool: s.tool, args: callArgs });
    let output;
    try {
      output = await dispatch(s.tool, callArgs, { root: rootDir });
    } catch (e) {
      output = { ok: false, error: (e && e.message) || String(e) };
    }
    const entry = { index: i, step: s.step, tool: s.tool, args: callArgs, output };
    executed.push(entry);
    bag.all.push(entry);
    bag.byIndex[i] = entry;
    bag.prev = entry;
    onEvent?.('step.result', entry);

    if (!output || output.ok === false) {
      const failure = {
        ok: false, slug, skill: skill.name, error: { code: 'STEP_FAILED', message: `tool "${s.tool}" failed`, failedStep: i, failedStepName: s.step },
        failedStep: i, failedStepName: s.step, tool: s.tool, args: callArgs, output,
        completed: executed.map(summarize),
      };
      onEvent?.('error', failure);
      return failure;
    }
  }

  const result = { ok: true, slug, skill: skill.name, steps: executed.map(summarize) };
  onEvent?.('done', result);
  return result;
}

/** Convenience: load a skill + execute it, from the catalog store. */
export async function executeSkillBySlug(slug, opts = {}) {
  return executeSkill({ slug, ...opts });
}

/**
 * CATALOG TRIGGER: decide which skill applies, from the catalog's metadata
 * (description / whenToUse / name), WITHOUT loading any body. Returns the
 * slug of the best-matching EXECUTABLE skill, or null.
 */
export async function findSkillFor(query) {
  const index = await catalog();
  const q = String(query || '').toLowerCase();
  const scored = [];
  for (const entry of Object.values(index)) {
    if (!entry.executable) continue;
    const hay = `${entry.name} ${entry.description} ${entry.whenToUse}`.toLowerCase();
    if (!hay.includes(q)) continue;
    scored.push({ slug: entry.slug, score: hay.indexOf(q) });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.length ? scored[0].slug : null;
}