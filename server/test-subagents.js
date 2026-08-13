/**
 * Stage 14 (subagent runtime) tests — decomposition + structural behavior.
 * No AI keys needed: subagent runs complete with their fallback paths, which
 * still exercises plan → spawn → collect → aggregate.
 */
import { decomposeQuery, runSubagents } from './src/services/SubagentRuntime.js';

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

/* ---------------- Decomposition (deterministic) ---------------- */
const parts = decomposeQuery('Research solar panels and build a calculator app');
check('decomposes on "and"', parts.length === 2);
check('decomposed parts are trimmed', parts.every((p) => p === p.trim() && p.length > 8));

const single = decomposeQuery('Just tell me a fun fact');
check('single intent is not decomposed', single.length === 0);

const multi = decomposeQuery('Write a summary; then draft a reply');
check('decomposes on semicolon', multi.length === 2);

/* ---------------- runSubagents structure (no keys → fallback paths) ---------------- */
const events = [];
const res = await runSubagents({
  tasks: [
    { name: 'Alpha', query: 'List three colors' },
    { name: 'Beta', query: 'Name two planets' },
  ],
  sendEvent: (type, data) => events.push({ type, ...data }),
});

check('subagents array has one entry per task', res.subagents.length === 2);
check('every subagent reports a terminal status', res.subagents.every((s) => ['done', 'failed', 'cancelled'].includes(s.status)));
check('counts reflect the runs', res.counts.total === 2 && (res.counts.ok + res.counts.failed) === 2);
check('aggregate is a string', typeof res.aggregate === 'string');

check('emitted subagent.start per task', events.filter((e) => e.type === 'subagent.start').length === 2);
check('emitted subagent.done per task', events.filter((e) => e.type === 'subagent.done').length === 2);
check('emitted final aggregate', events.some((e) => e.type === 'subagent.aggregate'));

/* ---------------- Cancellation ---------------- */
const ctrl = new AbortController();
ctrl.abort();
const cancelled = await runSubagents({
  tasks: [{ name: 'X', query: 'Long mission' }],
  sendEvent: () => {},
  opts: { signal: ctrl.signal },
});
check('pre-cancelled run returns without work', cancelled.subagents.length === 0 || cancelled.subagents.every((s) => s.status === 'cancelled'));

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
