#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE D — IDENTITY GRAPH — LIVE PROBE.
 *
 *   node scripts/phase13-scope-d.mjs
 *
 *   P1 create 5 identities, including a duplicate-name pair -> two nodes
 *   P2 resolve by alias -> correct DID
 *   P3 merge the duplicate pair -> survivor, aliases, before/after resolve
 *   P4 merge creating a cycle -> E_CYCLE
 *   P5 E_UNKNOWN_IDENTITY, E_DUPLICATE_AGENT
 *   P6 persistence: reload from disk -> same graph
 *   P7 determinism: two builds -> byte-identical graph()
 *   P8 the 12 duplicate-name pairs: what does the graph say
 *   P9 zone check on git status
 *
 * All graphs here use a temp stateDir; nothing is written into the repo's
 * workforce/identity/state during the probe.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  createIdentityGraph, toDid, isDid, parseDid, agentIdFromDid, DID_PREFIX,
  resolveName, duplicateNames, duplicateReport, seedFromRoster,
} from '../agents/workforce/identity/index.js';
import { createRegistry } from '../agents/workforce/agents/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);
const caught = (fn) => { try { return { value: fn() }; } catch (e) { return { error: e }; } };
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `p13d-${tag}-`));

/** The five P1 identities. Two of them are the roster's real 'ui designer' pair. */
const FIVE = [
  { id: 'ui-designer', name: 'UI Designer' },
  { id: 'design-ui-designer', name: 'UI Designer' },
  { id: 'engineering-frontend-developer', name: 'Frontend Developer' },
  { id: 'research', name: 'Researcher' },
  { id: 'product-trend-researcher', name: 'Trend Researcher' },
];

head('P1 create 5 identities (one a known duplicate-name pair)');
const d1 = tmpdir('p1');
const g1 = createIdentityGraph({ stateDir: d1 });
const created = FIVE.map((a) => ({ ...a, ...g1.create(a) }));
for (const c of created) {
  console.log(`  ${c.id.padEnd(32)} -> ${c.did}`);
}
console.log('nodes:', g1.graph().nodes.length, ' edges:', g1.graph().edges.length);
if (created.every((c) => c.did === DID_PREFIX + c.id)) ok('P1a every DID is did:jexi:<agentId> (deterministic, no suffix)');
else no('P1a DID format wrong');
const n1 = g1.graph().nodes;
if (n1.length === 5 && n1.every((n) => n.status === 'active' && n.mergedInto === null)) ok('P1b 5 separate active nodes — the duplicate-name pair does NOT auto-collapse');
else no(`P1b expected 5 active nodes, got ${JSON.stringify(n1.map((n) => [n.did, n.status]))}`);
const pair = n1.filter((n) => n.aliases.includes('UI Designer')).map((n) => n.did).sort();
console.log('nodes holding the alias "UI Designer":', JSON.stringify(pair));
if (pair.length === 2) ok('P1c both duplicate-name agents exist as distinct nodes');
else no(`P1c expected 2 nodes for "UI Designer", got ${pair.length}`);
console.log('DID round-trip: parseDid(toDid("ui-designer")) ->', JSON.stringify(parseDid(toDid('ui-designer'))));
console.log('isDid/toDid agreement:', isDid(toDid('ui-designer')), agentIdFromDid(toDid('ui-designer')));

head('P2 resolve by alias');
const amb2 = caught(() => g1.resolve('UI Designer'));
console.log('resolve("UI Designer") ->', amb2.error ? amb2.error.code : JSON.stringify(amb2.value));
const r2b = g1.resolve('Frontend Developer');
console.log('resolve("Frontend Developer") ->', JSON.stringify(r2b));
const r2c = g1.resolve('engineering-frontend-developer');
console.log('resolve("engineering-frontend-developer") (agentId) ->', JSON.stringify(r2c));
const r2d = g1.resolve('did:jexi:research');
console.log('resolve("did:jexi:research") (DID) ->', JSON.stringify(r2d));
if (r2b.agentId === 'engineering-frontend-developer') ok('P2a display-name alias resolves to the right DID');
else no(`P2a got ${JSON.stringify(r2b)}`);
if (r2c.agentId === 'engineering-frontend-developer') ok('P2b agentId resolves to the right DID');
else no(`P2b got ${JSON.stringify(r2c)}`);
if (r2d.agentId === 'research') ok('P2c DID resolves to itself');
else no(`P2c got ${JSON.stringify(r2d)}`);

