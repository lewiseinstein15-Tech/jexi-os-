#!/usr/bin/env node
// scripts/phase-hygiene-runner.mjs — deterministic ARCHIVE-MOVE executor (single pass).
//
// Input : the JSON emitted by scripts/audit-repo-hygiene.mjs (--audit=<file>).
// Output: a move plan (dry-run) or executed `git mv` operations + a manifest.
// Never deletes, never edits file content. Moves whole files, filename preserved.
//
// Usage:
//   node scripts/phase-hygiene-runner.mjs --audit=audit.json                 # dry-run (default)
//   node scripts/phase-hygiene-runner.mjs --audit=audit.json --execute       # git mv + manifest
//   node scripts/phase-hygiene-runner.mjs --audit=audit.json --json          # plan as JSON
//
// RULES (this pass):
//   R1 30-day gate         ageDays > 30 (from the audit's REST/git-derived last-touched date)
//   R2 unreferenced        listed by the audit as unreferenced (rules a–c) — with ONE declared
//                          relaxation: a candidate whose only referrers are files that move in
//                          the SAME batch is still eligible (references stay resolvable). A
//                          candidate referenced by ANY file that stays is NOT moved.
//   R3 probes stay         scripts/phase*-probe.mjs never move and any file they cite stays
//   R4 .md only            no source/asset extension is ever moved
//   R5 not in another zone only repo-root files and research/*.md are eligible
//   R6 risk flags          any path in audit Section 5 is never moved
//   R7 index-referenced    any path named in docs/README-INDEX.md is never moved
//   R8 operational roots   AGENTS.md, CLAUDE.md, README.md, ZONE-OWNER.md, LICENSE, … never move
//
// CATEGORIES:
//   fixlog/   FIXLOG-*.md at root       (FIXLOG.md itself only if unreferenced)
//   reports/  *-REPORT.md at root
//   plans/    *-PLAN.md at root
//   research/ research/**/*.md unreferenced
//
// Determinism: plan is sorted; no clock reads; the same audit JSON yields the same plan.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ROOT = argv.root ? String(argv.root) : process.cwd();
const AGE_GATE = 30;
if (!argv.audit) { console.error('usage: --audit=<audit.json> [--execute] [--json]'); process.exit(2); }
const audit = JSON.parse(readFileSync(String(argv.audit), 'utf8'));
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27 });
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const trackedSet = new Set(tracked);

// --- protections ---------------------------------------------------------------
const OPERATIONAL = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'ZONE-OWNER.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'ARCHITECTURE.md', 'DEPLOY.md', 'DEPLOYMENT.md', 'TEST.md', 'WATCH.md', 'SCALING.md', 'ANDROID.md', 'DATA_SOURCES.md', 'AGENT-CATALOG.md']);
const riskPaths = new Set(audit.section5.riskFlags.map((r) => r.replace(/^RISK: /, '').split(' — ')[0]));
const indexText = existsSync(join(ROOT, 'docs/README-INDEX.md')) ? readFileSync(join(ROOT, 'docs/README-INDEX.md'), 'utf8') : '';
const probeFiles = tracked.filter((f) => /^scripts\/phase\d+[-\w.]*-probe\.(mjs|js|sh|cjs)$/.test(f));
const probeText = probeFiles.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');

// --- candidate universe: every root FIXLOG / *-REPORT / *-PLAN .md + research/**/*.md ------------
function category(p) {
  const b = basename(p);
  if (!p.includes('/')) {
    if (/^FIXLOG.*\.md$/.test(b)) return 'fixlog';
    if (/-REPORT\.md$/.test(b)) return 'reports';
    if (/-PLAN\.md$/.test(b)) return 'plans';
    return null;
  }
  if (p.startsWith('research/') && b.endsWith('.md')) return 'research';
  return null;
}
const universe = tracked.filter((p) => category(p) !== null).sort();

// reference facts from the audit
const ageOf = new Map();
const unrefSet = new Set();
for (const x of audit.section1.unreferencedButYoung) { unrefSet.add(x.path); ageOf.set(x.path, x.ageDays); }
for (const x of audit.section1.deadCandidates) { unrefSet.add(x.path); ageOf.set(x.path, x.ageDays); }
for (const x of audit.section3.historicalArtifacts) if (!ageOf.has(x.path) && x.lastTouchedDate && audit.meta.ageReference && !audit.meta.ageReference.startsWith('(')) {
  ageOf.set(x.path, Math.floor((Date.parse(audit.meta.ageReference) - Date.parse(x.lastTouchedDate)) / 86400000));
}

// textual referrers (basename search across tracked text files) — recomputed here so the
// "same-batch" relaxation can be evaluated exactly.
const textCache = new Map();
function text(f) { if (!textCache.has(f)) { try { const b = readFileSync(join(ROOT, f)); textCache.set(f, b.subarray(0, 4096).includes(0) ? '' : b.toString('utf8')); } catch { textCache.set(f, ''); } } return textCache.get(f); }
const TEXT_EXT = /\.(md|js|mjs|cjs|jsx|ts|json|ya?ml|sh|txt|html|css)$/;
const textFiles = tracked.filter((f) => TEXT_EXT.test(f));
function referrersOf(p) { const b = basename(p); const out = []; for (const f of textFiles) { if (f === p) continue; if (text(f).includes(b)) out.push(f); } return out.sort(); }

