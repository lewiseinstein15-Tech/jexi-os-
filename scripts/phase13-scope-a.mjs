#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE A — LIVE PROBE.
 *
 *   node scripts/phase13-scope-a.mjs
 *
 * Probes the bulk agent roster against the real tree. Exit 0 = all pass.
 *
 *   P1  load roster          -> count (target 400+)
 *   P2  get(id) x3          -> specs
 *   P3  duplicate id         -> E_DUPLICATE_AGENT
 *   P4  unknown division     -> E_UNKNOWN_DIVISION
 *   P5  missing field        -> E_MISSING_FIELD (names the field)
 *   P6  loader reads disk    -> a real file exists for a sampled spec
 *   P7  determinism          -> two loads are identical
 */

import fs from 'fs';
import path from 'path';
import { createRegistry, ERRORS } from '../workforce/agents/index.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);

const agents = createRegistry();
const result = agents.load();

head('P1 load roster');
console.log(`count: ${result.count}`);
console.log('byOrigin:', JSON.stringify(agents.stats().byOrigin));
console.log('byDivision:', JSON.stringify(agents.stats().byDivision));
console.log('duplicates:', agents.stats().duplicates, 'errors:', agents.stats().errors);
if (result.count >= 400) ok(`P1 roster loaded: ${result.count} agents (target 400+)`);
else no(`P1 roster loaded only ${result.count} agents (target 400+)`);
console.log('actual count:', result.count);

head('P2 get(id) for 3 agents');
for (const id of ['architect', 'zola', 'orchestrator']) {
  const spec = agents.get(id);
  console.log(`${id} ->`, spec ? JSON.stringify({
    id: spec.id, name: spec.name, division: spec.division,
    role: spec.role.slice(0, 60), capabilities: spec.capabilities,
    trustLevel: spec.trustLevel, origin: spec.origin, sourcePath: spec.sourcePath,
  }) : 'null');
}

head('P2b list({division}) counts sum to the roster');
const divs = agents.divisions();
const sum = divs.reduce((n, d) => n + agents.list({ division: d }).length, 0);
console.log(`sum over ${divs.length} divisions = ${sum}, roster = ${result.count}`);
if (sum === result.count) ok('P2b every agent is in exactly one listed division');
else no(`P2b division sum ${sum} != roster ${result.count}`);

head('P3 duplicate id -> E_DUPLICATE_AGENT');
const dup = agents.validate({ ...agents.get('architect') });
console.log('validate(existing architect):', JSON.stringify(dup));
if (!dup.valid && dup.errors.some((e) => e.code === ERRORS.DUPLICATE_AGENT)) ok('P3 duplicate id -> E_DUPLICATE_AGENT');
else no(`P3 expected E_DUPLICATE_AGENT, got ${JSON.stringify(dup.errors)}`);

head('P4 unknown division -> E_UNKNOWN_DIVISION');
const badDiv = agents.validate({
  id: 'ghost', name: 'Ghost', division: 'not-a-division', role: 'x',
  capabilities: ['reasoning'], trustLevel: 'provisional', origin: 'test',
});
console.log('validate(unknown division):', JSON.stringify(badDiv));
if (!badDiv.valid && badDiv.errors.some((e) => e.code === ERRORS.UNKNOWN_DIVISION)) ok('P4 unknown division -> E_UNKNOWN_DIVISION');
else no(`P4 expected E_UNKNOWN_DIVISION, got ${JSON.stringify(badDiv.errors)}`);

head('P5 missing field -> E_MISSING_FIELD naming the field');
const missing = agents.validate({ name: 'No Id', division: 'ops', role: 'x', capabilities: [], trustLevel: 'provisional', origin: 'test' });
console.log('validate(missing id):', JSON.stringify(missing));
const namesId = missing.errors.some((e) => e.code === ERRORS.MISSING_FIELD && e.field === 'id');
if (!missing.valid && namesId) ok('P5 missing field -> E_MISSING_FIELD (field: id)');
else no(`P5 expected E_MISSING_FIELD on id, got ${JSON.stringify(missing.errors)}`);

head('P6 loader reads real files, not a hardcoded list');
let realFiles = 0;
let checked = 0;
for (const spec of result.agents) {
  if (!spec.sourcePath || spec.origin === 'agency-agents') continue;
  checked += 1;
  if (fs.existsSync(path.join(REPO, spec.sourcePath))) realFiles += 1;
}
console.log(`checked ${checked} in-repo specs, ${realFiles} resolve to a real file on disk`);
if (checked > 0 && realFiles === checked) ok('P6 every in-repo spec resolves to a real file');
else no(`P6 ${checked - realFiles} in-repo specs do not resolve to a file`);

head('P6b registry sees an edit without a restart');
const tmpDir = fs.mkdtempSync('/tmp/p13a-');
fs.mkdirSync(path.join(tmpDir, 'agents', 'probe-div'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'agents', 'probe-div', 'fresh-agent.agent.md'), [
  '---', 'name: Fresh Agent', 'description: A probe agent written mid-run.',
  'division: ops', '---', '', '# Fresh Agent', '', '- Role: probe', '',
].join('\n'));
const fresh = createRegistry({ root: tmpDir });
const freshResult = fresh.load();
console.log('fresh registry on temp dir:', freshResult.count, freshResult.agents.map((a) => a.id));
if (fresh.get('fresh-agent') && fresh.get('fresh-agent').origin === 'jexi-canonical') ok('P6b a new file on disk appears on the next load');
else no('P6b new file did not appear');
fs.rmSync(tmpDir, { recursive: true, force: true });

head('P7 determinism');
const again = createRegistry().load();
const same = again.count === result.count
  && JSON.stringify(again.agents.map((a) => a.id)) === JSON.stringify(result.agents.map((a) => a.id))
  && JSON.stringify(again.agents) === JSON.stringify(result.agents);
console.log('two independent loads identical:', same);
if (same) ok('P7 roster is deterministic across loads');
else no('P7 roster differs between loads');

console.log('\n=============================');
console.log(`SCOPE A PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);