if (amb2.error && amb2.error.code === 'E_AMBIGUOUS_IDENTITY') {
  ok('P2d ambiguous alias is refused, candidates listed');
  console.log('   candidates:', JSON.stringify(amb2.error.candidates));
} else no(`P2d expected E_AMBIGUOUS_IDENTITY, got ${amb2.error && amb2.error.code}`);

head('P3 merge the duplicate-name pair');
console.log('BEFORE:');
const before = g1.graph().nodes.filter((n) => n.aliases.includes('UI Designer'));
for (const n of before) console.log(`  ${n.did}  status=${n.status} root=${n.root} seq=${n.seq}`);
for (const probe of ['UI Designer', 'ui-designer', 'design-ui-designer', 'did:jexi:design-ui-designer']) {
  const r = caught(() => g1.resolve(probe));
  console.log(`  resolve(${JSON.stringify(probe)}) -> ${r.error ? r.error.code : r.value.did + ' (from ' + r.value.resolvedFrom + ')'}`);
}
const mg = g1.merge('did:jexi:ui-designer', 'did:jexi:design-ui-designer');
console.log('merge ->', JSON.stringify({ merged: mg.merged, survivor: mg.survivor, absorbed: mg.absorbed, seq: mg.seq }));
console.log('aliases after merge:', JSON.stringify(mg.aliases));
console.log('AFTER:');
for (const n of g1.graph().nodes.filter((n) => n.did === 'did:jexi:ui-designer' || n.did === 'did:jexi:design-ui-designer')) {
  console.log(`  ${n.did}  status=${n.status} root=${n.root} aliases=${JSON.stringify(n.aliases)}`);
}
for (const probe of ['UI Designer', 'ui-designer', 'design-ui-designer', 'did:jexi:design-ui-designer']) {
  const r = caught(() => g1.resolve(probe));
  console.log(`  resolve(${JSON.stringify(probe)}) -> ${r.error ? r.error.code : r.value.did + ' (from ' + (r.value.resolvedFrom || 'alias') + ')'}`);
}
console.log('edges:', JSON.stringify(g1.graph().edges));
if (mg.survivor.did === 'did:jexi:ui-designer') ok('P3a survivor is the older DID by op-seq (ui-designer created first)');
else no(`P3a survivor was ${mg.survivor.did}`);
if (mg.aliases.includes('UI Designer') && mg.aliases.includes('design-ui-designer') && mg.aliases.includes('ui-designer')) ok('P3b absorbed aliases folded into survivor');
else no(`P3b aliases: ${JSON.stringify(mg.aliases)}`);
const r3a = g1.resolve('UI Designer');
if (r3a.did === 'did:jexi:ui-designer') ok('P3c the shared alias now resolves unambiguously to the survivor');
else no(`P3c got ${JSON.stringify(r3a)}`);
const r3b = g1.resolve('design-ui-designer');
if (r3b.did === 'did:jexi:ui-designer' && r3b.resolvedFrom === 'did:jexi:design-ui-designer') ok('P3d absorbed agentId resolves to survivor, resolvedFrom records the request');
else no(`P3d got ${JSON.stringify(r3b)}`);
const r3c = g1.resolve('did:jexi:design-ui-designer');
if (r3c.did === 'did:jexi:ui-designer') ok('P3e absorbed DID resolves to survivor');
else no(`P3e got ${JSON.stringify(r3c)}`);
const al3 = g1.aliases('did:jexi:ui-designer');
console.log('aliases("did:jexi:ui-designer") ->', JSON.stringify(al3));
if (JSON.stringify(al3) === JSON.stringify(mg.aliases)) ok('P3f merge result and aliases() agree');
else no('P3f merge result and aliases() disagree');
const absorbedNode = g1.graph().nodes.find((n) => n.did === 'did:jexi:design-ui-designer');
if (absorbedNode.status === 'merged' && absorbedNode.root === 'did:jexi:ui-designer') ok('P3g absorbed node is retained with status=merged and root=survivor');
else no(`P3g absorbed node: ${JSON.stringify(absorbedNode)}`);

