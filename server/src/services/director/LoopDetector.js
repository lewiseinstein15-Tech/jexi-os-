/**
 * JEXI OS — LOOP DETECTOR (AGI Phase 7; runtime adaptation of Antidoom's
 * doom-loop analysis — NO training, NO dependency, per docs/research/ANTIDOOM.md).
 *
 * Antidoom's diagnosis of doom loops translates directly to runtime checks:
 *   overtrained tokens   → repeated identical TOOL CALLS
 *   self-reinforcing ctx → repeated FAILED ACTIONS with the same signature
 *   no escape at temp 0  → repeated REASONING outputs (near-identical turns)
 * plus the structural kind: CIRCULAR PLANS (A depends on B depends on A).
 *
 * Deterministic, keyless. The failure ladder consults this before choosing
 * another retry: a loop is not a failure to retry — it is a signal to change
 * strategy.
 */

const MAX_TRACKED = 200;

const actions = new Map(); // signature → { count, failures, lastError, firstAt, lastAt }
const reasoningOutputs = []; // recent outputs for repetition comparison

function sig(tool, args) {
  const a = args == null ? '' : (typeof args === 'string' ? args : JSON.stringify(args));
  return `${String(tool)}::${a}`.slice(0, 300);
}

/** Record one action attempt. Returns the running record. */
export function recordAction(tool, args, { ok = true, error = null } = {}) {
  const key = sig(tool, args);
  let r = actions.get(key);
  if (!r) {
    if (actions.size >= MAX_TRACKED) actions.delete(actions.keys().next().value);
    r = { count: 0, failures: 0, lastError: null, firstAt: Date.now(), lastAt: Date.now() };
    actions.set(key, r);
  }
  r.count += 1;
  r.lastAt = Date.now();
  if (!ok) { r.failures += 1; r.lastError = error ? String(error).slice(0, 200) : r.lastError; }
  return { ...r, signature: key };
}

/** Record a reasoning output; returns similarity to the previous one (0..1). */
export function recordReasoning(text) {
  const t = String(text || '');
  const prev = reasoningOutputs[reasoningOutputs.length - 1];
  reasoningOutputs.push(t);
  if (reasoningOutputs.length > 10) reasoningOutputs.shift();
  if (prev == null) return 0;
  return similarity(prev, t);
}

/** Cheap deterministic similarity: shared distinctive tokens / union. */
export function similarity(a, b) {
  const ta = new Set(String(a).toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const tb = new Set(String(b).toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared += 1;
  return shared / new Set([...ta, ...tb]).size;
}

/**
 * Detect every active loop condition.
 * @returns array of { type, detail, advice } — empty when healthy.
 */
export function detectLoops({ repeatedCallThreshold = 3, repeatedFailureThreshold = 2, reasoningThreshold = 0.85 } = {}) {
  const out = [];
  for (const [key, r] of actions) {
    if (r.count >= repeatedCallThreshold) {
      out.push({
        type: 'repeated-tool-call',
        detail: `${key.split('::')[0]} called ${r.count}× with identical arguments`,
        advice: 'identical repetition adds no information — change arguments, tool, or strategy',
      });
    }
    if (r.failures >= repeatedFailureThreshold) {
      out.push({
        type: 'repeated-failure',
        detail: `${key.split('::')[0]} failed ${r.failures}× the same way${r.lastError ? ` (${r.lastError.slice(0, 80)})` : ''}`,
        advice: 'retrying the same failing action is a doom loop — generate a hypothesis and try a different approach',
      });
    }
  }
  // repeated reasoning: last two outputs near-identical
  const n = reasoningOutputs.length;
  if (n >= 2 && similarity(reasoningOutputs[n - 2], reasoningOutputs[n - 1]) >= reasoningThreshold) {
    out.push({
      type: 'repeated-reasoning',
      detail: `the last two reasoning outputs are ≥${Math.round(reasoningThreshold * 100)}% identical`,
      advice: 'the model is re-deriving the same conclusion — force a strategy change or surface to the user',
    });
  }
  return out;
}

/**
 * Circular plan detection: given [{id, dependsOn[]}], find cycles.
 * Returns the first cycle found (array of ids) or null.
 */
export function findCircularPlan(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const state = new Map(); // id → 0 visiting | 1 done
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 0) {
      const at = stack.indexOf(id);
      return stack.slice(at);
    }
    state.set(id, 0);
    stack.push(id);
    const item = byId.get(id);
    for (const dep of (item && item.dependsOn) || []) {
      if (byId.has(dep)) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, 1);
    return null;
  };
  for (const item of items) {
    const cycle = visit(item.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Test seam. */
export function __resetLoops() { actions.clear(); reasoningOutputs.length = 0; }
