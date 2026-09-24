/**
 * JEXI OS — Phase 15 Scope D — live probe for GEP.
 * Run: node scripts/phase15-d-probe.mjs
 */
import fs from 'node:fs';
import { createGEP } from '../services/evomap/gep/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const DIR = '/tmp/p15-gep';
fs.rmSync(DIR, { recursive: true, force: true });
const gep = createGEP(DIR);

// P1 — define gene
const gene = gep.defineGene({ id: 'cache-size', name: 'Cache size', value: 100, schema: { type: 'number', min: 0, max: 1000 } });
console.log('P1 gene=' + gene.id + ' name=' + gene.name + ' value=' + gene.value + ' schema=' + JSON.stringify(gene.schema));
ok(gene.id === 'cache-size' && gene.value === 100 && gene.schema.type === 'number', 'P1 gene defined with schema + initial value');

// P2 — mutate packages, does not apply
const m1 = gep.mutate('cache-size', { delta: { set: 500 } });
console.log('P2 ' + m1.capsuleId + ' from=' + m1.from + ' to=' + m1.to + ' | live value after mutate=' + gep.gene('cache-size').value);
ok(m1.capsuleId === 'capsule-001' && m1.from === 100 && m1.to === 500, 'P2 mutate returns capsuleId/from/to');
ok(gep.gene('cache-size').value === 100, 'P2 live gene unchanged (packaged, not applied)');

// P3 — schema violation
const viol = errOf(() => gep.mutate('cache-size', { delta: { set: 5000 } }));
console.log('P3 {set:5000} -> ' + (viol ? viol.code : 'no error'));
ok(viol && viol.code === 'E_SCHEMA_VIOLATION', 'P3 schema-violating mutation -> E_SCHEMA_VIOLATION');

// P4 — selection with visible derivation
const s1 = gep.select('capsule-001');
console.log('P4 capsule-001 fitness parts=' + JSON.stringify(s1.fitness.parts) + ' total=' + s1.fitness.total + ' threshold=' + s1.fitness.threshold + ' promoted=' + s1.promoted);
ok(s1.promoted === true && s1.fitness.total === 0.8, 'P4 fitness computed by rule (0.4+0.3+0+0.1=0.8) -> promoted');
const m2 = gep.mutate('cache-size', { delta: { set: 5 } });
const s2 = gep.select(m2.capsuleId);
console.log('P4 capsule-002 fitness parts=' + JSON.stringify(s2.fitness.parts) + ' total=' + s2.fitness.total + ' promoted=' + s2.promoted);
ok(s2.promoted === false && s2.fitness.total === 0.5, 'P4 below-threshold (0.4-0.2+0.2+0.1=0.5) -> promoted:false');

// P5 — promote
const p1 = gep.promote('capsule-001');
console.log('P5 promote: gene ' + p1.geneId + ' ' + p1.from + ' -> ' + p1.to + ' live=' + gep.gene('cache-size').value);
ok(p1.promoted === true && gep.gene('cache-size').value === 500, 'P5 promote applies capsule to live gene');
const dbl = errOf(() => gep.promote('capsule-001'));
ok(dbl && dbl.code === 'E_ALREADY_PROMOTED', 'P5 re-promote -> E_ALREADY_PROMOTED');

// P6 — rollback + event trail + errors
const rb = gep.rollback('capsule-001');
console.log('P6 rollback: restored=' + rb.restored + ' value=' + rb.value + ' at=' + rb.at);
ok(rb.restored === true && gep.gene('cache-size').value === 100, 'P6 rollback restores previous value');
console.log('P6 events: ' + gep.events().map((e) => e.seq + ':' + e.action + (e.capsuleId ? '(' + e.capsuleId + ')' : '')).join(' -> '));
const notProm = errOf(() => gep.rollback('capsule-002'));
const dblRb = errOf(() => gep.rollback('capsule-001'));
ok(notProm && notProm.code === 'E_NOT_PROMOTED', 'P6 rollback unpromoted -> E_NOT_PROMOTED');
ok(dblRb && dblRb.code === 'E_ALREADY_ROLLED_BACK', 'P6 rollback twice -> E_ALREADY_ROLLED_BACK');

// P7 — determinism: same sequence on a fresh dir
const DIR2 = '/tmp/p15-gep2';
fs.rmSync(DIR2, { recursive: true, force: true });
const g2 = createGEP(DIR2);
g2.defineGene({ id: 'cache-size', name: 'Cache size', value: 100, schema: { type: 'number', min: 0, max: 1000 } });
g2.mutate('cache-size', { delta: { set: 500 } });
g2.select('capsule-001');
g2.mutate('cache-size', { delta: { set: 5 } });
g2.select('capsule-002');
g2.promote('capsule-001');
g2.rollback('capsule-001');
ok(JSON.stringify(gep.events()) === JSON.stringify(g2.events()), 'P7 same sequence -> byte-identical events');

console.log('');
console.log('SCOPE D: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
