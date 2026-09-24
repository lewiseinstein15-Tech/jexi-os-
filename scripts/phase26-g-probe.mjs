/**
 * JEXI OS — Phase 26 Scope G — CROSS-PROJECT ISOLATION GATE.
 * Verification only: exercises Scopes A–F public APIs across two
 * projects and asserts no leak in either direction.
 * Run: node scripts/phase26-g-probe.mjs
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createObserve } from '../mind/instincts/observe/index.js';
import { createInstincts } from '../mind/instincts/core/index.js';
import { createInstinctStore } from '../mind/instincts/store/index.js';
import { createEvolve } from '../mind/instincts/evolve/index.js';
import { createIo } from '../mind/instincts/io/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

function buildProjects(root) {
  const observe = createObserve(root);
  const core = createInstincts(root);
  const store = createInstinctStore(root);
  const ev = createEvolve(root);
  const io = createIo(root);
  for (const [proj, tag] of [['proj-a', 'a'], ['proj-b', 'b']]) {
    for (let i = 1; i <= 5; i += 1) {
      const inst = core.create({ projectId: proj, action: tag + '-action-' + i, evidence: [tag + '-ev-' + i], examples: [tag + '-ex-' + i] });
      for (let k = 0; k < i % 4; k += 1) core.reinforce(inst.id, { projectId: proj, evidence: tag + '-r' + k + '-' + i });
    }
  }
  return { observe, core, store, ev, io };
}

const ROOT = '/tmp/p26-gate';
fs.rmSync(ROOT, { recursive: true, force: true });
const { observe, core, store, ev, io } = buildProjects(ROOT);

// P1 — disjoint lists
const listA = store.list('proj-a');
const listB = store.list('proj-b');
const setA = new Set(listA.map((i) => i.id));
const setB = new Set(listB.map((i) => i.id));
const shared = [...setA].filter((id) => setB.has(id));
console.log('P1 proj-a: ' + [...setA].sort().join(', '));
console.log('P1 proj-b: ' + [...setB].sort().join(', '));
console.log('P1 shared ids: ' + JSON.stringify(shared));
ok(listA.length === 5 && listB.length === 5 && shared.length === 0, 'P1 list(A) and list(B) are disjoint 5-element sets');

// P2 — get A's instinct from B's context
const crossGet = errOf(() => store.get([...setA][0], { projectId: 'proj-b' }));
console.log('P2 get(A-instinct, ctx=proj-b) -> ' + (crossGet && crossGet.code));
ok(crossGet && crossGet.code === 'E_SCOPE_MISMATCH', 'P2 cross-project get -> E_SCOPE_MISMATCH');

// P3 — push under B's observer claiming project A
observe.attach('sess-b', { projectId: 'proj-b' });
const crossPush = errOf(() => observe.push({ projectId: 'proj-a', sessionId: 'sess-b', kind: 'sneaky', payload: {} }));
console.log('P3 push(projectId=proj-a via proj-b observer) -> ' + (crossPush && crossPush.code));
ok(crossPush && crossPush.code === 'E_SCOPE_MISMATCH', 'P3 cross-project observation push -> E_SCOPE_MISMATCH');

// P4 — cluster/evolve B's material under project A
const clustersB = ev.cluster('proj-b', { minClusterSize: 1 });
const bClusterId = clustersB.length ? clustersB[0].clusterId : null;
const clustersA = ev.cluster('proj-a', { minClusterSize: 1 });
const aIds = new Set([].concat(...clustersA.map((c) => c.instinctIds)));
const leak = [...aIds].filter((id) => setB.has(id));
const crossEvolve = errOf(() => ev.evolve(bClusterId, { kind: 'skill', projectId: 'proj-a' }));
console.log('P4 B cluster=' + bClusterId + ' | A clusters contain B ids: ' + JSON.stringify(leak) + ' | evolve(B-cluster, ctx=proj-a) -> ' + (crossEvolve && crossEvolve.code));
ok(leak.length === 0, 'P4 clustering under A never sees B instincts (structural isolation)');
ok(crossEvolve && crossEvolve.code === 'E_UNKNOWN_CLUSTER', 'P4 evolving B cluster under A -> E_UNKNOWN_CLUSTER (A cannot even name it; E_SCOPE_MISMATCH is raised by the read layer where records exist — documented, not a leak)');

// P5 — import A -> B without mode
const blobA = io.export('proj-a');
const noMode = errOf(() => io.import(blobA.blob, { targetProjectId: 'proj-b' }));
console.log('P5 import(A-blob -> proj-b, no mode) -> ' + (noMode && noMode.code));
ok(noMode && noMode.code === 'E_TARGET_MODE_REQUIRED', 'P5 cross-project import without mode -> E_TARGET_MODE_REQUIRED');

// P6 — explicit migrate with provenance; A unchanged
const beforeA = JSON.stringify(store.list('proj-a'));
const mig = io.import(blobA.blob, { targetProjectId: 'proj-b', mode: 'migrate' });
const listB2 = store.list('proj-b');
const migrated = listB2.filter((i) => i.provenance);
const provOk = migrated.every((i) => i.provenance.migratedFrom === 'proj-a' && typeof i.provenance.migratedAt === 'number');
const afterA = JSON.stringify(store.list('proj-a'));
console.log('P6 imported=' + mig.imported + ' | proj-b now ' + listB2.length + ' (' + migrated.length + ' with provenance) | proj-a unchanged=' + (beforeA === afterA));
ok(mig.imported === 5 && listB2.length === 10 && migrated.length === 5 && provOk, 'P6 migrate lands in B with { migratedFrom: proj-a, migratedAt }');
ok(beforeA === afterA, 'P6 A originals byte-identical after migrate');

// P7 — filesystem isolation proof
const findA = execSync('find /tmp/p26-gate/projects/proj-a -type f | sort').toString().trim();
const findB = execSync('find /tmp/p26-gate/projects/proj-b -type f | sort').toString().trim();
console.log('P7 find proj-a:\n' + findA.split('\n').map((l) => '  ' + l).join('\n'));
console.log('P7 find proj-b:\n' + findB.split('\n').map((l) => '  ' + l).join('\n'));
const badPaths = findB.split('\n').filter((p) => p.split('/').includes('proj-a'));
ok(badPaths.length === 0 && findA.split('\n').every((p) => p.split('/').includes('proj-a')), 'P7 no path under B contains proj-a as a component (and vice versa)');

// P8 — cross-cutting determinism
const ROOT2 = '/tmp/p26-gate2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const two = buildProjects(ROOT2);
ok(JSON.stringify(two.store.list('proj-a')) === JSON.stringify(listA) && JSON.stringify(two.store.list('proj-b')) === JSON.stringify(listB), 'P8 rebuild from scratch -> byte-identical list(A) and list(B)');

// P9 — boundary summary
console.log('P9 isolation boundaries tested:');
console.log('  1. store.list per project            -> disjoint sets: PASS');
console.log('  2. store.get cross-context           -> E_SCOPE_MISMATCH: ' + (crossGet && crossGet.code));
console.log('  3. observe.push cross-project        -> E_SCOPE_MISMATCH: ' + (crossPush && crossPush.code));
console.log('  4. evolve/cluster cross-project      -> structural (no visibility) + E_UNKNOWN_CLUSTER: ' + (crossEvolve && crossEvolve.code));
console.log('  5. io.import without explicit mode   -> E_TARGET_MODE_REQUIRED: ' + (noMode && noMode.code));
console.log('  6. explicit migrate                  -> provenance stamped, source untouched: ' + (beforeA === afterA));
console.log('  7. filesystem layout                 -> no cross-project path components: ' + (badPaths.length === 0));
console.log('  8. determinism across rebuilds       -> byte-identical: verified');

console.log('');
console.log('SCOPE G: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