head('P4 merge that would create a cycle -> E_CYCLE');
const c4a = caught(() => g1.merge('did:jexi:ui-designer', 'did:jexi:design-ui-designer'));
console.log('re-merge of already-merged pair ->', c4a.error && `${c4a.error.code}: ${c4a.error.message}`);
if (c4a.error && c4a.error.code === 'E_CYCLE') ok('P4a redundant merge refused with E_CYCLE');
else no(`P4a got ${c4a.error && c4a.error.code}`);
const d4 = tmpdir('p4');
const g4 = createIdentityGraph({ stateDir: d4 });
g4.create({ id: 'a', name: 'A' }); g4.create({ id: 'b', name: 'B' }); g4.create({ id: 'c', name: 'C' });
const c4chain = g4.merge('did:jexi:a', 'did:jexi:b');
console.log('merge(a, b) -> survivor', c4chain.survivor.did, '(a is oldest by seq)');
const c4chain2 = g4.merge('did:jexi:a', 'did:jexi:c');
console.log('merge(a, c) -> survivor', c4chain2.survivor.did, 'absorbed', c4chain2.absorbed.did);
console.log('roots now: a->', g4.graph().nodes.find((n) => n.did === 'did:jexi:a').root,
  ' b->', g4.graph().nodes.find((n) => n.did === 'did:jexi:b').root,
  ' c->', g4.graph().nodes.find((n) => n.did === 'did:jexi:c').root);
const c4b = caught(() => g4.merge('did:jexi:c', 'did:jexi:b'));
console.log('merge(c, b) where both are already absorbed into a ->', c4b.error ? `${c4b.error.code}: ${c4b.error.message}` : JSON.stringify(c4b.value));
if (c4b.error && c4b.error.code === 'E_CYCLE') ok('P4b merge of two DIDs that already share a root refused with E_CYCLE');
else no(`P4b got ${c4b.error ? c4b.error.code : 'no throw'}`);
const c4c = caught(() => g4.merge('did:jexi:a', 'did:jexi:d'));
if (c4c.error && c4c.error.code === 'E_UNKNOWN_IDENTITY') ok('P4c a merge naming an unknown DID still reports E_UNKNOWN_IDENTITY, not E_CYCLE');
else no(`P4c got ${c4c.error && c4c.error.code}`);
const c4d = caught(() => g4.resolve('did:jexi:b'));
if (!c4d.error && c4d.value.did === 'did:jexi:a') ok('P4d no cycle was recorded: both absorbed DIDs still resolve to the survivor');
else no(`P4d got ${JSON.stringify(c4d.error ? c4d.error.code : c4d.value)}`);

