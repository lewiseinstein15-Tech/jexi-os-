#!/usr/bin/env node
/**
 * JEXI OS — Phase 20 Scope A — LIVE PROBES P1–P5 (swarm topologies).
 *
 * Raw output only. Run: node scripts/phase20-scope-a.mjs
 * Exit 0 = all pass, 1 = any fail.
 */
import topologies from '../swarm/topologies/index.js';
import { SwarmError } from '../swarm/topologies/_internal.js';

const MEMBERS = ['agent-alpha', 'agent-bravo', 'agent-charlie', 'agent-delta', 'agent-echo'];
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
console.log('P1 — build each of the 6 topologies with 5 members');
console.log('═══════════════════════════════════════════════════');
const types = topologies.list();
console.log('list():', JSON.stringify(types));
const built = {};
for (const t of types) {
  built[t] = topologies.build(t, MEMBERS);
  const strategy = built[t].strategy ? ` (strategy: ${built[t].strategy})` : '';
  console.log(`${t}: edges=${built[t].edges.length}${strategy}`);
  console.log(`  edges: ${JSON.stringify(built[t].edges.map((e) => `${e.from}>${e.to}[${e.role}]`))}`);
}
verdict('P1', built.hierarchical.edges.length === 4
  && built.mesh.edges.length === 10
  && built.ring.edges.length === 5
  && built.star.edges.length === 4
  && built['hierarchical-mesh'].edges.length === 5
  && built.adaptive.edges.length === 4 && built.adaptive.strategy === 'hierarchical',
  'hierarchical=4, mesh=10 pairs (20 directed traversals), ring=5, star=4, hierarchical-mesh=5 (2 cluster meshes + 1 head mesh), adaptive->hierarchical=4');

console.log('\n═══════════════════════════════════════════════════');
console.log('P2 — route(from, to) on each topology');
console.log('═══════════════════════════════════════════════════');
const routeChecks = [
  ['hierarchical', 'agent-charlie', 'agent-echo'],
  ['mesh', 'agent-bravo', 'agent-delta'],
  ['ring', 'agent-alpha', 'agent-charlie'],
  ['star', 'agent-bravo', 'agent-delta'],
  ['hierarchical-mesh', 'agent-bravo', 'agent-echo'],
  ['adaptive', 'agent-charlie', 'agent-echo'],
];
let p2ok = true;
for (const [t, from, to] of routeChecks) {
  const path = built[t].route(from, to);
  console.log(`route(${t}): ${from} -> ${to} = ${JSON.stringify(path)}`);
  if (!Array.isArray(path) || path[0] !== from || path[path.length - 1] !== to) p2ok = false;
}
const null1 = built.hierarchical.route('agent-alpha', 'agent-nonexistent');
const null2 = built.ring.route('stranger', 'agent-alpha');
console.log(`route to unknown member: ${JSON.stringify(null1)}, from unknown member: ${JSON.stringify(null2)}`);
if (null1 !== null || null2 !== null) p2ok = false;
verdict('P2', p2ok, 'real paths on every topology (both endpoints on the path); unknown endpoints route to null, never a fake path');

console.log('\n═══════════════════════════════════════════════════');
console.log('P3 — unknown type -> E_UNKNOWN_TOPOLOGY');
console.log('═══════════════════════════════════════════════════');
const r3 = expectError(() => topologies.build('constellation', MEMBERS), 'E_UNKNOWN_TOPOLOGY');
console.log(`build('constellation', 5 members) -> ${r3.threw ? r3.err.message : 'NO ERROR (bad)'}`);
verdict('P3', r3.threw, 'E_UNKNOWN_TOPOLOGY raised for an unregistered topology type');

console.log('\n═══════════════════════════════════════════════════');
console.log('P4 — fewer than 2 members -> E_TOO_FEW_MEMBERS');
console.log('═══════════════════════════════════════════════════');
const r4a = expectError(() => topologies.build('mesh', ['agent-solo']), 'E_TOO_FEW_MEMBERS');
const r4b = expectError(() => topologies.build('ring', []), 'E_TOO_FEW_MEMBERS');
console.log(`build('mesh', ['agent-solo']) -> ${r4a.threw ? r4a.err.message : 'NO ERROR (bad)'}`);
console.log(`build('ring', []) -> ${r4b.threw ? r4b.err.message : 'NO ERROR (bad)'}`);
verdict('P4', r4a.threw && r4b.threw, 'E_TOO_FEW_MEMBERS raised for 1 member and for the empty list');

console.log('\n═══════════════════════════════════════════════════');
console.log('P5 — determinism: same members twice -> byte-identical edges');
console.log('═══════════════════════════════════════════════════');
let p5ok = true;
for (const t of types) {
  const a = topologies.build(t, MEMBERS);
  const b = topologies.build(t, MEMBERS);
  const ea = JSON.stringify(a.edges);
  const eb = JSON.stringify(b.edges);
  const ra = JSON.stringify([a.route('agent-alpha', 'agent-echo'), a.route('agent-echo', 'agent-alpha')]);
  const rb = JSON.stringify([b.route('agent-alpha', 'agent-echo'), b.route('agent-echo', 'agent-alpha')]);
  console.log(`${t}: edges sha256-identical=${ea === eb} (${ea.length} bytes), routes identical=${ra === rb}`);
  if (ea !== eb || ra !== rb) p5ok = false;
}
const meshT = topologies.build('mesh', MEMBERS);
const validateOk = topologies.validate(meshT);
console.log(`validate(build('mesh', 5)) -> ${JSON.stringify(validateOk)}`);
const tampered = topologies.build('star', MEMBERS);
tampered.edges = [...tampered.edges, { from: 'agent-alpha', to: 'agent-alpha', role: 'fake' }];
const validateBad = topologies.validate(tampered);
console.log(`validate(tampered star with self-loop) -> valid=${validateBad.valid}, errors=${JSON.stringify(validateBad.errors)}`);
verdict('P5', p5ok && validateOk.valid === true && validateBad.valid === false, 'byte-identical edges and routes across rebuilds; validate() accepts a real topology and rejects a tampered one');

console.log(`\nSCOPE A: ${5 - failures}/5 PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
