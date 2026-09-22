#!/usr/bin/env node
// scripts/phase31-scope-4-execute.mjs — Phase 31 Scope 4-execute: root-file cleanup runner.
//
// Deterministic, MOVE-ONLY executor for the lead-defined root cleanup. Reads the
// inventory (docs/FILE-TREE-INVENTORY.md) for the root-file universe, applies the
// rules below, prints a dry-run plan grouped by destination, and on --execute runs
// `git mv` and writes docs/archive/ROOT-CLEANUP-MANIFEST.md. Never edits content,
// never deletes. Zero dependencies.
//
// Usage:
//   node scripts/phase31-scope-4-execute.mjs --inventory=docs/FILE-TREE-INVENTORY.md \
//        --dates=<root-dates.json> --now=<ISO> [--execute] [--json]
//
// RULES
//   MOVE 1  FIXLOG-B*.md at root -> docs/archive/fixlog/   unless: pinned (B51/B52/B53/B68/B216),
//           referenced by an operational file (README.md, AGENTS.md, AGENT-CATALOG.md,
//           ZONE-OWNER.md, package.json, .github/workflows/**), referenced by a probe under
//           scripts/, referenced by any file outside the moving batch, or touched < 14 days ago.
//           Lead-confirmed relaxation: references from files that move in the SAME batch do not block.
//   MOVE 2  *-REPORT.md at root -> docs/archive/reports/  unless referenced by an operational file
//           or touched < 14 days ago (same age gate as MOVE 1, applied uniformly to archive moves).
//   MOVE 3..7 named root docs -> docs/deploy|design|architecture|guides|docs/ .
//           Lead-confirmed: a doc referenced by read-only CODE/TESTS (server/**, scripts/phase*)
//           is BLOCKED and stays (reported); a doc referenced only by other docs moves.
//   MOVE 8  four misc artifacts to fixed destinations.
//   EXCLUDE list is hard-coded and always wins.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ROOT = argv.root ? String(argv.root) : process.cwd();
const AGE_GATE = 14;
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27 });
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const trackedSet = new Set(tracked);