head('P5 errors: E_UNKNOWN_IDENTITY, E_DUPLICATE_AGENT');
const c5a = caught(() => g1.resolve('nobody-by-this-name'));
console.log('resolve unknown ->', c5a.error && `${c5a.error.code}: ${c5a.error.message}`);
if (c5a.error && c5a.error.code === 'E_UNKNOWN_IDENTITY') ok('P5a E_UNKNOWN_IDENTITY on an unknown name');
else no(`P5a got ${c5a.error && c5a.error.code}`);
const c5b = caught(() => g1.resolve('did:jexi:never-created'));
console.log('resolve unknown DID ->', c5b.error && `${c5b.error.code}: ${c5b.error.message}`);
if (c5b.error && c5b.error.code === 'E_UNKNOWN_IDENTITY') ok('P5b E_UNKNOWN_IDENTITY on an unknown DID');
else no(`P5b got ${c5b.error && c5b.error.code}`);
const c5c = caught(() => g1.create(FIVE[0]));
console.log('create existing ->', c5c.error && `${c5c.error.code}`);
if (c5c.error && c5c.error.code === 'E_DUPLICATE_AGENT') ok('P5c E_DUPLICATE_AGENT on re-creating an existing agentId');
else no(`P5c got ${c5c.error && c5c.error.code}`);
const c5d = caught(() => g1.create({ id: 'design-ui-designer' }));
console.log('create an absorbed agentId ->', c5d.error && `${c5d.error.code}`);
if (c5d.error && c5d.error.code === 'E_DUPLICATE_AGENT') ok('P5d E_DUPLICATE_AGENT on a merge-absorbed agentId (no identity fork)');
else no(`P5d got ${c5d.error && c5d.error.code}`);
const c5e = caught(() => g1.merge('did:jexi:ui-designer', 'did:jexi:ghost'));
console.log('merge unknown ->', c5e.error && `${c5e.error.code}`);
if (c5e.error && c5e.error.code === 'E_UNKNOWN_IDENTITY') ok('P5e E_UNKNOWN_IDENTITY on merging an unknown DID');
else no(`P5e got ${c5e.error && c5e.error.code}`);
const c5f = caught(() => g4.merge('did:jexi:a', 'did:jexi:a'));
console.log('self-merge ->', c5f.error && `${c5f.error.code}`);
if (c5f.error && c5f.error.code === 'E_CYCLE') ok('P5f self-merge refused with E_CYCLE');
else no(`P5f got ${c5f.error && c5f.error.code}`);

head('P6 persistence: reload from disk -> same graph');
const d6 = tmpdir('p6');
const g6a = createIdentityGraph({ stateDir: d6 });
for (const a of FIVE) g6a.create(a);
g6a.create({ id: 'code-reviewer', name: 'Code Reviewer' });
g6a.create({ id: 'engineering-code-reviewer', name: 'Code Reviewer' });
g6a.merge('did:jexi:code-reviewer', 'did:jexi:engineering-code-reviewer');
const snap1 = JSON.stringify(g6a.graph());
console.log('seq file:', JSON.stringify(fs.readFileSync(path.join(d6, 'identity-seq.txt'), 'utf8')));
console.log('state files:', fs.readdirSync(d6).sort().join(', '));
const g6b = createIdentityGraph({ stateDir: d6 });
const loaded = g6b.load();
const snap2 = JSON.stringify(loaded);
console.log('nodes before/after:', g6a.graph().nodes.length, '/', loaded.nodes.length);
console.log('stats before:', JSON.stringify(g6a.stats()));
console.log('stats after: ', JSON.stringify(g6b.stats()));
if (snap1 === snap2) ok('P6a reloaded graph() is byte-identical to the pre-reload graph()');
else no('P6a reloaded graph differs');
const r6 = g6b.resolve('Code Reviewer');
if (r6.did === 'did:jexi:code-reviewer') ok('P6b the merged alias still resolves after reload');
else no(`P6b got ${JSON.stringify(r6)}`);
const r6b = g6b.resolve('engineering-code-reviewer');
if (r6b.did === 'did:jexi:code-reviewer') ok('P6c the absorbed agentId still resolves after reload');
else no(`P6c got ${JSON.stringify(r6b)}`);
const d6b = g6b.create({ id: 'brand-new-agent', name: 'Brand New' });
console.log('create after reload ->', JSON.stringify(d6b), 'seq now', g6b.stats().seq);
if (d6b.did === 'did:jexi:brand-new-agent') ok('P6d create after reload continues the persisted counter');
else no('P6d create after reload failed');
const g6c = createIdentityGraph({ stateDir: d6 });
g6c.load();
if (g6c.stats().seq === g6b.stats().seq) ok('P6e the continued counter itself persists');
else no(`P6e seq drift: ${g6c.stats().seq} vs ${g6b.stats().seq}`);

