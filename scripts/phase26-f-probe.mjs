/**
 * JEXI OS — Phase 26 Scope F — live probe for TTL pruning + /prune.
 * Run: node scripts/phase26-f-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createInstincts } from '../instincts/core/index.js';
import { createInstinctStore } from '../instincts/store/index.js';
import { createPruner } from '../instincts/prune/index.js';
import { nextOp, currentOp } from '../instincts/observe/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const TTL = 10;

function buildWaves(root) {
  const core = createInstincts(root);
  const store = createInstinctStore(root);
  const pruner = createPruner(root);
  // wave 1 (will age past TTL): 0.3, 0.4, 0.6
  const a = core.create({ projectId: 'proj-x', action: 'wave1-alpha', evidence: ['a0'], examples: [] });
  let b = core.create({ projectId: 'proj-x', action: 'wave1-beta', evidence: ['b0'], examples: [] });
  let c = core.create({ projectId: 'proj-x', action: 'wave1-gamma', evidence: ['c0'], examples: [] });
  b = core.reinforce(b.id, { projectId: 'proj-x', evidence: 'b1' });                       // 0.4
  c = core.reinforce(c.id, { projectId: 'proj-x', evidence: 'c1' });
  c = core.reinforce(c.id, { projectId: 'proj-x', evidence: 'c2' });                       // 0.5
  c = core.reinforce(c.id, { projectId: 'proj-x', evidence: 'c3' });                       // 0.6
  for (let k = 0; k < 15; k += 1) nextOp(root); // age wave 1 past TTL=10
  // wave 2 (stays fresh): 0.3, 0.4
  const d = core.create({ projectId: 'proj-x', action: 'wave2-delta', evidence: ['d0'], examples: [] });
  let e = core.create({ projectId: 'proj-x', action: 'wave2-eps', evidence: ['e0'], examples: [] });
  e = core.reinforce(e.id, { projectId: 'proj-x', evidence: 'e1' });                       // 0.4
  return { core, store, pruner, ids: { a: a.id, b: b.id, c: c.id, d: d.id, e: e.id } };
}

const ROOT = '/tmp/p26-prune';
fs.rmSync(ROOT, { recursive: true, force: true });
const { core, store, pruner, ids } = buildWaves(ROOT);

// P1 — five instincts spanning below/above 0.5
const cur = currentOp(ROOT);
const all = store.list('proj-x');
console.log('P1 currentOp=' + cur + ' instincts: ' + all.map((i) => i.id + '(conf=' + i.confidence + ',age=' + (cur - i.lastSeenAt) + ')').join(', '));
ok(all.length === 5, 'P1 five instincts saved, confidences span 0.3..0.6');

// P2 — dryRun sees exactly the stale+weak ones
const dry = pruner.dryRun('proj-x', { ttl: TTL, minConfidence: 0.5 });
console.log('P2 would=' + dry.would + ' ids=' + JSON.stringify(dry.ids));
console.log('P2 details: ' + dry.details.map((d) => d.id + '(age=' + d.age + ',conf=' + d.confidence + ')').join(', '));
ok(dry.would === 2 && dry.ids.join() === [ids.a, ids.b].sort().join(), 'P2 dryRun targets only stale(age>10) AND weak(conf<0.5)');

// P3 — run removes them; survivors fail exactly one condition each
const ran = pruner.run('proj-x', { ttl: TTL, minConfidence: 0.5 });
const after = store.list('proj-x');
console.log('P3 pruned=' + ran.pruned + ' ids=' + JSON.stringify(ran.ids) + ' | survivors: ' + after.map((i) => i.id + '(conf=' + i.confidence + ')').join(', '));
ok(ran.pruned === 2 && ran.ids.join() === [ids.a, ids.b].sort().join(), 'P3 run pruned exactly the two');
ok(after.length === 3 && after.some((i) => i.id === ids.c) && after.some((i) => i.id === ids.d) && after.some((i) => i.id === ids.e), 'P3 survivors: c (conf>=0.5), d+e (age<=ttl)');

// P4 — dryRun twice identical; run twice -> second is 0
const dry2a = pruner.dryRun('proj-x', { ttl: TTL, minConfidence: 0.5 });
const dry2b = pruner.dryRun('proj-x', { ttl: TTL, minConfidence: 0.5 });
const ran2 = pruner.run('proj-x', { ttl: TTL, minConfidence: 0.5 });
console.log('P4 dryRun twice identical=' + (JSON.stringify(dry2a) === JSON.stringify(dry2b)) + ' | second run pruned=' + ran2.pruned);
ok(JSON.stringify(dry2a) === JSON.stringify(dry2b), 'P4 dryRun twice -> identical output');
ok(ran2.pruned === 0, 'P4 run is idempotent (second run prunes 0)');

// P5 — scope: unknown project -> empty (DECLARED); tampered record -> E_SCOPE_MISMATCH
const unknown = pruner.run('proj-none', { ttl: TTL, minConfidence: 0.5 });
console.log('P5 unknown project -> ' + JSON.stringify(unknown) + ' (DECLARED: empty result)');
ok(unknown.pruned === 0 && unknown.ids.length === 0, 'P5 unknown project -> empty result (declared behavior)');
const zdir = path.join(ROOT, 'projects', 'proj-z', 'instincts');
fs.mkdirSync(zdir, { recursive: true });
fs.writeFileSync(path.join(zdir, 'tampered.json'), JSON.stringify({ id: 'tampered', projectId: 'proj-x', action: 'x', evidence: [], examples: [], confidence: 0.1, firstSeenAt: 0, lastSeenAt: 0, reinforceCount: 0, contradictCount: 0 }) + '\n');
const tampered = errOf(() => pruner.run('proj-z', { ttl: TTL, minConfidence: 0.5 }));
ok(tampered && tampered.code === 'E_SCOPE_MISMATCH', 'P5 foreign record inside proj-z -> E_SCOPE_MISMATCH');
ok(store.list('proj-x').length === 3, 'P5 proj-x untouched by proj-z operations');

// P6 — determinism: same sequence on a fresh root -> byte-identical ids
const ROOT2 = '/tmp/p26-prune2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const two = buildWaves(ROOT2);
const dryR2 = two.pruner.dryRun('proj-x', { ttl: TTL, minConfidence: 0.5 });
const ranR2 = two.pruner.run('proj-x', { ttl: TTL, minConfidence: 0.5 });
ok(JSON.stringify(ranR2.ids) === JSON.stringify(ran.ids) && JSON.stringify(dryR2.ids) === JSON.stringify(dry.ids), 'P6 same sequence -> byte-identical pruned ids');

console.log('');
console.log('SCOPE F: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
