/**
 * JEXI OS — Phase 15 Scope A — live probe for the Omnia Vault.
 * Run: node scripts/phase15-a-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createVault } from '../services/omnia/vault/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };

const ROOT = '/tmp/p15-fixture';
const VAULT = '/tmp/p15-vault';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.rmSync(VAULT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'lib'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'lib', 'math.js'), 'export const add = (a, b) => a + b;\n');
fs.writeFileSync(path.join(ROOT, 'app.js'), "import { add } from './lib/math.js';\nexport const run = () => add(1, 2);\n");
fs.writeFileSync(path.join(ROOT, 'cli.js'), "import { run } from './app.js';\nrun();\n");

const vault = createVault(VAULT);
vault.note('welcome', { title: 'Welcome', body: 'Start with [[setup]] and read [[guide]].', tags: ['intro'] });
vault.note('setup', { title: 'Setup', body: 'See [[welcome]] for context.', tags: ['ops'] });
vault.note('guide', { title: 'Guide', body: 'Deep dive after [[setup]].', tags: ['docs', 'intro'] });

// P1 — index
const idx = vault.index(ROOT);
console.log('P1 notes=' + idx.notes.length + ' edges=' + idx.edges.length + ' planItems=' + idx.plan.items.length);
console.log('P1 noteEdges: ' + idx.edges.filter((e) => e.kind === 'links-to').map((e) => e.from + '->' + e.to).join(', '));
console.log('P1 codeEdges: ' + idx.edges.filter((e) => e.kind === 'imports').map((e) => e.from + '->' + e.to).join(', '));
ok(idx.notes.length === 3, 'P1 index returns 3 notes');
ok(idx.edges.some((e) => e.kind === 'imports' && e.from === 'cli.js' && e.to === 'app.js'), 'P1 code graph has cli.js->app.js import edge');

// P2 — note + backlinks + unknown
const w = vault.note('welcome');
ok(w.title === 'Welcome' && w.links.join() === 'guide,setup', 'P2 note(welcome) parsed with wikilinks');
ok(vault.backlinks('welcome').join() === 'setup', 'P2 backlinks(welcome) == [setup]');
let unknownErr = null;
try { vault.note('nope'); } catch (e) { unknownErr = e; }
ok(unknownErr && unknownErr.code === 'E_UNKNOWN_NOTE', 'P2 unknown note -> E_UNKNOWN_NOTE');

// P3 — triage
const t1 = vault.triage('ship the deploy pipeline\nwrite the runbook');
const t2 = vault.triage('ship the deploy pipeline');
console.log('P3 t1: changed=' + t1.changed + ' actions=' + t1.actions.map((a) => a.type + ':' + a.item).join(', '));
console.log('P3 t2: changed=' + t2.changed + ' actions=' + t2.actions.map((a) => a.type + ':' + a.item).join(', '));
ok(t1.changed === true && t1.actions.length === 2 && t1.actions.every((a) => a.type === 'add'), 'P3 new input adds items (changed=true)');
ok(t2.changed === false && t2.actions[0].type === 'match', 'P3 repeated input matches existing item (changed=false)');

// P4 — catchup
const c = vault.catchup();
console.log('P4 state=' + c.state + ' planItems=' + c.plan.items.length + ' recentBatches=' + c.recentChanges.length);
ok(c.state === 'ready' && c.plan.items.length === 2 && c.recentChanges.length === 2, 'P4 catchup reports state + plan + recent changes');

// P5 — determinism
const VAULT2 = '/tmp/p15-vault2';
fs.rmSync(VAULT2, { recursive: true, force: true });
const v2 = createVault(VAULT2);
v2.note('welcome', { title: 'Welcome', body: 'Start with [[setup]] and read [[guide]].', tags: ['intro'] });
v2.note('setup', { title: 'Setup', body: 'See [[welcome]] for context.', tags: ['ops'] });
v2.note('guide', { title: 'Guide', body: 'Deep dive after [[setup]].', tags: ['docs', 'intro'] });
v2.triage('ship the deploy pipeline\nwrite the runbook');
const pA = JSON.stringify(vault.catchup().plan);
const pB = JSON.stringify(v2.catchup().plan);
const idxA = JSON.stringify(createVault(VAULT).index(ROOT).edges);
const idxB = JSON.stringify(createVault(VAULT2).index(ROOT).edges);
ok(pA === pB && idxA === idxB, 'P5 same tree + same input -> byte-identical plan and edges');

console.log('');
console.log('SCOPE A: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