head('P7 determinism: two builds -> byte-identical graph()');
const buildA = (() => {
  const d = tmpdir('p7a');
  const g = createIdentityGraph({ stateDir: d });
  for (const a of FIVE) g.create(a);
  g.create({ id: 'code-reviewer', name: 'Code Reviewer' });
  g.create({ id: 'engineering-code-reviewer', name: 'Code Reviewer' });
  g.merge('did:jexi:code-reviewer', 'did:jexi:engineering-code-reviewer');
  g.merge('did:jexi:ui-designer', 'did:jexi:design-ui-designer');
  return JSON.stringify(g.graph(), null, 2);
})();
const buildB = (() => {
  const d = tmpdir('p7b');
  const g = createIdentityGraph({ stateDir: d });
  for (const a of FIVE) g.create(a);
  g.create({ id: 'code-reviewer', name: 'Code Reviewer' });
  g.create({ id: 'engineering-code-reviewer', name: 'Code Reviewer' });
  g.merge('did:jexi:engineering-code-reviewer', 'did:jexi:code-reviewer');
  g.merge('did:jexi:design-ui-designer', 'did:jexi:ui-designer');
  return JSON.stringify(g.graph(), null, 2);
})();
console.log('build A bytes:', buildA.length, ' build B bytes:', buildB.length);
console.log('identical:', buildA === buildB);
console.log('sample (build A, first 420 chars):');
console.log(buildA.slice(0, 420));
if (buildA === buildB) ok('P7a two builds with operands given in opposite order -> byte-identical graph()');
else no('P7a graphs differ');
const memA = createIdentityGraph({ persist: false });
const memB = createIdentityGraph({ persist: false });
for (const a of FIVE) { memA.create(a); memB.create(a); }
if (JSON.stringify(memA.graph()) === JSON.stringify(memB.graph())) ok('P7b two independent in-memory graphs agree');
else no('P7b in-memory graphs differ');
const sorted = buildA.length > 0 && (() => {
  const gg = JSON.parse(buildA);
  const dids = gg.nodes.map((n) => n.did);
  const edges = gg.edges.map((e) => `${e.from}|${e.to}`);
  return JSON.stringify(dids) === JSON.stringify([...dids].sort()) && JSON.stringify(edges) === JSON.stringify([...edges].sort());
})();
if (sorted) ok('P7c nodes sort by DID and edges by (from, to)');
else no('P7c ordering not deterministic');

