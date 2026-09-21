#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE C-FIX-2 — LIVE PROBE.
 *
 *   node scripts/phase13-scope-c-fix-2.mjs
 *
 * Verifies that warnings[] is the single diagnostic surface on every path:
 *   P1  clean route -> warnings: []
 *   P2  unresolved reference -> warning, route continues
 *   P3  ambiguous reference -> warning, reason wording unchanged
 *   P4  E_NO_AGENT -> error carries warnings[] + unresolved[] + ambiguous[]
 *   P5  determinism: same intent twice -> byte-identical
 *
 * Fixtures re-project the committed strategies.json with one reference broken,
 * in a temp root that symlinks the real roster/divisions so nothing else drifts.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createNexus, resolveReference } from '../workforce/nexus/index.js';
import { createRegistry as createAgentRegistry } from '../workforce/agents/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);
const caught = (fn) => { try { return { value: fn() }; } catch (e) { return { error: e }; } };

const RESEARCH = { kind: 'research', description: 'size the TAM for the new product line' };
const DISCOVERY = 'nexus-phase-0-discovery';

/** Build a temp root whose given strategy has the given first candidate. */
function fixtureWith(firstCandidate, strategyId = DISCOVERY) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p13c2-'));
  fs.mkdirSync(path.join(tmp, 'workforce/nexus/vendor'), { recursive: true });
  for (const d of ['agents', 'jexi-agents', 'server']) {
    const target = path.join(REPO, d);
    if (fs.existsSync(target)) fs.symlinkSync(target, path.join(tmp, d));
  }
  // The roster loader reads its vendored catalog from <root>/workforce/agents/vendor.
  fs.symlinkSync(path.join(REPO, 'workforce/agents'), path.join(tmp, 'workforce/agents'));
  fs.copyFileSync(path.join(REPO, 'workforce/divisions.json'), path.join(tmp, 'workforce/divisions.json'));

  const projection = JSON.parse(fs.readFileSync(path.join(REPO, 'workforce/nexus/vendor/agency-agents.strategies.json'), 'utf8'));
  const d = projection.strategies.find((s) => s.id === strategyId);
  const before = d.candidates[0];
  d.candidates[0] = firstCandidate;
  fs.writeFileSync(path.join(tmp, 'workforce/nexus/vendor/agency-agents.strategies.json'), JSON.stringify(projection, null, 2) + '\n');

  const nexus = createNexus({ root: tmp });
  return { nexus, tmp, before };
}

const nexus = createNexus();
nexus.load();

head('P1 clean route -> warnings: []');
// NOTE: the block's P1 asks for a warning-free *research* route. The tree does
// not allow one. Upstream's discovery strategy lists "UX Researcher", and the
// roster holds TWO agents with that name (design-ux-researcher, agency-agents +
// ux-researcher, jexi-canonical), so that route legitimately carries one
// ambiguity warning. That is the condition this fix exists to surface, so it is
// reported rather than suppressed. The clean case is demonstrated on a route
// whose candidates all resolve uniquely: build.
const r1 = nexus.route({ kind: 'build', description: 'implement the checkout flow' });
console.log('reason:', r1.reason);
console.log('warnings:', JSON.stringify(r1.warnings));
console.log(`-> strategy=${r1.strategy.id} agent=${r1.agent.id}`);
if (Array.isArray(r1.warnings) && r1.warnings.length === 0) ok('P1a warnings is an empty array when every candidate resolves uniquely');
else no(`P1a warnings not empty: ${JSON.stringify(r1.warnings)}`);
if (r1.reason.includes('first-listed able candidate')) ok('P1b reason says "first-listed able candidate"');
else no('P1b reason wording wrong');

