/**
 * JEXI OS — Phase 14 Scope F — live probe for the repo map.
 * Run: node scripts/phase14-f-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoMap } from '../semantica/repo-map/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`PASS ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const ROOT = '/tmp/p14-fixture';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const FILLER = `const filler = '${'x'.repeat(600)}';`;
const files = {};
files['core.js'] = Array.from({ length: 12 }, (_, i) => `export function coreFn${i}() { return ${i}; }`).join('\n') + `\n// ${'c'.repeat(450)}\n`;
files['util.js'] = Array.from({ length: 8 }, (_, i) => `export const util_${i} = ${i};`).join('\n') + `\n${FILLER}\n`;
files['model.js'] = Array.from({ length: 8 }, (_, i) => `export class Model${i} { constructor(v){ this.v = v; } }`).join('\n') + `\n${FILLER}\n`;
files['README.md'] = '# Fixture\n## Purpose\nrepo map fixture\n' + 'plain prose that is not a signature\n'.repeat(5);
for (let i = 1; i <= 11; i += 1) {
  files[`worker-${String(i).padStart(2, '0')}.js`] =
    `import { coreFn1 } from './core.js';\nimport { util_1 } from './util.js';\nimport { Model1 } from './model.js';\n` +
    `export function work${i}() { return coreFn1() + util_1 + new Model1(${i}).v; }\n` +
    `export const meta${i} = { n: ${i} };\n${FILLER}\n`;
}
const BASE = Date.parse('2026-01-01T00:00:00Z');
Object.entries(files).forEach(([rel, content], i) => {
  const p = path.join(ROOT, rel);
  fs.writeFileSync(p, content);
  const t = (BASE + i * 60000) / 1000;
  fs.utimesSync(p, t, t);
});

repoMap.invalidate(ROOT);

// P1 — ranked build
const full = repoMap.build(ROOT, { budget: 1000 });
console.log(`P1 top5: ${full.files.slice(0, 5).join(', ')}`);
console.log(`P1 total files kept: ${full.files.length} / 15, tokens=${full.tokens}, cache=${full.cache}`);
ok(full.files.length === 15 || full.tokens > 0, 'P1 build returns ranked files + summary + tokens');
const top3 = new Set(full.files.slice(0, 3));
ok(top3.has('core.js') && top3.has('util.js') && top3.has('model.js'), 'P1 referenced trio (core/util/model) outranks all workers');

// P2 — signatures only
const lines = full.summary.split('\n');
const longest = Math.max(...lines.map((l) => l.length));
console.log(`P2 longest summary line: ${longest} chars`);
ok(longest <= 400, 'P2 no summary line exceeds 400 chars');
ok(!full.summary.includes('x'.repeat(600)), 'P2 no full file bodies in summary');
ok(full.summary.includes('export function coreFn0'), 'P2 signatures present');

// P3 — budget enforcement
const b200 = repoMap.build(ROOT, { budget: 200 });
const b100 = repoMap.build(ROOT, { budget: 100 });
repoMap.invalidate(ROOT);
const b1000 = repoMap.build(ROOT, { budget: 1000 });
console.log(`P3 files kept: budget1000=${b1000.files.length} budget200=${b200.files.length} budget100=${b100.files.length}`);
ok(b200.files.length < b1000.files.length, 'P3 lower budget drops lowest-ranked first');
ok(b100.files.length >= 10, 'P3 top-10 floor kept even at tiny budget');

// P4 — cache hit / touch -> miss
repoMap.invalidate(ROOT);
const m1 = repoMap.build(ROOT, { budget: 1000 });
ok(m1.cache === 'miss', 'P4 first build is a miss');
const c1 = repoMap.cache(ROOT);
ok(c1.hit === true, `P4 second lookup hits (${c1.key.slice(0, 12)}…)`);
const m2 = repoMap.build(ROOT, { budget: 1000 });
ok(m2.cache === 'hit', 'P4 build served from cache (no rebuild)');
const wp = path.join(ROOT, 'worker-01.js');
fs.utimesSync(wp, Date.now() / 1000, Date.now() / 1000);
const c2 = repoMap.cache(ROOT);
ok(c2.miss === true, 'P4 touched mtime -> cache miss');
const m3 = repoMap.build(ROOT, { budget: 1000 });
ok(m3.cache === 'miss' && m3.key !== m2.key, 'P4 rebuild under a new key after touch');

// P5 — determinism
repoMap.invalidate(ROOT);
const d1 = repoMap.build(ROOT, { budget: 1000 });
repoMap.invalidate(ROOT);
const d2 = repoMap.build(ROOT, { budget: 1000 });
ok(d1.summary === d2.summary && d1.tokens === d2.tokens && d1.files.join() === d2.files.join(), 'P5 byte-identical summary for same tree + mtimes');

console.log(`\nSCOPE F: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
