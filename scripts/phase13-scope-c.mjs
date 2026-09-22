#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE C — LIVE PROBE.
 *
 *   node scripts/phase13-scope-c.mjs
 *
 * Probes the NEXUS strategy layer against the committed projection and the
 * Scope A roster / Scope B divisions. Exit 0 = all pass.
 *
 *   P1  load strategies (ids + names)
 *   P2  route a research intent -> full object incl. reason
 *   P3  route a build intent    -> full object incl. reason
 *   P4  E_NO_STRATEGY / E_NO_AGENT / malformed intent
 *   P5  determinism: same intent + same roster twice -> byte-identical
 *   P6  zone check: only workforce/nexus/** and scripts/phase13-*.mjs
 */

import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createNexus, ERRORS } from '../workforce/nexus/index.js';
import { createRegistry as createAgentRegistry } from '../workforce/agents/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);
const caught = (fn) => { try { return { value: fn() }; } catch (e) { return { error: e }; } };

const roster = createAgentRegistry().load();

head('P1 nexus.load() -> strategies (ids + names)');
const nexus = createNexus();
const loaded = nexus.load();
console.log(`strategies: ${loaded.strategies.length}`);
for (const s of loaded.strategies) console.log(`  ${s.id.padEnd(38)} ${s.name}`);
console.log('provenance:', JSON.stringify(nexus.provenance()));
console.log('routing tokens:', nexus.kinds().length);
if (loaded.strategies.length > 0) ok(`P1 loaded ${loaded.strategies.length} strategies`);
else no('P1 loaded no strategies');

head('P2 route a research intent');
const research = nexus.route({ kind: 'research', description: 'size the TAM for the new product line' });
console.log(JSON.stringify(research, null, 1));
if (research.strategy && research.division && research.agent && typeof research.reason === 'string') {
  ok('P2 route returned strategy + division + agent + reason');
} else no('P2 route missing a field');
if (research.reason && research.reason.length > 40 && !/lorem|placeholder|TODO/i.test(research.reason)) ok('P2b reason is a real string');
else no('P2b reason looks like a placeholder');
console.log(`research -> strategy=${research.strategy.id} agent=${research.agent.id} division=${research.division.id}`);

head('P3 route a build intent');
const build = nexus.route({ kind: 'build', description: 'implement the checkout flow' });
console.log(JSON.stringify(build, null, 1));
if (build.strategy && build.division && build.agent && typeof build.reason === 'string') {
  ok('P3 route returned strategy + division + agent + reason');
} else no('P3 route missing a field');
console.log(`build -> strategy=${build.strategy.id} agent=${build.agent.id} division=${build.division.id}`);

head('P4 errors: E_NO_STRATEGY, E_NO_AGENT, malformed intent');
const r1 = caught(() => nexus.route({ kind: 'no-such-kind-xyz', description: 'nothing routes this' }));
console.log('route(unmatched kind):', r1.error && JSON.stringify({ name: r1.error.name, code: r1.error.code, message: r1.error.message }));
if (r1.error && r1.error.code === ERRORS.NO_STRATEGY) ok('P4a no matching strategy -> E_NO_STRATEGY');
else no(`P4a expected E_NO_STRATEGY, got ${r1.error && r1.error.code}`);

// A matching strategy whose candidates are all excluded -> E_NO_AGENT.
// 'voice' is a real division with no Phase 3 candidate in it, so the strategy
// matches but no candidate is able.
const r2 = caught(() => nexus.route(
  { kind: 'build', description: 'implement the checkout flow' },
  { division: 'voice' },
));
console.log('route(matched strategy, impossible division filter):', r2.error && JSON.stringify({ name: r2.error.name, code: r2.error.code, message: r2.error.message }));
if (r2.error && r2.error.code === ERRORS.NO_AGENT) ok('P4b matched strategy, no able agent -> E_NO_AGENT');
else no(`P4b expected E_NO_AGENT, got ${r2.error && r2.error.code}`);

const r3 = nexus.validate({ description: 'no kind here' });
console.log('validate(missing kind):', JSON.stringify(r3));
if (!r3.valid && r3.errors.some((e) => e.code === ERRORS.INVALID_INTENT)) ok('P4c malformed intent -> { valid: false, errors }');
else no('P4c malformed intent not rejected');
const r3b = nexus.validate({ kind: 'build' });
console.log('validate(missing description):', JSON.stringify(r3b));
if (!r3b.valid && r3b.errors.some((e) => e.field === 'description')) ok('P4d missing description -> error names the field');
else no('P4d missing description not reported');
const r3c = nexus.validate({ kind: 'build', description: 'ok' });
console.log('validate(valid intent):', JSON.stringify(r3c));
if (r3c.valid) ok('P4e well-formed intent -> { valid: true }');
else no('P4e well-formed intent rejected');
const r4 = caught(() => nexus.route({ kind: 'build', description: 'x' }, { strategyId: 'no-such-strategy' }));
console.log('route(unknown strategyId):', r4.error && JSON.stringify({ name: r4.error.name, code: r4.error.code }));
if (r4.error && r4.error.code === ERRORS.UNKNOWN_STRATEGY) ok('P4f unknown strategy id -> E_UNKNOWN_STRATEGY');
else no(`P4f expected E_UNKNOWN_STRATEGY, got ${r4.error && r4.error.code}`);

head('P5 determinism: same intent + same roster twice');
const a = createNexus(); a.load();
const b = createNexus(); b.load();
const intents = [
  { kind: 'research', description: 'size the TAM for the new product line' },
  { kind: 'build', description: 'implement the checkout flow' },
  { kind: 'incident-response', description: 'p0 outage in payments' },
  { kind: 'marketing-campaign', description: 'launch campaign' },
];
let identical = true;
for (const i of intents) {
  const ra = JSON.stringify(a.route(i));
  const rb = JSON.stringify(b.route(i));
  const same = ra === rb;
  if (!same) identical = false;
  console.log(`${i.kind.padEnd(20)} identical=${same} -> ${a.route(i).agent.id}`);
}
const a2 = JSON.stringify(a.route({ kind: 'research', description: 'size the TAM for the new product line' }));
const a3 = JSON.stringify(a.route({ kind: 'research', description: 'size the TAM for the new product line' }));
if (identical && a2 === a3) ok('P5 repeated routes are byte-identical');
else no('P5 routes differ between runs');

head('P6 zone check: git status --short');
const status = execFileSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' }).trim();
console.log(status || '(clean)');
const lines = status.split('\n').filter(Boolean);
const allowedPath = /^(workforce\/nexus\/|scripts\/phase13-.*\.mjs$)/;
const stray = lines.filter((l) => !allowedPath.test(l.replace(/^(.{1,2})\s+/, '')));
if (stray.length === 0) ok(`P6 all ${lines.length} changed paths are in zone`);
else no(`P6 out-of-zone paths: ${JSON.stringify(stray)}`);

console.log('\n=============================');
console.log(`SCOPE C PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);