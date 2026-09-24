#!/usr/bin/env node
/**
 * JEXI OS — Phase 20 Scope B — LIVE PROBES P1–P6 (hive-mind queen + workers).
 *
 * Raw output only. Run: node scripts/phase20-scope-b.mjs
 * Exit 0 = all pass, 1 = any fail.
 */
import { Hive } from '../agents/swarm/hive/index.js';
import { SwarmError } from '../agents/swarm/topologies/_internal.js';
import hive from '../agents/swarm/hive/index.js';

let failures = 0;
function verdict(id, ok, msg) {
  console.log(`${id}: ${ok ? 'PASS' : 'FAIL'} — ${msg}`);
  if (!ok) failures += 1;
}
const expectError = (fn, code) => {
  try {
    fn();
    return { threw: false };
  } catch (err) {
    return { threw: err instanceof SwarmError && err.code === code, err };
  }
};

console.log('═══════════════════════════════════════════════════');
console.log('P1 — create a hive with 1 queen + 3 workers');
console.log('═══════════════════════════════════════════════════');
const local = new Hive();
const created = local.create({
  queen: { type: 'strategist' },
  workers: [
    { type: 'builder', id: 'worker-bravo' },
    { type: 'verifier', id: 'worker-alpha' },
    { type: 'researcher', id: 'worker-charlie' },
  ],
});
console.log('create(config) ->', JSON.stringify(created));
console.log('queen() ->', JSON.stringify(local.queen()));
console.log('worker records (id-sorted) ->', JSON.stringify(local.state().workers.map((w) => `${w.id}:${w.type}`)));
const rosterSorted = JSON.stringify(created.workers) === JSON.stringify(['worker-alpha', 'worker-bravo', 'worker-charlie']);
verdict('P1', created.queenId === 'queen' && created.workers.length === 3 && rosterSorted && local.queen().type === 'strategist',
  '1 queen (strategist) + 3 workers, roster deterministically ordered by id');

console.log('\n═══════════════════════════════════════════════════');
console.log('P2 — assign tasks -> show assignments');
console.log('═══════════════════════════════════════════════════');
const a1 = local.assign('worker-alpha', { id: 'task-scan', label: 'scan the corpus' });
const a2 = local.assign('worker-bravo', 'build the ingest stage');
const a3 = local.assign('worker-charlie', 'research prior art');
console.log('assign ->', JSON.stringify(a1));
console.log('assign ->', JSON.stringify(a2));
console.log('assign ->', JSON.stringify(a3));
const rUnknown = expectError(() => local.assign('worker-ghost', 'no such worker task'), 'E_UNKNOWN_WORKER');
console.log(`assign to unknown worker -> ${rUnknown.threw ? rUnknown.err.message : 'NO ERROR (bad)'}`);
verdict('P2', a1.taskId === 'task-scan' && a2.taskId === 'task-001' && a3.taskId === 'task-002'
  && a1.status === 'in-flight' && rUnknown.threw,
  '3 assignments recorded (explicit id + deterministic task-001/002); unknown worker -> E_UNKNOWN_WORKER');

console.log('\n═══════════════════════════════════════════════════');
console.log('P3 — workers report results -> collective memory grows');
console.log('═══════════════════════════════════════════════════');
const memBefore = local.memory().length;
const rep1 = local.report('worker-alpha', 'task-scan', { files: 42 });
const rep2 = local.report('worker-bravo', 'task-001', { stage: 'ingest', ok: true });
const memAfter = local.memory().length;
console.log(`memory entries before=${memBefore} after=${memAfter}`);
console.log('memory() ->', JSON.stringify(local.memory()));
console.log('report ->', JSON.stringify(rep1));
console.log('report ->', JSON.stringify(rep2));
verdict('P3', memBefore === 0 && memAfter === 2 && local.memory()[0].result.files === 42
  && rep1.status === 'reported' && rep1.reportCount === 1,
  'each report appends to collective memory (0 -> 2 entries, append-only per task)');

console.log('\n═══════════════════════════════════════════════════');
console.log('P4 — unknown worker type -> E_UNKNOWN_WORKER_TYPE');
console.log('═══════════════════════════════════════════════════');
const r4 = expectError(() => new Hive().create({ queen: { type: 'strategist' }, workers: [{ type: 'wizard' }] }), 'E_UNKNOWN_WORKER_TYPE');
console.log(`create with worker type "wizard" -> ${r4.threw ? r4.err.message : 'NO ERROR (bad)'}`);
const r4q = expectError(() => new Hive().create({ queen: { type: 'empress' }, workers: [] }), 'E_UNKNOWN_QUEEN_TYPE');
console.log(`create with queen type "empress" -> ${r4q.threw ? r4q.err.message : 'NO ERROR (bad)'}`);
verdict('P4', r4.threw && r4q.threw, 'E_UNKNOWN_WORKER_TYPE and E_UNKNOWN_QUEEN_TYPE both raised');

console.log('\n═══════════════════════════════════════════════════');
console.log('P5 — reassign in-flight task -> E_TASK_IN_FLIGHT');
console.log('═══════════════════════════════════════════════════');
const r5 = expectError(() => local.reassign('task-002', 'worker-alpha'), 'E_TASK_IN_FLIGHT');
console.log(`reassign(task-002 [in-flight]) -> ${r5.threw ? r5.err.message : 'NO ERROR (bad)'}`);
const reOK = local.reassign('task-scan', 'worker-charlie');
console.log('reassign(task-scan [reported]) ->', JSON.stringify(reOK));
const doubleReport = expectError(() => local.report('worker-alpha', 'task-scan', { late: true }), 'E_NOT_ASSIGNED');
console.log(`report on reassigned task by old owner -> ${doubleReport.threw ? doubleReport.err.message : 'NO ERROR (bad)'}`);
verdict('P5', r5.threw && reOK.workerId === 'worker-charlie' && reOK.status === 'in-flight' && doubleReport.threw,
  'in-flight reassign refused (E_TASK_IN_FLIGHT); reported task re-dispatches; old owner can no longer report');

console.log('\n═══════════════════════════════════════════════════');
console.log('P6 — determinism (two identical hives -> byte-identical state)');
console.log('═══════════════════════════════════════════════════');
const mk = () => {
  const h = new Hive();
  h.create({
    queen: { type: 'executor' },
    workers: [{ type: 'planner', id: 'w2' }, { type: 'critic', id: 'w1' }],
  });
  h.assign('w1', { id: 'tA', label: 'review plan' });
  h.assign('w2', 'draft plan');
  h.report('w1', 'tA', { verdict: 'approve' });
  return h.state();
};
const s1 = JSON.stringify(mk());
const s2 = JSON.stringify(mk());
console.log(`state bytes: run1=${s1.length}, run2=${s2.length}, identical=${s1 === s2}`);
console.log('state:', s1.slice(0, 220), '...');
verdict('P6', s1 === s2, 'same config + same operations -> byte-identical hive state');
console.log(`\nSCOPE B: ${6 - failures}/6 PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