head('P8 the 12 duplicate-name pairs — what does the graph say');
const roster = createRegistry();
roster.load();
const groups = duplicateNames(roster);
console.log(`roster agents: ${roster.agents.length}   duplicate-name groups: ${groups.length}`);
const d8 = tmpdir('p8');
const g8 = createIdentityGraph({ stateDir: d8 });
const seeded = seedFromRoster(g8, roster);
console.log('seeded identities:', seeded.created.length, ' already present:', seeded.skipped.length);
const rep8 = duplicateReport(g8, roster);
console.log('\nname                 distinctDids  collapsed  agents');
for (const r of rep8) {
  console.log(`${r.name.padEnd(20)} ${String(r.distinctDids.length).padEnd(13)} ${String(r.merged).padEnd(10)} ${r.entries.map((e) => e.id).join(', ')}`);
}
const collapsed8 = rep8.filter((r) => r.merged).length;
console.log(`\ngroups collapsed into 1 DID: ${collapsed8} / ${rep8.length}`);
console.log('total nodes:', g8.graph().nodes.length, ' merged:', g8.stats().merged, ' identities:', g8.stats().identities);
if (g8.graph().nodes.length === roster.agents.length) ok(`P8a seeded one node per roster agent (${roster.agents.length}); no duplicate agentIds across scopes`);
else no(`P8a seeded ${g8.graph().nodes.length} nodes for ${roster.agents.length} agents`);
if (collapsed8 === 0) ok('P8b NO group collapsed on its own — the graph requires an explicit merge decision');
else no(`P8b ${collapsed8} groups collapsed without a merge decision`);
// Two groups are special: the two display names differ only by case from one
// member's agentId ("coder"/"coder", "Researcher"/"researcher"). Resolving by id
// is exact, but the id is also the other member's alias, so the graph refuses it
// as ambiguous rather than guessing. Those show fewer distinct DIDs above; the
// name itself is still refused, which P8c confirms for all 12.
const caseTwin = rep8.filter((r) => r.entries.some((e) => !e.ok));
console.log(`\ngroups where resolving a member by id is itself ambiguous: ${caseTwin.length}`);
for (const r of caseTwin) {
  console.log(`  ${JSON.stringify(r.name)}:`);
  for (const e of r.entries) console.log(`    ${e.id.padEnd(12)} -> ${e.ok ? e.did : `${e.code}: ${e.error}`}`);
}
const amb8 = rep8.map((r) => caught(() => g8.resolve(r.name)).error?.code).filter(Boolean);
console.log('resolve(name) across all 12 groups ->', JSON.stringify([...new Set(amb8)]), `(${amb8.length}/${rep8.length} refused as ambiguous)`);
if (amb8.length === rep8.length && amb8.every((c) => c === 'E_AMBIGUOUS_IDENTITY')) ok('P8c all 12 colliding names are refused as E_AMBIGUOUS_IDENTITY (visible, not silent)');
else no(`P8c ambiguity codes: ${JSON.stringify(amb8)}`);
// Merging one pair by hand demonstrates the graph CAN collapse them when told.
const one = rep8[0];
g8.merge(one.distinctDids[0], one.distinctDids[1]);
const afterOne = caught(() => g8.resolve(one.name));
console.log(`\nafter an explicit merge of the ${JSON.stringify(one.name)} pair:`);
console.log('  resolve(name) ->', afterOne.error ? afterOne.error.code : afterOne.value.did);
console.log('  identities:', g8.stats().identities, ' merged nodes:', g8.stats().merged);
if (afterOne.value && afterOne.value.did === one.distinctDids.sort()[0]) ok('P8d an explicit merge collapses that pair; the rest stay ambiguous');
else no('P8d explicit merge did not resolve');
const stillAmb = rep8.slice(1).map((r) => caught(() => g8.resolve(r.name)).error?.code).filter(Boolean);
if (stillAmb.length === rep8.length - 1) ok(`P8e the other ${stillAmb.length} groups remain ambiguous — merges are per-decision, not bulk`);
else no(`P8e ${stillAmb.length} remaining ambiguous, expected ${rep8.length - 1}`);

head('P9 zone check: git status --short');
const status = execFileSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' }).trim();
console.log(status || '(clean)');
const lines = status ? status.split('\n') : [];
const offenders = lines.map((l) => l.slice(3).trim()).filter((p) => {
  const inZone = p.startsWith('workforce/identity/') || /^scripts\/phase13-.*\.mjs$/.test(p);
  return !inZone;
});
if (offenders.length === 0) ok('P9 every modified path is inside workforce/identity/** or scripts/phase13-*.mjs');
else no(`P9 out-of-zone: ${JSON.stringify(offenders)}`);
const protectedPaths = lines.map((l) => l.slice(3).trim()).filter((p) => /^workforce\/(agents|divisions|nexus)\//.test(p) || p === 'workforce/divisions.json');
if (protectedPaths.length === 0) ok('P9b no previous-scope files touched (agents/divisions/nexus/divisions.json)');
else no(`P9b previous-scope files modified: ${JSON.stringify(protectedPaths)}`);

for (const d of [d1, d4, d6]) fs.rmSync(d, { recursive: true, force: true });
console.log('\n=============================');
console.log(`SCOPE D PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);