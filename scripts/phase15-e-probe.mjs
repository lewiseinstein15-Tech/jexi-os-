/**
 * JEXI OS — Phase 15 Scope E — live probe for evomap.
 * Run: node scripts/phase15-e-probe.mjs
 */
import fs from 'node:fs';
import { createEvomap, DEFAULT_GENE } from '../evomap/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const D1 = '/tmp/p15-evomap';
const D2 = '/tmp/p15-evomap2';
const D3 = '/tmp/p15-evomap3';
for (const d of [D1, D2, D3]) fs.rmSync(d, { recursive: true, force: true });

const e1 = createEvomap(D1);

// P1 — full cycle
const c1 = e1.cycle();
console.log('P1 genes=' + JSON.stringify(c1.genes.map((g) => ({ id: g.id, value: g.value, version: g.version }))));
console.log('P1 capsule=' + c1.capsule.capsuleId + ' from=' + c1.capsule.from + ' to=' + c1.capsule.to + ' status=' + c1.capsule.status + ' promoted=' + c1.promoted);
console.log('P1 events=' + c1.events.map((e) => e.action).join(' -> '));
ok(c1.events.map((e) => e.action).join() === 'define,mutate,select,promote', 'P1 cycle runs define -> mutate -> select -> promote');
ok(c1.genes[0].value === 100 && c1.capsule.status === 'promoted', 'P1 live gene changed 0 -> 100');

// P2 — audit + range
const all = e1.audit();
console.log('P2 audit all: ' + all.map((e) => e.seq + ':' + e.action + '@' + e.at).join(', '));
const sub = e1.audit({ from: 2, to: 3 });
console.log('P2 audit {from:2,to:3}: ' + sub.map((e) => e.action).join(', '));
ok(all.length === 4 && all.map((e) => e.seq).join() === '1,2,3,4', 'P2 audit returns full ordered trail');
ok(sub.length === 2 && sub.map((e) => e.action).join() === 'mutate,select', 'P2 range filter is inclusive subset');

// P3 — export/import across instances
const ex = e1.export('capsule-001');
console.log('P3 blob=' + ex.blob.slice(0, 40) + '… (' + ex.blob.length + ' chars)');
const e2 = createEvomap(D2);
e2.gep.defineGene(DEFAULT_GENE); // second instance starts with the same gene
const imp = e2.import(ex.blob);
console.log('P3 imported: ' + imp.capsuleId + ' applied=' + imp.applied + ' gene value=' + e2.gep.gene('cycle-gene').value);
ok(imp.capsuleId === 'capsule-001' && imp.applied === true && e2.gep.gene('cycle-gene').value === 100, 'P3 import on second instance applies capsule');

// P4 — round-trip lossless
const ex2 = e2.export('capsule-001');
ok(ex2.blob === ex.blob, 'P4 export -> import -> export is byte-identical');
console.log('P4 blobs identical: ' + (ex2.blob === ex.blob));

// P5 — errors
const e3 = createEvomap(D3);
const noGene = errOf(() => e3.import(ex.blob));
e3.gep.defineGene({ id: 'cycle-gene', name: 'Cycle gene', value: 0, schema: { type: 'number', min: 0, max: 500 } });
const mismatch = errOf(() => e3.import(ex.blob));
const twice = errOf(() => e2.import(ex.blob));
console.log('P5 unknown gene -> ' + (noGene ? noGene.code : 'no error'));
console.log('P5 schema mismatch -> ' + (mismatch ? mismatch.code : 'no error'));
console.log('P5 second import -> ' + (twice ? twice.code : 'no error'));
ok(noGene && noGene.code === 'E_UNKNOWN_GENE', 'P5 import with unknown gene -> E_UNKNOWN_GENE');
ok(mismatch && mismatch.code === 'E_SCHEMA_MISMATCH', 'P5 schema disagreement -> E_SCHEMA_MISMATCH');
ok(twice && twice.code === 'E_ALREADY_IMPORTED', 'P5 duplicate import -> E_ALREADY_IMPORTED');

// P6 — determinism
const DA = '/tmp/p15-evomapA';
const DB = '/tmp/p15-evomapB';
for (const d of [DA, DB]) fs.rmSync(d, { recursive: true, force: true });
const ea = createEvomap(DA);
const eb = createEvomap(DB);
const ca = ea.cycle();
const cb = eb.cycle();
ok(JSON.stringify(ca.events) === JSON.stringify(cb.events) && JSON.stringify(ca.capsule) === JSON.stringify(cb.capsule) && ca.genes[0].value === cb.genes[0].value, 'P6 same start state + same cycle -> byte-identical events + capsule + gene value');

console.log('');
console.log('SCOPE E: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