head('P1c the shipped research route reports its real ambiguity (tree contradiction with block P1)');
const rr1 = nexus.route(RESEARCH);
console.log('reason:', rr1.reason);
console.log('warnings:', JSON.stringify(rr1.warnings));
const amb1 = rr1.warnings.find((w) => w === 'ambiguous candidate reference: UX Researcher');
if (rr1.warnings.length === 1 && amb1) {
  ok('P1c1 research route carries exactly 1 warning: "ambiguous candidate reference: UX Researcher"');
} else {
  no(`P1c1 expected exactly 1 ambiguity warning on the research route, got ${JSON.stringify(rr1.warnings)}`);
}
if (rr1.agent.id === 'product-trend-researcher') ok('P1c2 research route still picks the first-listed able candidate');
else no(`P1c2 research routed to ${rr1.agent.id}`);
if (rr1.reason.includes('and 1 ambiguous')) ok('P1c3 the same ambiguity is counted in the reason string');
else no('P1c3 reason does not count the ambiguity');
const dupNames = (() => {
  const A = createAgentRegistry(); A.load();
  const by = {};
  for (const a of A.agents) (by[a.name.toLowerCase()] = by[a.name.toLowerCase()] || []).push(a.id);
  return Object.entries(by).filter(([, v]) => v.length > 1);
})();
console.log(`roster names duplicated (cause of shipped ambiguity): ${dupNames.length}`);
for (const [n, v] of dupNames) console.log('  ', JSON.stringify(n), JSON.stringify(v));
if (dupNames.length > 0) ok(`P1c4 ambiguity is a real roster condition: ${dupNames.length} duplicated names`);
else no('P1c4 no duplicated names found');

head('P2 unresolved reference -> warning, route continues');
const f2 = fixtureWith('Trend Researcher RENAMED');
console.log(`fixture: renamed discovery candidate #1 from ${JSON.stringify(f2.before)} to "Trend Researcher RENAMED"`);
const r2 = f2.nexus.route(RESEARCH);
console.log('reason:', r2.reason);
console.log('warnings:', JSON.stringify(r2.warnings, null, 1));
console.log(`-> agent=${r2.agent.id} (candidateIndex=${r2.matched.candidateIndex})`);
const want2 = 'unresolved candidate reference: Trend Researcher RENAMED';
if (r2.warnings.includes(want2)) ok(`P2a warning names the broken reference: ${JSON.stringify(want2)}`);
else no(`P2a expected ${JSON.stringify(want2)}, got ${JSON.stringify(r2.warnings)}`);
// The discovery strategy also carries its own real ambiguity ("UX Researcher"),
// so the fixture route shows the unresolved warning first, then that one.
if (r2.warnings.length === 2 && r2.warnings[1] === 'ambiguous candidate reference: UX Researcher') {
  ok('P2c unresolved and ambiguous warnings both appear on the same route');
} else no(`P2c expected 2 warnings (unresolved + ambiguous), got ${JSON.stringify(r2.warnings)}`);
if (r2.agent.id === 'product-feedback-synthesizer') ok('P2b routed on to the next candidate');
else no(`P2b routed to ${r2.agent.id}`);
fs.rmSync(f2.tmp, { recursive: true, force: true });

head('P3 ambiguous reference -> warning, reason wording unchanged');
// Use the build strategy: its 17 candidates all resolve uniquely in the shipped
// projection, so an induced ambiguity is the only warning on the route.
const BUILD_INTENT = { kind: 'build', description: 'implement the checkout flow' };
const f3 = fixtureWith('UX Researcher', 'nexus-phase-3-build');
console.log('fixture: build candidate #1 set to "UX Researcher" (matches 2 roster agents)');
const r3 = f3.nexus.route(BUILD_INTENT);
console.log('reason:', r3.reason);
console.log('warnings:', JSON.stringify(r3.warnings, null, 1));
console.log(`-> agent=${r3.agent.id} (candidateIndex=${r3.matched.candidateIndex})`);
const want3 = 'ambiguous candidate reference: UX Researcher';
if (r3.warnings.length === 1 && r3.warnings[0] === want3) ok(`P3a warnings carries exactly the ambiguity: ${JSON.stringify(want3)}`);
else no(`P3a expected exactly ${JSON.stringify([want3])}, got ${JSON.stringify(r3.warnings)}`);
if (r3.agent.id === 'engineering-backend-architect') ok('P3b routed on past the ambiguous candidate');
else no(`P3b routed to ${r3.agent.id}`);
if (r3.reason.includes('first-listed able candidate')) ok('P3c reason still says "first-listed able candidate"');
else no('P3c reason wording changed');
if (r3.reason.includes('1 ambiguous')) ok('P3d reason counts the ambiguous candidate');
else no('P3d reason lost the ambiguous count');
const A3 = createAgentRegistry(); A3.load();
const rr = resolveReference('UX Researcher', A3);
console.log('resolveReference("UX Researcher") ->', JSON.stringify(rr));
if (Array.isArray(rr.resolved) && rr.resolved.length === 2 && Array.isArray(rr.warnings) && rr.warnings.length === 0) {
  ok('P3e resolveReference returns { resolved: string[], warnings: [] } with both matches');
} else no(`P3e unexpected resolveReference shape: ${JSON.stringify(rr)}`);
const rr2 = resolveReference('No Such Agent At All', A3);
console.log('resolveReference("No Such Agent At All") ->', JSON.stringify(rr2));
if (rr2.resolved.length === 0 && rr2.warnings.length === 1) ok('P3f resolveReference returns its own warning without a caller-supplied array');
else no(`P3f unexpected: ${JSON.stringify(rr2)}`);
fs.rmSync(f3.tmp, { recursive: true, force: true });

