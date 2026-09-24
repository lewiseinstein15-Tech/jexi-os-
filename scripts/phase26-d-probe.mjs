/**
 * JEXI OS — Phase 26 Scope D — live probe for /evolve clustering.
 * Run: node scripts/phase26-d-probe.mjs
 */
import fs from 'node:fs';
import { createInstincts } from '../mind/instincts/core/index.js';
import { createEvolve } from '../mind/instincts/evolve/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

function buildRelated(root) {
  const core = createInstincts(root);
  const ev = createEvolve(root);
  const actions = ['deploy-check-tests', 'deploy-check-lint', 'deploy-check-types', 'deploy-check-audit', 'deploy-check-smoke'];
  for (const action of actions) {
    const inst = core.create({ projectId: 'proj-x', action, evidence: ['obs-' + action], examples: [action + ' example'] });
    for (let k = 0; k < 3; k += 1) core.reinforce(inst.id, { projectId: 'proj-x', evidence: 'r' + k + '-' + action }); // -> 0.6
  }
  return { core, ev };
}

const ROOT = '/tmp/p26-evolve';
fs.rmSync(ROOT, { recursive: true, force: true });
const { core, ev } = buildRelated(ROOT);

// P1 — 5 related instincts -> 1 cluster of size 5
const clusters = ev.cluster('proj-x');
const big = clusters[0];
console.log('P1 clusters=' + clusters.length + ' | clusterId=' + (big && big.clusterId));
console.log('P1 shape: ' + JSON.stringify(big));
ok(clusters.length === 1 && big.size === 5 && big.sharedPrefix === 'deploy-check-', 'P1 one cluster of size 5 with shared prefix');

// P2 — 2 unrelated instincts -> no new cluster
for (const action of ['zzz-unrelated-one', 'qqq-unrelated-two']) {
  const inst = core.create({ projectId: 'proj-x', action, evidence: ['u-' + action], examples: [] });
  for (let k = 0; k < 3; k += 1) core.reinforce(inst.id, { projectId: 'proj-x', evidence: 'ur' + k + '-' + action });
}
const clusters2 = ev.cluster('proj-x');
ok(clusters2.length === 1 && clusters2[0].size === 5, 'P2 unrelated singletons form no cluster');
// a prefix-related PAIR (audit-run-*) stays below the default minClusterSize
for (const action of ['audit-run-fast', 'audit-run-slow']) {
  const inst = core.create({ projectId: 'proj-x', action, evidence: ['p-' + action], examples: [] });
  for (let k = 0; k < 3; k += 1) core.reinforce(inst.id, { projectId: 'proj-x', evidence: 'pr' + k + '-' + action });
}
const withPairs = ev.cluster('proj-x', { minClusterSize: 2 });
const pair = withPairs.find((c) => c.size === 2);
console.log('P2 minClusterSize=2 -> clusters: ' + withPairs.map((c) => c.size).join(',') + ' | pair=' + (pair && pair.clusterId));
ok(withPairs.length === 2 && pair && pair.size === 2, 'P2 pair visible only when minClusterSize=2');

// P3 — evolve the big cluster into a skill
const evolved = ev.evolve(big.clusterId, { kind: 'skill', projectId: 'proj-x' });
console.log('P3 artifact: ' + JSON.stringify(evolved.artifact, null, 2));
ok(evolved.artifact.kind === 'skill' && evolved.artifact.instinctIds.length === 5 && evolved.artifact.action === 'deploy-check-' && typeof evolved.artifact.generatedAt === 'number', 'P3 artifact emitted with full shape');

// P4 — errors
const below = errOf(() => ev.evolve(pair.clusterId, { kind: 'command', projectId: 'proj-x' }));
const dbl = errOf(() => ev.evolve(big.clusterId, { kind: 'command', projectId: 'proj-x' }));
const unk = errOf(() => ev.evolve('cluster-0000000000000000', { kind: 'skill', projectId: 'proj-x' }));
const badKind = errOf(() => ev.evolve(big.clusterId, { kind: 'wizard', projectId: 'proj-x' }));
console.log('P4 below=' + (below && below.code) + ' double=' + (dbl && dbl.code) + ' unknown=' + (unk && unk.code) + ' kind=' + (badKind && badKind.code));
ok(below && below.code === 'E_CLUSTER_BELOW_THRESHOLD', 'P4 small cluster -> E_CLUSTER_BELOW_THRESHOLD');
ok(dbl && dbl.code === 'E_ALREADY_EVOLVED', 'P4 double evolve -> E_ALREADY_EVOLVED');
ok(unk && unk.code === 'E_UNKNOWN_CLUSTER', 'P4 unknown cluster -> E_UNKNOWN_CLUSTER');
ok(badKind && badKind.code === 'E_UNKNOWN_KIND', 'P4 unknown kind -> E_UNKNOWN_KIND');

// P5 — determinism: same FULL sequence (including op-seq history) on a fresh root
const ROOT2 = '/tmp/p26-evolve2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const two = buildRelated(ROOT2);
for (const action of ['zzz-unrelated-one', 'qqq-unrelated-two']) {
  const inst = two.core.create({ projectId: 'proj-x', action, evidence: ['u-' + action], examples: [] });
  for (let k = 0; k < 3; k += 1) two.core.reinforce(inst.id, { projectId: 'proj-x', evidence: 'ur' + k + '-' + action });
}
for (const action of ['audit-run-fast', 'audit-run-slow']) {
  const inst = two.core.create({ projectId: 'proj-x', action, evidence: ['p-' + action], examples: [] });
  for (let k = 0; k < 3; k += 1) two.core.reinforce(inst.id, { projectId: 'proj-x', evidence: 'pr' + k + '-' + action });
}
const c2 = two.ev.cluster('proj-x')[0];
const e2 = two.ev.evolve(c2.clusterId, { kind: 'skill', projectId: 'proj-x' });
ok(c2.clusterId === big.clusterId && JSON.stringify(c2) === JSON.stringify(big), 'P5 same instincts -> byte-identical cluster');
ok(JSON.stringify(e2.artifact) === JSON.stringify(evolved.artifact), 'P5 same evolve -> byte-identical artifact (generatedAt included: ' + e2.artifact.generatedAt + ' == ' + evolved.artifact.generatedAt + ')');

console.log('');
console.log('SCOPE D: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
