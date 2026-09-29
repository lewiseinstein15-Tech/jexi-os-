/**
 * The doom-loop guard.
 *
 * Two things live here because they are the same idea and must never drift:
 * how a tool call is *identified* (the key) and when repeats are *refused*
 * (the limits). Both are pure functions with no I/O, so the rules are
 * unit-testable without a model, a workspace, or a sandbox.
 */

/**
 * The repeat-tool reminder: consecutive identical calls are tracked and, at
 * thresholds 3/5/8, the loop
 * injects an advisory reminder instead of silently repeating.
 */
export function repeatReminderFor(key, count) {
  if (count === 3) return `[Reminder: you have called the same tool with the same arguments ${count} times in a row. The result has not changed — stop repeating. Change your approach: different arguments, another tool, or answer from what you already have.]`;
  if (count === 5) return `[Reminder: this is the ${count}th identical call. Repeating it again will not produce a different result. Try a different tool or answer directly.]`;
  if (count === 8) return `[Reminder: ${count} identical calls in a row — the loop will cap tool calls soon. Do NOT call "${String(key).split('|')[0]}" again; synthesize an answer from the evidence you have.]`;
  return null;
}

/**
 * The breaker — doom-loop hard breaker (OpenCode rule: the same tool with the
 * same arguments must never execute forever). The advisory reminders above
 * stay, but at LOOP_BREAKER_LIMIT identical consecutive calls the loop
 * STOPS EXECUTING that call and feeds back a breaker message instead: no
 * side effects, no budget burn, and the turn iteration cap still bounds
 * a model that refuses to change approach.
 */
export const LOOP_BREAKER_LIMIT = 5;

export function loopBreakerMessage(tool, count) {
  return `[LOOP BREAKER: "${tool}" with identical arguments was blocked after ${count} consecutive identical calls. It did NOT execute. Do NOT call it again with these arguments — use different arguments, another tool, or answer from the evidence you already have.]`;
}

/* The key used to be `name|JSON.stringify(args)`. Key order, `./x` vs `x`,
   and stray whitespace each produced a distinct key for calls the model
   plainly meant as the same one — so a stuck loop could walk past the breaker
   by re-ordering its own JSON. Normalizing first makes "the same call" mean
   the same call. */
export function normalizeCallArgs(args, depth = 0) {
  if (depth > 6) return '…';
  if (args === null || args === undefined) return null;
  if (Array.isArray(args)) return args.map((v) => normalizeCallArgs(v, depth + 1));
  if (typeof args === 'object') {
    const out = {};
    for (const k of Object.keys(args).sort()) {
      if (args[k] === undefined) continue;            // absent == not passed
      out[k.trim().toLowerCase()] = normalizeCallArgs(args[k], depth + 1);
    }
    return out;
  }
  if (typeof args === 'string') {
    let v = args.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    // Resolve `.` and `..` segments so `./a/../b.ts`, `/a/../b.ts` and `b.ts`
    // collapse to one key. A string with no `/` is untouched by this.
    const out = [];
    for (const seg of v.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    v = out.join('/');
    return v.length > 512 ? `${v.slice(0, 512)}…` : v;
  }
  if (typeof args === 'number') return Number.isFinite(args) ? args : String(args);
  return args;
}


/** The skill whose `whenToUse` best matches a coding query, if any. */
export async function activeCodingSkill(query) {
  let index = {};
  try {
    const { catalog } = await import('../skills/catalog.js');
    index = await catalog();
  } catch { return null; }   // no skills installed is not an error
  const q = String(query || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const meta of Object.values(index)) {
    const w = String(meta?.whenToUse || '').toLowerCase();
    if (!w || !meta?.allowedTools?.length) continue;
    const terms = w.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    const score = terms.reduce((n, t) => n + (q.includes(t) ? 1 : 0), 0)
      + (/(pytest|unittest|tox|failing test|make .* pass)/.test(q) && /pytest|unittest|tox|test/.test(w) ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = meta; }
  }
  return bestScore > 0 ? best : null;
}

export function loopKeyFor(name, args) {
  return `${String(name || '').toLowerCase().trim()}|${JSON.stringify(normalizeCallArgs(args ?? {}))}`;
}

export function loopBreakerTrips(repeatCount) {
  return Number(repeatCount) >= LOOP_BREAKER_LIMIT;
}
