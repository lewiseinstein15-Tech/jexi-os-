#!/usr/bin/env node
/**
 * JEXI OS — Phase 20 Scope E — LIVE PROBES P1–P5 (clotho).
 *
 * Raw output only. Run: node scripts/phase20-scope-e.mjs
 * Exit 0 = all pass, 1 = any fail.
 */
import clotho, { createClotho, Clotho } from '../swarm/loops/clotho.js';
import { SwarmError } from '../swarm/topologies/_internal.js';

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
console.log('P1 — spin a task into 3 fibers');
console.log('═══════════════════════════════════════════════════');
const c1 = createClotho();
const spun = c1.spin('build-api', { fibers: ['design schema', 'implement routes', 'write tests'] });
console.log('spin ->', JSON.stringify(spun));
console.log('statuses ->', JSON.stringify(spun.subTasks.map((s) => ({ id: s.fiberId, ...c1.status(s.fiberId) }))));
const r1empty = expectError(() => c1.spin('empty-task', { fibers: [] }), 'E_NO_FIBERS');
console.log(`spin with 0 fibers -> ${r1empty.threw ? r1empty.err.message : 'NO ERROR (bad)'}`);
verdict('P1', spun.subTasks.length === 3 && spun.fiberId === 'fiber-001'
  && spun.subTasks.map((s) => s.fiberId).join(',') === 'fiber-001,fiber-002,fiber-003'
  && c1.status('fiber-001').state === 'spun' && r1empty.threw,
  '3 fibers spun with deterministic ids fiber-001..003; empty spin -> E_NO_FIBERS');

console.log('\n═══════════════════════════════════════════════════');
console.log('P2 — weave with all 3 complete -> merged in FIBER order');
console.log('═══════════════════════════════════════════════════');
// Complete in a NON-spin order: routes first, tests second, schema LAST.
c1.complete('fiber-003', { tests: 12 });
c1.complete('fiber-001', { tables: ['users', 'sessions'] });
c1.complete('fiber-002', { routes: 5 });
console.log('completed in order: fiber-003, fiber-001, fiber-002 (completion != spin order)');
const woven = c1.weave(['fiber-003', 'fiber-001', 'fiber-002']);
console.log('weave ->', JSON.stringify(woven));
const order = woven.contributions.map((c) => c.fiberId).join(',');
verdict('P2', woven.woven === true && woven.contributions.length === 3
  && order === 'fiber-001,fiber-002,fiber-003'
  && woven.contributions[0].output.tables.length === 2,
  'woven in FIBER order (001,002,003) despite completion order 003,001,002');

console.log('\n═══════════════════════════════════════════════════');
console.log('P3 — fail one fiber -> weave returns { woven: false }');
console.log('═══════════════════════════════════════════════════');
const c2 = createClotho();
const spun2 = c2.spin('migrate-db', { fibers: 3 });
c2.complete('fiber-001', { ok: 1 });
c2.fail('fiber-002', 'schema conflict on table users');
c2.complete('fiber-003', { ok: 3 });
const refused = c2.weave(['fiber-001', 'fiber-002', 'fiber-003']);
console.log('weave ->', JSON.stringify(refused));
verdict('P3', refused.woven === false && refused.reason === 'schema conflict on table users' && refused.failedFiber === 'fiber-002',
  'one failed fiber refuses the whole weave with its reason and id — no partial merge');

console.log('\n═══════════════════════════════════════════════════');
console.log('P4 — weave errors: unknown fiber, empty list, incomplete fiber');
console.log('═══════════════════════════════════════════════════');
const r4a = expectError(() => c2.weave(['fiber-999']), 'E_UNKNOWN_FIBER');
const r4b = expectError(() => c2.weave([]), 'E_NO_FIBERS');
const c3 = createClotho();
c3.spin('partial', { fibers: 2 });
c3.complete('fiber-001', { done: true });
const r4c = expectError(() => c3.weave(['fiber-001', 'fiber-002']), 'E_FIBER_INCOMPLETE');
const r4d = expectError(() => c3.status('fiber-777'), 'E_UNKNOWN_FIBER');
console.log(`weave(['fiber-999']) -> ${r4a.threw ? r4a.err.message : 'NO ERROR (bad)'}`);
console.log(`weave([]) -> ${r4b.threw ? r4b.err.message : 'NO ERROR (bad)'}`);
console.log(`weave with spun fiber-002 -> ${r4c.threw ? r4c.err.message : 'NO ERROR (bad)'}`);
console.log(`status('fiber-777') -> ${r4d.threw ? r4d.err.message : 'NO ERROR (bad)'}`);
verdict('P4', r4a.threw && r4b.threw && r4c.threw && r4d.threw,
  'E_UNKNOWN_FIBER, E_NO_FIBERS, E_FIBER_INCOMPLETE all raised; status() refuses unknown ids');

console.log('\n═══════════════════════════════════════════════════');
console.log('P5 — determinism: identical ops on fresh clothos -> identical bytes');
console.log('═══════════════════════════════════════════════════');
const mk = () => {
  const c = createClotho();
  const s = c.spin('ship-docs', { fibers: ['outline', 'draft', 'review'] });
  c.complete('fiber-002', { words: 900 });
  c.complete('fiber-001', { sections: 4 });
  c.complete('fiber-003', { reviewed: true });
  const w = c.weave(['fiber-003', 'fiber-001', 'fiber-002']);
  return JSON.stringify({ s, w });
};
const s1 = mk();
const s2 = mk();
console.log(`bytes: run1=${s1.length} run2=${s2.length} identical=${s1 === s2}`);
console.log('run:', s1);
verdict('P5', s1 === s2, 'byte-identical spin + weave across independent clotho instances');

console.log(`\nSCOPE E: ${5 - failures}/5 PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
