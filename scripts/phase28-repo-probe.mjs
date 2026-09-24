/**
 * JEXI OS — Phase 28 Scope A probe — brain repo + page schema.
 * P1 layout + create · P2 append timeline · P3 sync delta ·
 * P4 error codes · P5 determinism.  Real files under a temp brain root.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepo } from '../mind/brain/repo/index.js';

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label + (extra ? ' — ' + extra : '')); }
};
const throwsCode = (fn, code, label) => {
  try { fn(); fail++; console.log('FAIL ' + label + ' — did not throw'); }
  catch (e) {
    if (e && e.code === code) { pass++; console.log(`PASS ${label} (${code})`); }
    else { fail++; console.log('FAIL ' + label + ' — threw ' + (e && e.code) + ': ' + e.message); }
  }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28a-'));
const repo = createRepo(root);
const T0 = '2026-09-22T04:00:00Z';

// ── P1: create 3 kinds -> layout + pages ──
console.log('── P1 create across 3 kinds ──');
repo.create('people', 'ada-lovelace', { title: 'Ada Lovelace', compiledTruth: 'Mathematician; first programmer.', tags: [' pioneer'], now: T0 });
repo.create('companies', 'analytical-engine-co', { title: 'Analytical Engine Co', compiledTruth: 'Victorian computing venture.', tags: ['history'], now: T0 });
repo.create('concepts', 'compiled-truth', { title: 'Compiled Truth', compiledTruth: 'Current-best summary + append-only timeline.', tags: ['pattern'], now: T0 });
const tree = [];
for (const dir of fs.readdirSync(root).sort()) {
  if (dir === '.brain') continue;
  for (const f of fs.readdirSync(path.join(root, dir)).sort()) tree.push(`${dir}/${f}`);
}
console.log('P1 layout:', tree.join(' | '));
ok(tree.length === 3 && tree[0] === 'companies/analytical-engine-co.md' && tree[1] === 'concepts/compiled-truth.md' && tree[2] === 'people/ada-lovelace.md',
  'P1 three kinds -> three MECE directories, one page each');
const adaRaw = fs.readFileSync(path.join(root, 'people/ada-lovelace.md'), 'utf8');
console.log('P1 people/ada-lovelace.md:\n' + adaRaw.split('\n').map((l) => '    ' + l).join('\n'));
ok(adaRaw.startsWith('---\nkind: people\nslug: ada-lovelace\n'), 'P1 frontmatter canonical key order (kind first)');
ok(adaRaw.includes('## Compiled Truth') && adaRaw.includes('## Timeline'), 'P1 both sections present');

// ── P2: append timeline -> compiled truth unchanged, timeline grew ──
console.log('── P2 append timeline ──');
const before = repo.compile('people', 'ada-lovelace');
repo.append('people', 'ada-lovelace', { entry: 'Met Charles Babbage at a salon.', when: '2026-09-22T04:10:00Z' });
repo.append('people', 'ada-lovelace', { entry: 'Published the first algorithm.', when: '2026-09-22T04:05:00Z' });
const after = repo.compile('people', 'ada-lovelace');
console.log('P2 before: compiledTruth=' + JSON.stringify(before.compiledTruth) + ' timeline=' + before.timeline.length);
console.log('P2 after:  compiledTruth=' + JSON.stringify(after.compiledTruth) + ' timeline=' + after.timeline.length + ' order=' + after.timeline.map((e) => e.when.slice(11, 16)).join(','));
ok(before.compiledTruth === after.compiledTruth, 'P2 compiled truth UNCHANGED by appends');
ok(after.timeline.length === before.timeline.length + 2, 'P2 timeline grew by exactly 2');
ok(after.timeline[0].when === '2026-09-22T04:05:00Z' && after.timeline[1].when === '2026-09-22T04:10:00Z',
  'P2 timeline ordered by when asc (out-of-order insert sorted)');

// ── P3: sync delta ──
console.log('── P3 sync ──');
const s1 = repo.sync();
console.log('P3 first sync:', JSON.stringify(s1));
ok(s1.added.length === 3 && s1.modified.length === 0 && s1.removed.length === 0, 'P3 first sync: 3 added');
repo.append('companies', 'analytical-engine-co', { entry: 'Raised capital.', when: '2026-09-22T04:20:00Z' });
repo.create('meetings', 'salon-1843', { title: 'Salon 1843', now: '2026-09-22T04:25:00Z' });
fs.rmSync(path.join(root, 'concepts/compiled-truth.md'));
const s2 = repo.sync();
console.log('P3 second sync:', JSON.stringify(s2));
ok(s2.added.length === 1 && s2.added[0] === 'meetings/salon-1843.md', 'P3 sync detects added');
ok(s2.modified.length === 1 && s2.modified[0] === 'companies/analytical-engine-co.md', 'P3 sync detects modified');
ok(s2.removed.length === 1 && s2.removed[0] === 'concepts/compiled-truth.md', 'P3 sync detects removed');
const s3 = repo.sync();
ok(s3.added.length === 0 && s3.modified.length === 0 && s3.removed.length === 0, 'P3 sync idempotent (empty delta on no change)');

// ── P4: errors ──
console.log('── P4 errors ──');
throwsCode(() => repo.create('robots', 'x', { title: 'X', now: T0 }), 'E_UNKNOWN_KIND', 'P4 unknown kind refused');
throwsCode(() => repo.read('people', 'nobody-here'), 'E_UNKNOWN_PAGE', 'P4 missing slug refused');
throwsCode(() => repo.append('people', 'nobody-here', { entry: 'x', when: T0 }), 'E_UNKNOWN_PAGE', 'P4 append to missing page refused');

// ── P5: determinism ──
console.log('── P5 determinism ──');
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p28a-b-'));
const repo2 = createRepo(root2);
const build = (r) => {
  r.create('people', 'ada-lovelace', { title: 'Ada Lovelace', compiledTruth: 'Mathematician; first programmer.', tags: [' pioneer'], now: T0 });
  r.append('people', 'ada-lovelace', { entry: 'Met Charles Babbage at a salon.', when: '2026-09-22T04:10:00Z' });
  r.append('people', 'ada-lovelace', { entry: 'Published the first algorithm.', when: '2026-09-22T04:05:00Z' });
  return fs.readFileSync(path.join(r.root, 'people/ada-lovelace.md'), 'utf8');
};
const a = build(repo2);
const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'p28a-c-'));
const b = build(createRepo(root3));
ok(a === b, 'P5 same operations in fresh roots -> byte-identical pages');
const syncA = JSON.stringify(createRepo(root2).sync());
const syncB = JSON.stringify(createRepo(root3).sync());
ok(syncA === syncB, 'P5 sync manifests byte-identical across identical roots');

console.log('');
console.log('SCOPE A: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