head('P4 E_NO_AGENT -> error carries warnings[] + unresolved[] + ambiguous[]');
const p4 = caught(() => nexus.route({ kind: 'build', description: 'implement the checkout flow' }, { division: 'voice' }));
const e = p4.error;
console.log('error:', e && JSON.stringify({ name: e.name, code: e.code, message: e.message }));
console.log('unresolved:', e && JSON.stringify(e.unresolved));
console.log('ambiguous:', e && JSON.stringify(e.ambiguous));
console.log('warnings:', e && JSON.stringify(e.warnings, null, 1));
if (e && e.code === 'E_NO_AGENT') ok('P4a matched strategy, no able agent -> E_NO_AGENT');
else no(`P4a got ${e && e.code}`);
if (e && e.name === 'StrategyError') ok('P4b class is StrategyError (no second error class introduced)');
else no(`P4b class is ${e && e.name}`);
if (e && Array.isArray(e.warnings) && Array.isArray(e.unresolved) && Array.isArray(e.ambiguous)) {
  ok('P4c error carries warnings[] + unresolved[] + ambiguous[] together');
} else no('P4c error missing one of the three arrays');

// Force all candidates unresolved: rename every discovery candidate, then
// require a division no candidate can be in, so the unresolved path is what
// populates warnings on the refusal.
const proj = JSON.parse(fs.readFileSync(path.join(REPO, 'workforce/nexus/vendor/agency-agents.strategies.json'), 'utf8'));
const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'p13c2-allunres-'));
fs.mkdirSync(path.join(tmp4, 'workforce/nexus/vendor'), { recursive: true });
for (const d of ['agents', 'jexi-agents', 'server']) {
  const target = path.join(REPO, d);
  if (fs.existsSync(target)) fs.symlinkSync(target, path.join(tmp4, d));
}
fs.symlinkSync(path.join(REPO, 'workforce/agents'), path.join(tmp4, 'workforce/agents'));
fs.copyFileSync(path.join(REPO, 'workforce/divisions.json'), path.join(tmp4, 'workforce/divisions.json'));
const dd = proj.strategies.find((s) => s.id === DISCOVERY);
dd.candidates = dd.candidates.map((c) => `${c} RENAMED`);
fs.writeFileSync(path.join(tmp4, 'workforce/nexus/vendor/agency-agents.strategies.json'), JSON.stringify(proj, null, 2) + '\n');
const n4 = createNexus({ root: tmp4 });
const p4b = caught(() => n4.route(RESEARCH));
const e2 = p4b.error;
console.log('all-candidates-unresolved error:', e2 && JSON.stringify({ name: e2.name, code: e2.code, message: e2.message }));
console.log('  unresolved count:', e2 && e2.unresolved.length);
console.log('  warnings count:', e2 && e2.warnings.length);
console.log('  warnings:', e2 && JSON.stringify(e2.warnings, null, 1));
if (e2 && e2.code === 'E_NO_AGENT' && e2.warnings.length === 6 && e2.unresolved.length === 6) {
  ok('P4d all-unresolved refusal carries 6 warnings + 6 unresolved');
} else no(`P4d expected 6/6, got warnings=${e2 && e2.warnings.length} unresolved=${e2 && e2.unresolved.length}`);
if (e2 && e2.warnings.every((w) => w.startsWith('unresolved candidate reference: '))) ok('P4e every warning on the refusal is an unresolved-reference string');
else no('P4e refusal warnings unexpected');
fs.rmSync(tmp4, { recursive: true, force: true });

head('P5 determinism: same intent twice');
const a = createNexus(); a.load();
const b = createNexus(); b.load();
const a1 = JSON.stringify(a.route(RESEARCH));
const a2 = JSON.stringify(a.route(RESEARCH));
const b1 = JSON.stringify(b.route(RESEARCH));
console.log('same router twice identical:', a1 === a2);
console.log('independent routers identical:', a1 === b1);
if (a1 === a2 && a1 === b1) ok('P5 route output byte-identical across runs and routers');
else no('P5 route output differs');

console.log('\n=============================');
console.log(`SCOPE C-FIX-2 PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);