// --- pass 1: rule evaluation --------------------------------------------------------
const decisions = [];
for (const p of universe) {
  const cat = category(p); const b = basename(p);
  const age = ageOf.get(p) ?? null;
  const reasons = []; const blocks = [];
  if (OPERATIONAL.has(b)) blocks.push('R8 operational root file');
  if (riskPaths.has(p)) blocks.push('R6 audit Section 5 risk flag');
  if (indexText.includes(b)) blocks.push('R7 referenced by docs/README-INDEX.md');
  if (probeText.includes(b)) blocks.push('R3 referenced by a phase probe script');
  if (!b.endsWith('.md')) blocks.push('R4 not a .md file');
  if (age === null) blocks.push('R1 age unknown');
  else if (age <= AGE_GATE) blocks.push(`R1 age ${age}d ≤ ${AGE_GATE}d`);
  else reasons.push(`age ${age}d > ${AGE_GATE}d`);
  const refs = referrersOf(p);
  decisions.push({ path: p, category: cat, age, refs, blocks, reasons });
}
// pass 2: reference rule with same-batch relaxation (iterate to a fixed point)
let changed = true;
const eligible = new Set(decisions.filter((d) => d.blocks.length === 0).map((d) => d.path));
while (changed) {
  changed = false;
  for (const d of decisions) {
    if (!eligible.has(d.path)) continue;
    const staying = d.refs.filter((r) => !eligible.has(r));
    if (staying.length) { eligible.delete(d.path); d.blocks.push(`R2 referenced by staying file(s): ${staying.join(', ')}`); changed = true; }
  }
}
for (const d of decisions) {
  if (eligible.has(d.path)) {
    d.reasons.push(d.refs.length ? `R2 only referrers move in the same batch (${d.refs.join(', ')})` : 'R2 zero inbound references');
    d.reasons.push('R3/R4/R5/R6/R7/R8 clear');
  }
}
const plan = decisions.filter((d) => eligible.has(d.path)).map((d) => ({ from: d.path, to: `docs/archive/${d.category}/${basename(d.path)}`, category: d.category, reason: d.reasons.join('; ') })).sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.from < b.from ? -1 : 1));
const skipped = decisions.filter((d) => !eligible.has(d.path)).map((d) => ({ path: d.path, category: d.category, age: d.age, blocks: d.blocks }));

// collision guard
for (const m of plan) if (trackedSet.has(m.to)) { console.error(`BLOCKER: target already tracked: ${m.to}`); process.exit(3); }

// --- output --------------------------------------------------------------------------
const byCat = {}; for (const m of plan) (byCat[m.category] ??= []).push(m);
if (argv.json) { console.log(JSON.stringify({ ageGate: AGE_GATE, plan, skipped }, null, 2)); }
else {
  console.log(`PLAN (${argv.execute ? 'EXECUTE' : 'DRY-RUN'}) — age gate > ${AGE_GATE} days — universe ${universe.length} — moves ${plan.length} — skipped ${skipped.length}`);
  for (const cat of ['fixlog', 'reports', 'plans', 'research']) {
    const list = byCat[cat] ?? [];
    console.log(`\n[${cat}] ${list.length} move(s) -> docs/archive/${cat}/`);
    for (const m of list) console.log(`  ${m.from}  ->  ${m.to}`);
  }
  console.log(`\nSKIPPED (${skipped.length}):`);
  for (const s of skipped) console.log(`  ${s.path}  [${s.blocks.join(' | ')}]`);
}

if (argv.execute) {
  let count = 0;
  for (const m of plan) {
    mkdirSync(join(ROOT, dirname(m.to)), { recursive: true });
    git(['mv', '--', m.from, m.to]); count++;
  }
  const lines = ['# docs/archive — MANIFEST', '', `Produced by \`scripts/phase-hygiene-runner.mjs --execute\` from the audit JSON of \`scripts/audit-repo-hygiene.mjs\` (age gate > ${AGE_GATE} days). Every entry is a \`git mv\` — content byte-identical, history preserved (\`git log --follow\`).`, '', `Total moves: ${plan.length}`, '', '| # | old path | new path | category | reason |', '|---|---|---|---|---|'];
  plan.forEach((m, i) => lines.push(`| ${i + 1} | \`${m.from}\` | \`${m.to}\` | ${m.category} | ${m.reason} |`));
  lines.push('', '## Evaluated but NOT moved', '', '| path | blocked by |', '|---|---|');
  for (const s of skipped) lines.push(`| \`${s.path}\` | ${s.blocks.join('; ')} |`);
  mkdirSync(join(ROOT, 'docs/archive'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/archive/MANIFEST.md'), lines.join('\n') + '\n');
  writeFileSync(join(ROOT, 'docs/archive/MANIFEST.json'), JSON.stringify({ ageGate: AGE_GATE, moves: plan, skipped }, null, 2) + '\n');
  console.log(`\nEXECUTED: ${count} git mv; manifest written to docs/archive/MANIFEST.md + MANIFEST.json`);
}
