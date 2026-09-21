/**
 * JEXI OS — Phase 26 Scope E — live probe for import/export + scoping.
 * Run: node scripts/phase26-e-probe.mjs
 */
import fs from 'node:fs';
import { createInstincts } from '../instincts/core/index.js';
import { createInstinctStore } from '../instincts/store/index.js';
import { createIo } from '../instincts/io/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

function buildSource(root) {
  const core = createInstincts(root);
  const store = createInstinctStore(root);
  const io = createIo(root);
  const a = core.create({ projectId: 'proj-x', action: 'alpha-action', evidence: ['a0'], examples: ['ax'] });
  let b = core.create({ projectId: 'proj-x', action: 'beta-action', evidence: ['b0'], examples: ['bx'] });
  let c = core.create({ projectId: 'proj-x', action: 'gamma-action', evidence: ['c0'], examples: ['cx'] });
  for (let k = 0; k < 3; k += 1) b = core.reinforce(b.id, { projectId: 'proj-x', evidence: 'b' + (k + 1) });
  for (let k = 0; k < 6; k += 1) c = core.reinforce(c.id, { projectId: 'proj-x', evidence: 'c' + (k + 1) });
  return { core, store, io, ids: { a: a.id, b: b.id, c: c.id } };
}

const ROOT = '/tmp/p26-io';
fs.rmSync(ROOT, { recursive: true, force: true });
const { core, store, io, ids } = buildSource(ROOT);

// P1 — export
const exp = io.export('proj-x');
console.log('P1 blob: ' + exp.blob.length + ' chars base64, count=' + exp.count + ' (content withheld)');
ok(typeof exp.blob === 'string' && exp.blob.length > 0 && exp.count === 3, 'P1 export -> opaque lossless blob');

// P2 — no target
const noTarget = errOf(() => io.import(exp.blob));
const noTarget2 = errOf(() => io.import(exp.blob, { mode: 'merge' }));
ok(noTarget && noTarget.code === 'E_TARGET_REQUIRED' && noTarget2 && noTarget2.code === 'E_TARGET_REQUIRED', 'P2 import without targetProjectId -> E_TARGET_REQUIRED (even with mode)');

// P3 — migrate into proj-y
const noMode = errOf(() => io.import(exp.blob, { targetProjectId: 'proj-y' }));
console.log('P3 without mode -> ' + (noMode && noMode.code));
ok(noMode && noMode.code === 'E_TARGET_MODE_REQUIRED', 'P3 cross-project without mode -> E_TARGET_MODE_REQUIRED');
const mig = io.import(exp.blob, { targetProjectId: 'proj-y', mode: 'migrate' });
const yList = store.list('proj-y');
const provOk = yList.every((i) => i.provenance && i.provenance.migratedFrom === 'proj-x' && typeof i.provenance.migratedAt === 'number');
console.log('P3 imported=' + mig.imported + ' | proj-y list: ' + yList.map((i) => i.id + '=' + i.confidence + ' from=' + (i.provenance && i.provenance.migratedFrom) + '@' + (i.provenance && i.provenance.migratedAt)).join(', '));
ok(mig.imported === 3 && yList.length === 3, 'P3 migrate imports 3 into proj-y');
ok(provOk, 'P3 every migrated instinct carries provenance { migratedFrom: proj-x, migratedAt: op-seq }');
const yAfterP3 = JSON.stringify(yList);

// P4 — merge into source: higher-confidence existing wins, evidence unioned
const beforeA = store.get(ids.a, { projectId: 'proj-x' });
core.reinforce(ids.a, { projectId: 'proj-x', evidence: 'post-export-evidence' }); // a: 0.3 -> 0.4 AFTER the blob was made
const midA = store.get(ids.a, { projectId: 'proj-x' });
const merged = io.import(exp.blob, { targetProjectId: 'proj-x', mode: 'merge' });
const afterA = store.get(ids.a, { projectId: 'proj-x' });
console.log('P4 merge imported=' + merged.imported);
console.log('P4 instinct a BEFORE import: confidence=' + midA.confidence + ' reinforce=' + midA.reinforceCount + ' evidence=' + JSON.stringify(midA.evidence.map((e) => e.text)));
console.log('P4 instinct a AFTER  import: confidence=' + afterA.confidence + ' reinforce=' + afterA.reinforceCount + ' evidence=' + JSON.stringify(afterA.evidence.map((e) => e.text)));
ok(afterA.confidence === 0.4 && afterA.reinforceCount === 1, 'P4 higher-confidence existing wins wholesale on counters (blob 0.3 did NOT overwrite 0.4)');
ok(afterA.evidence.length === 2 && afterA.evidence.some((e) => e.text === 'post-export-evidence') && afterA.evidence.some((e) => e.text === 'a0'), 'P4 evidence unioned (dedup by (text, at))');
ok(beforeA.confidence === 0.3, 'P4 (sanity) pre-reinforce confidence was 0.3');

// P5 — blob errors
const v2payload = JSON.parse(Buffer.from(exp.blob, 'base64').toString('utf8'));
v2payload.version = 2;
const v2blob = Buffer.from(JSON.stringify(v2payload), 'utf8').toString('base64');
const verErr = errOf(() => io.import(v2blob, { targetProjectId: 'proj-y', mode: 'migrate' }));
const garbage = errOf(() => io.import('!!!not-base64-at-all!!!', { targetProjectId: 'proj-y', mode: 'migrate' }));
const notJson = errOf(() => io.import(Buffer.from('this is not json', 'utf8').toString('base64'), { targetProjectId: 'proj-y', mode: 'migrate' }));
const missingFields = errOf(() => io.import(Buffer.from(JSON.stringify({ version: 1 }), 'utf8').toString('base64'), { targetProjectId: 'proj-y', mode: 'migrate' }));
console.log('P5 v2=' + (verErr && verErr.code) + ' garbage=' + (garbage && garbage.code) + ' notJson=' + (notJson && notJson.code) + ' missing=' + (missingFields && missingFields.code));
ok(verErr && verErr.code === 'E_BLOB_VERSION', 'P5 version-2 blob -> E_BLOB_VERSION');
ok(garbage && garbage.code === 'E_INVALID_BLOB' && notJson && notJson.code === 'E_INVALID_BLOB' && missingFields && missingFields.code === 'E_INVALID_BLOB', 'P5 malformed blobs -> E_INVALID_BLOB');

// P6 — determinism: same sequence on a fresh root -> byte-identical proj-y
const ROOT2 = '/tmp/p26-io2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const two = buildSource(ROOT2);
const exp2 = two.io.export('proj-x');
two.io.import(exp2.blob, { targetProjectId: 'proj-y', mode: 'migrate' });
const y2 = JSON.stringify(two.store.list('proj-y'));
ok(exp2.blob === exp.blob, 'P6 same source sequence -> byte-identical blob');
ok(y2 === yAfterP3, 'P6 same blob + same target -> byte-identical target state (provenance op-seq included)');

console.log('');
console.log('SCOPE E: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
