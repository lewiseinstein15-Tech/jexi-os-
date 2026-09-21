#!/usr/bin/env node
/**
 * JEXI OS — Phase 20 Scope D — LIVE PROBES P1–P4 (looper).
 *
 * Raw output only. Run: node scripts/phase20-scope-d.mjs
 * Exit 0 = all pass, 1 = any fail.
 */
import looper from '../swarm/loops/looper.js';
import { SwarmError } from '../swarm/topologies/_internal.js';

let failures = 0;
function verdict(id, ok, msg) {
  console.log(`${id}: ${ok ? 'PASS' : 'FAIL'} — ${msg}`);
  if (!ok) failures += 1;
}

const refine = (prev) => ({ n: (prev ? prev.n : 0) + 1, value: `refine-${(prev ? prev.n : 0) + 1}` });

console.log('═══════════════════════════════════════════════════');
console.log("P1 — loop stops at 3 -> stoppedBy 'stop-condition', iterations=3");
console.log('═══════════════════════════════════════════════════');
const seen = [];
const r1 = looper.run(refine, {
  stopWhen: (r) => r.n >= 3,
  onIteration: ({ n, result }) => seen.push(`#${n}:${result.value}`),
});
console.log('result ->', JSON.stringify(r1));
console.log('onIteration trail ->', JSON.stringify(seen));
verdict('P1', r1.stoppedBy === 'stop-condition' && r1.iterations === 3 && r1.finalResult.value === 'refine-3' && seen.length === 3,
  "stop condition met at iteration 3; actual count reported (not the cap); callback fired 3 times");

console.log('\n═══════════════════════════════════════════════════');
console.log("P2 — stop never met, maxIterations 5 -> 'max-iterations', iterations=5");
console.log('═══════════════════════════════════════════════════');
const r2 = looper.run(refine, { maxIterations: 5, stopWhen: (r) => r.n >= 99 });
console.log('result ->', JSON.stringify(r2));
verdict('P2', r2.stoppedBy === 'max-iterations' && r2.iterations === 5 && r2.finalResult.n === 5,
  "cap reached at 5; iterations = 5 actual steps run");

console.log('\n═══════════════════════════════════════════════════');
console.log('P3 — errors: callback propagates; task error stops with stoppedBy=error');
console.log('═══════════════════════════════════════════════════');
let cbThrows = null;
try {
  looper.run(refine, {
    stopWhen: () => false,
    onIteration: ({ n }) => { if (n === 2) throw new Error('callback-boom'); },
  });
} catch (err) {
  cbThrows = err.message;
}
console.log(`onIteration error propagated out of run(): ${JSON.stringify(cbThrows)}`);

const boom = (prev) => {
  if (prev && prev.n >= 1) throw new Error('task-boom on follow-up');
  return { n: 1 };
};
const r3 = looper.run(boom, { stopWhen: () => false });
console.log('task error ->', JSON.stringify(r3));
verdict('P3', cbThrows === 'callback-boom' && r3.stoppedBy === 'error' && r3.iterations === 1 && r3.error.message === 'task-boom on follow-up',
  "callback error propagates unswallowed; task error -> stoppedBy 'error' with completed-iteration count");

console.log('\n═══════════════════════════════════════════════════');
console.log('P4 — determinism: same task + predicate -> byte-identical');
console.log('═══════════════════════════════════════════════════');
const mk = () => {
  const trail = [];
  const r = looper.run(refine, {
    maxIterations: 4,
    stopWhen: (res) => res.n >= 3,
    onIteration: ({ n, result }) => trail.push({ n, value: result.value }),
  });
  return JSON.stringify({ r, trail });
};
const s1 = mk();
const s2 = mk();
console.log(`run bytes: run1=${s1.length} run2=${s2.length} identical=${s1 === s2}`);
console.log('run:', s1);
verdict('P4', s1 === s2, 'byte-identical results and callback trails across runs');

console.log(`\nSCOPE D: ${4 - failures}/4 PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