// --- inputs ---------------------------------------------------------------------------
const inventoryPath = argv.inventory ? String(argv.inventory) : join(ROOT, 'docs/FILE-TREE-INVENTORY.md');
const inventory = existsSync(inventoryPath) ? readFileSync(inventoryPath, 'utf8') : '';
// root-file universe = rows of the inventory's A.1 tables (`path` in first column, no '/')
const invRoot = new Set([...inventory.matchAll(/^\| `([^`/]+)` \| [\d,]+ \| /gm)].map((m) => m[1]));
const rootNow = tracked.filter((f) => !f.includes('/'));
const dates = argv.dates ? JSON.parse(readFileSync(String(argv.dates), 'utf8')) : {};
const NOW = argv.now ? Date.parse(String(argv.now)) : null;
const ageOf = (f) => (dates[f]?.date && NOW ? Math.floor((NOW - Date.parse(dates[f].date)) / 86400000) : null);

// --- rule tables ---------------------------------------------------------------------
const EXCLUDE = new Set(['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'AGENTS.md', 'AGENT-CATALOG.md', 'ZONE-OWNER.md', 'FIXLOG.md', 'tsconfig.json', 'package.json', 'package-lock.json', 'bun.lock', 'Dockerfile', 'Dockerfile.slim', '.dockerignore', 'docker-compose.yml', 'render.yaml', '.gitignore', '.env.example', '.env.production', 'index.html', 'capacitor.config.json', 'mcp.example.json']);
const isConfig = (f) => /\.config\.js$/.test(f) || EXCLUDE.has(f);
const PINNED_FIXLOG = new Set(['FIXLOG-B51.md', 'FIXLOG-B52.md', 'FIXLOG-B53.md', 'FIXLOG-B68.md', 'FIXLOG-B216.md']);
const NAMED = {
  'docs/deploy': ['DEPLOY.md', 'DEPLOYMENT.md', 'DEPLOY-IMAGE-RENDER.md'],
  'docs/design': ['AUTONOMY-DESIGN.md', 'UI-DESIGN-PROMPT.md'],
  'docs/architecture': ['ARCHITECTURE.md'],
  'docs/guides': ['ANDROID.md'],
  'docs': ['DATA_SOURCES.md', 'DSH-PARITY.md', 'SCALING.md', 'TEST.md', 'WATCH.md'],
};
const MISC = { 'AGENT_ONLINE.txt': 'docs/archive/misc/AGENT_ONLINE.txt', 'demo-banner.jpg': 'docs/assets/demo-banner.jpg', 'demo-index.html': 'docs/archive/misc/demo-index.html', 'b221-verify.cjs': 'scripts/tools/b221-verify.cjs' };
const OPERATIONAL = ['README.md', 'AGENTS.md', 'AGENT-CATALOG.md', 'ZONE-OWNER.md', 'package.json', ...tracked.filter((f) => f.startsWith('.github/workflows/'))];
const PROBES = tracked.filter((f) => /^scripts\/(phase\d+|zone-owner)[-\w.]*\.(mjs|js|sh|cjs)$/.test(f));
const CODE = tracked.filter((f) => /\.(js|mjs|cjs|jsx|ts|sh|ya?ml)$/.test(f) && !f.startsWith('docs/') && f !== 'scripts/phase31-scope-4-execute.mjs' && f !== 'scripts/phase-hygiene-runner.mjs');

const cache = new Map();
const text = (f) => { if (!cache.has(f)) { try { const b = readFileSync(join(ROOT, f)); cache.set(f, b.subarray(0, 4096).includes(0) ? '' : b.toString('utf8')); } catch { cache.set(f, ''); } } return cache.get(f); };
const TEXT = /\.(md|js|mjs|cjs|jsx|ts|json|ya?ml|sh|txt|html|css)$/;
const textFiles = tracked.filter((f) => TEXT.test(f) && f !== 'scripts/phase31-scope-4-execute.mjs' && f !== 'scripts/phase-hygiene-runner.mjs' && !f.startsWith('docs/archive/MANIFEST') && f !== 'docs/FILE-TREE-INVENTORY.md');
// exact-basename match (FIXLOG-B56 vs FIXLOG-B56.md both count; DEPLOY.md must not match DEPLOYMENT.md)
const refsOf = (f, pool) => { const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const body = /^FIXLOG-B/.test(f) ? esc.replace(/\\\.md$/, '(\\.md)?') : esc; const re = new RegExp('(^|[^A-Za-z0-9_-])' + body + '(?![A-Za-z0-9_-])'); return pool.filter((p) => p !== f && re.test(text(p))).sort(); };

// --- evaluation ------------------------------------------------------------------------
const decisions = [];
function consider(path, dest, group, extraChecks) {
  if (!trackedSet.has(path)) { decisions.push({ path, group, dest, status: 'ABSENT', blocks: ['not at root on this tree (already moved / never existed)'] }); return; }
  const blocks = [];
  if (isConfig(path)) blocks.push('EXCLUDE list / config');
  if (!invRoot.has(path) && inventory) blocks.push('not in inventory A.1 root list');
  const opRefs = refsOf(path, OPERATIONAL); if (opRefs.length) blocks.push(`referenced by operational file(s): ${opRefs.join(', ')}`);
  const probeRefs = refsOf(path, PROBES); if (probeRefs.length) blocks.push(`referenced by probe(s): ${probeRefs.join(', ')}`);
  for (const b of extraChecks(path)) blocks.push(b);
  decisions.push({ path, group, dest: dest + '/' + basename(path), status: blocks.length ? 'SKIP' : 'MOVE', blocks, age: ageOf(path), refs: refsOf(path, textFiles) });
}
const ageCheck = (p) => { const a = ageOf(p); return a === null ? ['age unknown'] : a < AGE_GATE ? [`age ${a}d < ${AGE_GATE}d`] : []; };
const codeCheck = (p) => { const r = refsOf(p, CODE); return r.length ? [`referenced by read-only code/tests: ${r.join(', ')} (lead: BLOCKED)`] : []; };

// MOVE 1
for (const f of rootNow.filter((f) => /^FIXLOG-B.*\.md$/.test(f)).sort()) consider(f, 'docs/archive/fixlog', 'MOVE 1 fixlog', (p) => [...(PINNED_FIXLOG.has(p) ? ['pinned (lead list)'] : []), ...ageCheck(p)]);
// MOVE 2
for (const f of rootNow.filter((f) => /-REPORT\.md$/.test(f) && !/^FIXLOG/.test(f)).sort()) consider(f, 'docs/archive/reports', 'MOVE 2 reports', ageCheck);
// MOVE 3..7
let n = 3;
for (const [dest, list] of Object.entries(NAMED)) { for (const f of list) consider(f, dest, `MOVE ${n} ${dest}`, codeCheck); n++; }
// MOVE 8
for (const [f, to] of Object.entries(MISC)) consider(f, dirname(to), 'MOVE 8 misc', () => []);

// same-batch relaxation for the archive groups (docs-only referrers that also move)
let changed = true;
while (changed) {
  changed = false;
  for (const d of decisions) {
    if (d.status !== 'MOVE') continue;
    const moving = new Set(decisions.filter((x) => x.status === 'MOVE').map((x) => x.path));
    const staying = d.refs.filter((r) => !moving.has(r) && !r.startsWith('docs/archive/') && !/^docs\/.*\.md$/.test(r) && !r.startsWith('docs/'));
    // staying = referrers that are neither moving nor docs (docs-to-docs links are reported, not blocking)
    if (staying.length) { d.status = 'SKIP'; d.blocks.push(`referenced by staying non-doc file(s): ${staying.join(', ')}`); changed = true; }
  }
}
const plan = decisions.filter((d) => d.status === 'MOVE').sort((a, b) => (a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : a.path < b.path ? -1 : 1));
const skipped = decisions.filter((d) => d.status !== 'MOVE');
for (const m of plan) if (trackedSet.has(m.dest)) { console.error(`BLOCKER: destination already tracked: ${m.dest}`); process.exit(3); }

// docs that reference a moving file and stay (for the reference-update step; reported only)
const docRefs = [];
for (const m of plan) for (const r of m.refs) if (r.startsWith('docs/') && !plan.some((x) => x.path === r)) docRefs.push({ movedFile: m.path, doc: r });

// --- output ----------------------------------------------------------------------------
if (argv.json) console.log(JSON.stringify({ plan, skipped, docRefs }, null, 2));
else {
  console.log(`PLAN (${argv.execute ? 'EXECUTE' : 'DRY-RUN'}) — root files now ${rootNow.length} — moves ${plan.length} — skipped ${skipped.length}`);
  const byDest = {}; for (const m of plan) (byDest[dirname(m.dest)] ??= []).push(m);
  for (const dest of Object.keys(byDest).sort()) { console.log(`\n-> ${dest}/  (${byDest[dest].length})`); for (const m of byDest[dest]) console.log(`   ${m.path}  ->  ${m.dest}`); }
  console.log(`\nSKIPPED (${skipped.length}):`); for (const s of skipped) console.log(`   ${s.path}  [${s.status}] ${s.blocks.join(' | ')}`);
  console.log(`\nDOC REFERENCES TO MOVED FILES (staying docs; path updates to review): ${docRefs.length}`); for (const r of docRefs) console.log(`   ${r.doc}  mentions  ${r.movedFile}`);
}

if (argv.execute) {
  let count = 0;
  for (const m of plan) { mkdirSync(join(ROOT, dirname(m.dest)), { recursive: true }); git(['mv', '--', m.path, m.dest]); count++; }
  const L = ['# ROOT CLEANUP — MANIFEST (Phase 31 Scope 4-execute)', '', `Produced by \`scripts/phase31-scope-4-execute.mjs --execute\`. Input: \`docs/FILE-TREE-INVENTORY.md\` (root universe) + last-touched dates. Every move is a \`git mv\` (content byte-identical, history preserved). Age gate for archive moves: ${AGE_GATE} days.`, '', `Moves: ${plan.length} · Skipped: ${skipped.length}`, '', '## Moved', '', '| # | old path | new path | group | reason |', '|---|---|---|---|---|'];
  plan.forEach((m, i) => L.push(`| ${i + 1} | \`${m.path}\` | \`${m.dest}\` | ${m.group} | ${m.age !== null ? `age ${m.age}d; ` : ''}${m.refs.length ? `referrers: ${m.refs.join(', ')}` : 'no inbound references'} |`));
  L.push('', '## Skipped (still at root)', '', '| path | group | status | reason |', '|---|---|---|---|');
  for (const s of skipped) L.push(`| \`${s.path}\` | ${s.group} | ${s.status} | ${s.blocks.join('; ')} |`);
  L.push('', '## Staying docs that mention a moved file', '', '| doc | mentions |', '|---|---|');
  for (const r of docRefs) L.push(`| \`${r.doc}\` | \`${r.movedFile}\` |`);
  mkdirSync(join(ROOT, 'docs/archive'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/archive/ROOT-CLEANUP-MANIFEST.md'), L.join('\n') + '\n');
  console.log(`\nEXECUTED: ${count} git mv; manifest docs/archive/ROOT-CLEANUP-MANIFEST.md`);
}
