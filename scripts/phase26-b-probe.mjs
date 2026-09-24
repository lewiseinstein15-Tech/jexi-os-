/**
 * JEXI OS — Phase 26 Scope B — live probe for schema + confidence.
 * Run: node scripts/phase26-b-probe.mjs
 */
import fs from 'node:fs';
import { createInstincts, validate, computeConfidence, MODEL } from '../mind/instincts/core/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const ROOT = '/tmp/p26-core';
fs.rmSync(ROOT, { recursive: true, force: true });
const core = createInstincts(ROOT);

// P1 — create
const i1 = core.create({ projectId: 'proj-x', action: 'run-tests-before-commit', evidence: ['saw 2 broken pushes'], examples: ['npm test then commit'] });
console.log('P1 instinct: ' + JSON.stringify(i1));
ok(i1.confidence === 0.3 && i1.reinforceCount === 0 && i1.contradictCount === 0 && i1.firstSeenAt > 0, 'P1 created with base confidence 0.3');

// P2 — reinforce 3x
let cur = i1;
for (let k = 0; k < 3; k += 1) cur = core.reinforce(i1.id, { projectId: 'proj-x', evidence: 'corroboration #' + (k + 1) });
const s2 = core.score(cur);
console.log('P2 derivation: base=' + s2.signals.base + ' + ' + s2.signals.reinforceCount + '*' + MODEL.reinforceStep + '=' + s2.signals.reinforceContribution + ' -> raw=' + s2.signals.raw + ' score=' + s2.score);
ok(cur.confidence === 0.6 && cur.reinforceCount === 3 && s2.score === 0.6, 'P2 reinforce 3x -> 0.3 + 0.3 = 0.6');

// P3 — contradict 2x on top
for (let k = 0; k < 2; k += 1) cur = core.contradict(i1.id, { projectId: 'proj-x', evidence: 'counterexample #' + (k + 1) });
const s3 = core.score(cur);
console.log('P3 derivation: base=' + s3.signals.base + ' + ' + s3.signals.reinforceContribution + ' - ' + s3.signals.contradictContribution + ' -> raw=' + s3.signals.raw + ' score=' + s3.score);
ok(cur.confidence === 0.2 && cur.contradictCount === 2 && s3.score === 0.2, 'P3 contradict 2x -> 0.3 + 0.3 - 0.4 = 0.2');

// P4 — clamp boundaries (declared formula)
const hi = computeConfidence({ reinforceCount: 10, contradictCount: 0 });
const lo = computeConfidence({ reinforceCount: 0, contradictCount: 5 });
console.log('P4 formula(10r,0c)=1.3 -> ' + hi + ' | formula(0r,5c)=-0.7 -> ' + lo);
ok(hi === 1 && lo === 0, 'P4 clamps to [0, 1]');

// P5 — errors
const unknown = errOf(() => core.reinforce('instinct-nope', { projectId: 'proj-x', evidence: 'x' }));
const invalid = errOf(() => core.create({ projectId: 'proj-x' })); // missing action
const v = validate({ id: 'x', projectId: 'proj-x', action: 'a' }); // missing arrays/counts
console.log('P5 unknown=' + (unknown ? unknown.code : 'none') + ' invalid=' + (invalid ? invalid.code + ': ' + invalid.message : 'none'));
console.log('P5 validate errors fields: ' + (v.errors || []).map((e) => e.field).join(', '));
ok(unknown && unknown.code === 'E_UNKNOWN_INSTINCT', 'P5 unknown id -> E_UNKNOWN_INSTINCT');
ok(invalid && invalid.code === 'E_INVALID_INSTINCT' && invalid.message.includes('action'), 'P5 invalid shape -> E_INVALID_INSTINCT naming field');
ok(v.valid === false && (v.errors || []).some((e) => e.field === 'evidence'), 'P5 validate lists offending field names');

// P6 — determinism
const ROOT2 = '/tmp/p26-core2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const core2 = createInstincts(ROOT2);
const j = core2.create({ projectId: 'proj-x', action: 'run-tests-before-commit', evidence: ['saw 2 broken pushes'], examples: ['npm test then commit'] });
let cur2 = j;
for (let k = 0; k < 3; k += 1) cur2 = core2.reinforce(j.id, { projectId: 'proj-x', evidence: 'corroboration #' + (k + 1) });
for (let k = 0; k < 2; k += 1) cur2 = core2.contradict(j.id, { projectId: 'proj-x', evidence: 'counterexample #' + (k + 1) });
ok(JSON.stringify(core.get('proj-x', i1.id)) === JSON.stringify(core2.get('proj-x', j.id)), 'P6 same sequence -> byte-identical instinct');

// P7 — persistence: reload from disk via a fresh instance
const core3 = createInstincts(ROOT);
const reloaded = core3.get('proj-x', i1.id);
ok(JSON.stringify(reloaded) === JSON.stringify(cur), 'P7 reload from disk -> same instinct state');

console.log('');
console.log('SCOPE B: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
