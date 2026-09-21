#!/usr/bin/env node
/**
 * JEXI OS — Phase 20 Scope F — LIVE PROBES P1–P4 (ralph).
 *
 * Raw output only. Run: node scripts/phase20-scope-f.mjs
 * Exit 0 = all pass, 1 = any fail.
 */
import ralph from '../swarm/loops/ralph.js';
import { SwarmError } from '../swarm/topologies/_internal.js';

let failures = 0;
function verdict(id, ok, msg) {
  console.log(`${id}: ${ok ? 'PASS' : 'FAIL'} — ${msg}`);
  if (!ok) failures += 1;
}

console.log('═══════════════════════════════════════════════════');
console.log("P1 — fail twice, succeed on 3rd -> 'success', attempts=3");
console.log('═══════════════════════════════════════════════════');
let buildAttempts = 0;
const flakyBuild = () => {
  buildAttempts += 1;
  if (buildAttempts < 3) return { ok: false, failure: `transient-${buildAttempts}: runner restart` };
  return { ok: true, output: 'shipped' };
};
const r1 = ralph.run(flakyBuild, {
  initialContext: 'ctx-v0',
  adjustContext: (ctx, failure) => `${ctx}+${failure}`,
});
console.log('result ->', JSON.stringify(r1, null, 0));
verdict('P1', r1.stoppedBy === 'success' && r1.attempts === 3 && r1.contextLog.length === 3
  && r1.result.output === 'shipped',
  "success on the 3rd attempt; attempts = actual count (3); contextLog has 3 entries");

console.log('\n═══════════════════════════════════════════════════');
console.log("P2 — always fail, maxAttempts 4 -> 'max-attempts'");
console.log('═══════════════════════════════════════════════════');
const alwaysFail = (ctx, attempt) => { throw new Error(`hard-down-${attempt}`); };
const r2 = ralph.run(alwaysFail, { maxAttempts: 4, adjustContext: (ctx, failure) => `${ctx || ''}#${failure}` });
console.log('result ->', JSON.stringify(r2));
verdict('P2', r2.stoppedBy === 'max-attempts' && r2.attempts === 4 && r2.result.ok === false
  && r2.result.failure === 'hard-down-4' && r2.contextLog.length === 4,
  "budget exhausted at 4 attempts; thrown errors recorded as failures; last failure reported");

console.log('\n═══════════════════════════════════════════════════');
console.log('P3 — contextLog shows distinct adjusted contexts per attempt');
console.log('═══════════════════════════════════════════════════');
const contexts = r1.contextLog.map((e) => JSON.stringify(e.context));
console.log('contexts ->', JSON.stringify(r1.contextLog.map((e) => ({ attempt: e.attempt, context: e.context }))));
const distinct = new Set(contexts).size === contexts.length;
const grows = r1.contextLog.every((e, i) => i === 0 || String(e.context).startsWith(String(r1.contextLog[i - 1].context)));
verdict('P3', distinct && grows,
  'every attempt ran a distinct context, each derived from the previous one via adjustContext');

console.log('\n═══════════════════════════════════════════════════');
console.log('P4 — determinism: same task + adjuster -> byte-identical');
console.log('═══════════════════════════════════════════════════');
const mk = () => {
  let n = 0;
  const t = () => {
    n += 1;
    if (n < 3) return { ok: false, failure: `transient-${n}` };
    return { ok: true, output: 'shipped' };
  };
  return JSON.stringify(ralph.run(t, {
    initialContext: 'ctx-v0',
    adjustContext: (ctx, failure) => `${ctx}+${failure}`,
    maxAttempts: 6,
  }));
};
const s1 = mk();
const s2 = mk();
console.log(`run bytes: run1=${s1.length} run2=${s2.length} identical=${s1 === s2}`);
console.log('run:', s1);

// Real validation errors while we are here.
const badTask = (() => {
  try {
    ralph.run('not-a-function', {});
    return false;
  } catch (err) { return err instanceof SwarmError && err.code === 'E_INVALID_TASK'; }
})();
const badMax = (() => {
  try {
    ralph.run(() => ({ ok: true }), { maxAttempts: 0 });
    return false;
  } catch (err) { return err instanceof SwarmError && err.code === 'E_INVALID_MAX_ATTEMPTS'; }
})();
console.log(`E_INVALID_TASK raised for non-function task: ${badTask}; E_INVALID_MAX_ATTEMPTS for 0: ${badMax}`);
verdict('P4', s1 === s2 && badTask && badMax, 'byte-identical runs; invalid inputs refused with typed errors');

console.log(`\nSCOPE F: ${4 - failures}/4 PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
