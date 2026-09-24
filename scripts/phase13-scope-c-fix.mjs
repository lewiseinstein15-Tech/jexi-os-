#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE C-FIX — LIVE PROBE.
 *
 *   node scripts/phase13-scope-c-fix.mjs
 *
 * Verifies the two accuracy fixes to the route result:
 *   - reason says "first-listed able candidate" (the property the code has)
 *   - warnings[] surfaces an unresolved candidate reference
 *
 *   P1  research route -> reason wording + warnings: []
 *   P2  build route    -> same shape
 *   P3  renamed candidate reference -> warning names it, still routes on
 *   P4  determinism: same intent twice -> byte-identical
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createNexus } from '../agents/workforce/nexus/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);

const nexus = createNexus();
nexus.load();

head('P1 route a research intent -> reason wording + warnings');
const r1 = nexus.route({ kind: 'research', description: 'size the TAM for the new product line' });
console.log('reason:', r1.reason);
console.log('warnings:', JSON.stringify(r1.warnings));
console.log(`-> strategy=${r1.strategy.id} agent=${r1.agent.id}`);
if (r1.reason.includes('first-listed able candidate')) ok('P1a reason says "first-listed able candidate"');
else no('P1a reason does not say "first-listed able candidate"');
if (r1.reason.includes('highest-ranked')) no('P1b reason still claims "highest-ranked"');
else ok('P1b reason no longer claims "highest-ranked"');
if (Array.isArray(r1.warnings)) ok('P1c warnings is an array on every route result');
else no('P1c warnings missing');
// The research route is NOT warning-free: the discovery strategy lists
// "UX Researcher", and the roster holds two agents by that name, so C-fix-2
// surfaces one ambiguity. Asserted explicitly rather than left incidental.
if (r1.warnings.includes('ambiguous candidate reference: UX Researcher')) {
  ok('P1d research route surfaces the real "UX Researcher" ambiguity');
} else no(`P1d expected the UX Researcher ambiguity, got ${JSON.stringify(r1.warnings)}`);

head('P2 route a build intent -> same shape');
const r2 = nexus.route({ kind: 'build', description: 'implement the checkout flow' });
console.log('reason:', r2.reason);
console.log('warnings:', JSON.stringify(r2.warnings));
console.log(`-> strategy=${r2.strategy.id} agent=${r2.agent.id}`);
if (r2.reason.includes('first-listed able candidate')) ok('P2a reason says "first-listed able candidate"');
else no('P2a reason wording wrong');
if (Array.isArray(r2.warnings) && r2.warnings.length === 0) ok('P2b warnings is an empty array');
else no(`P2b warnings not empty: ${JSON.stringify(r2.warnings)}`);
if (r2.division && r2.agent && typeof r2.reason === 'string') ok('P2c route still returns strategy + division + agent + reason');
else no('P2c route shape regressed');

head('P3 unresolved candidate reference -> warning, still routes on');
// Build a fixture root whose projection renames the first discovery candidate.
// Everything else (roster, divisions) is the real tree, so the strategy still
// has other able candidates and routing must continue past the broken one.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p13c-fix-'));
fs.mkdirSync(path.join(tmp, 'workforce/nexus/vendor'), { recursive: true });
for (const d of ['agents', 'jexi-agents', 'server']) {
  const target = path.join(REPO, d);
  if (fs.existsSync(target)) fs.symlinkSync(target, path.join(tmp, d));
}
// The loader reads the vendored catalog from <root>/workforce/agents/vendor,
// so the fixture root needs that tree too — otherwise the agency-agents specs
// never load and every one of their references looks unresolved.
fs.symlinkSync(path.join(REPO, 'agents/workforce/agents'), path.join(tmp, 'agents/workforce/agents'));
fs.copyFileSync(path.join(REPO, 'agents/workforce/divisions.json'), path.join(tmp, 'agents/workforce/divisions.json'));

const projection = JSON.parse(fs.readFileSync(path.join(REPO, 'agents/workforce/nexus/vendor/agency-agents.strategies.json'), 'utf8'));
const discovery = projection.strategies.find((s) => s.id === 'nexus-phase-0-discovery');
const originalFirst = discovery.candidates[0];
const brokenRef = 'Trend Researcher RENAMED';
discovery.candidates[0] = brokenRef;
fs.writeFileSync(path.join(tmp, 'agents/workforce/nexus/vendor/agency-agents.strategies.json'), JSON.stringify(projection, null, 2) + '\n');
console.log(`fixture: renamed discovery candidate #1 from ${JSON.stringify(originalFirst)} to ${JSON.stringify(brokenRef)}`);

const fixture = createNexus({ root: tmp });
const f = fixture.route({ kind: 'research', description: 'size the TAM for the new product line' });
console.log('reason:', f.reason);
console.log('warnings:', JSON.stringify(f.warnings, null, 1));
console.log(`-> strategy=${f.strategy.id} agent=${f.agent.id} (candidateIndex=${f.matched.candidateIndex})`);
const expected = `unresolved candidate reference: ${brokenRef}`;
if (f.warnings.includes(expected)) ok(`P3a warning names the broken reference: ${JSON.stringify(expected)}`);
else no(`P3a expected warning ${JSON.stringify(expected)}, got ${JSON.stringify(f.warnings)}`);
if (f.agent && f.agent.id !== 'product-trend-researcher') ok(`P3b routed on past the broken reference to "${f.agent.id}"`);
else no('P3b did not route past the broken reference');
if (f.reason.includes('first-listed able candidate') && f.reason.includes('unresolved')) ok('P3c reason reports the unresolved count');
else no('P3c reason does not report unresolved count');
fs.rmSync(tmp, { recursive: true, force: true });

head('P4 determinism: same intent twice');
const a = createNexus(); a.load();
const b = createNexus(); b.load();
const intent = { kind: 'research', description: 'size the TAM for the new product line' };
const a1 = JSON.stringify(a.route(intent));
const a2 = JSON.stringify(a.route(intent));
const b1 = JSON.stringify(b.route(intent));
console.log('same router twice identical:', a1 === a2);
console.log('independent routers identical:', a1 === b1);
console.log('route output includes warnings:', JSON.parse(a1).warnings !== undefined);
if (a1 === a2 && a1 === b1) ok('P4 route output byte-identical and includes warnings');
else no('P4 route output differs');

console.log('\n=============================');
console.log(`SCOPE C-FIX PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);