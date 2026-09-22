#!/usr/bin/env node
// scripts/audit-repo-hygiene.mjs — READ-ONLY repo hygiene scanner (report-only).
//
// Walks the tracked tree (git ls-files) and emits deterministic, structured
// findings as JSON on stdout. It never writes, moves, renames, or deletes
// anything. Zero dependencies (node:fs, node:path, node:child_process only).
//
// Usage:
//   node scripts/audit-repo-hygiene.mjs [--root=<repo>] [--dates=<json>] [--json|--summary]
//
// --dates=<json>  optional { "<path>": { "date": ISO, "sha": <commit> } } map
//                 giving each file's last-touching commit. Used when the local
//                 clone has no usable history (shallow / REST-reconstructed).
//                 When absent, `git log --name-only` over the local history is
//                 used. The source actually used is declared in `meta.dates`.
//
// Sections (mirror docs/REPO-AUDIT.md):
//   1 deadCandidates      unreferenced + non-entry + age gate (90 days)
//   2 duplicates          same basename in >1 location, >80% line overlap;
//                         plus byte-identical content groups
//   3 historicalArtifacts FIXLOG-*.md, *-REPORT.md, *-AUDIT.md, *-LOG.md, logs/
//   4 structure           top-level directory inventory (facts; proposal is prose)
//   5 riskFlags           dead/duplicate candidates that overlap a protected zone
//
// Determinism: output contains no clock reads and every list is sorted.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, extname, dirname } from 'node:path';

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const ROOT = argv.root ? String(argv.root) : process.cwd();
const NOW_ISO = argv.now ? String(argv.now) : null; // ONLY for the age gate; declared in meta
const AGE_DAYS = 90;

// ---------------------------------------------------------------------------
// Protected zones — nothing under these is ever classified "dead".
// ---------------------------------------------------------------------------
const PROTECTED = [
  { prefix: 'server/', owner: 'Phase 31 (wiring, in flight) + runtime' },
  { prefix: 'brain/', owner: 'Phase 28 (persistent brain)' },
  { prefix: 'computer/', owner: 'Phase 29 (computer agent)' },
  { prefix: 'harness/parity/', owner: 'Phase 30 (harness parity)' },
  { prefix: 'ui/', owner: 'Phase 16/24 console + Phase 31 console wiring' },
  { prefix: 'scheduler/', owner: 'Phase 31 scheduler wiring' },
  { prefix: 'events/', owner: 'Phase 16 taxonomy (consumed by Phase 29 K, Phase 31)' },
  { prefix: 'hooks/', owner: 'Phase 30 hook catalog target (Phase 31 dispatch)' },
  { prefix: 'providers/', owner: 'Phase 27 keyRef discipline (consumed by Phase 29 J)' },
  { prefix: 'skills/', owner: 'runtime skill library (directory-scanned, dynamic discovery)' },
  { prefix: 'agents/', owner: 'agent catalog (directory-scanned, dynamic discovery)' },
  { prefix: 'jexi-agents/', owner: 'agent catalog (directory-scanned)' },
  { prefix: 'src/', owner: 'Vite app (bundled entry graph)' },
  { prefix: '.github/', owner: 'CI/CD workflows' },
  { prefix: 'android/', owner: 'Capacitor APK build (CI: apk.yml)' },
];
const PHASE_PROBE_RE = /^scripts\/(phase\d+|zone-owner)[-\w.]*\.(mjs|js|sh|cjs)$/;

// Entry points / config roots — never dead by definition.
const ENTRY_EXACT = new Set([
  'index.html', 'demo-index.html', 'package.json', 'package-lock.json', 'bun.lock', 'vite.config.js',
  'tailwind.config.js', 'postcss.config.js', 'capacitor.config.json', 'render.yaml', 'docker-compose.yml',
  'Dockerfile', 'Dockerfile.slim', 'LICENSE', 'README.md', 'AGENTS.md', 'ZONE-OWNER.md', 'THIRD_PARTY_NOTICES.md',
  'mcp.example.json', '.gitignore', '.dockerignore',
]);
const ENTRY_BASENAMES = new Set(['README.md', 'SKILL.md', 'package.json', 'index.js', 'index.mjs', 'index.html', '.gitignore', '.dockerignore', 'LICENSE']);
const TEST_RE = /(^|\/)(tests?\/|test-[^/]+\.(js|mjs|cjs)$|[^/]+\.test\.(js|mjs|jsx)$|[^/]+\.spec\.(js|mjs)$)/;
const CONFIG_RE = /(^|\/)(\.eslintrc[^/]*|eslint\.config\.js|\.prettierrc[^/]*|tsconfig[^/]*\.json|jsconfig\.json|babel\.config\.js|vitest\.config\.[jt]s|playwright\.config\.[jt]s|\.env\.example|\.npmrc|\.nvmrc)$/;
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.jar', '.keystore', '.db', '.sqlite']);

// ---------------------------------------------------------------------------
// Tracked file list + contents
// ---------------------------------------------------------------------------
function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); }
const files = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
const fileSet = new Set(files);

const contents = new Map(); // path -> string (text files only)
const sizes = new Map();
const lines = new Map();
for (const f of files) {
  const abs = join(ROOT, f);
  let st; try { st = statSync(abs); } catch { continue; }
  if (st.isSymbolicLink() || !st.isFile()) { sizes.set(f, 0); lines.set(f, 0); continue; }
  sizes.set(f, st.size);
  if (BINARY_EXT.has(extname(f).toLowerCase())) { lines.set(f, 0); continue; }
  const buf = readFileSync(abs);
  if (buf.subarray(0, 4096).includes(0)) { lines.set(f, 0); continue; } // binary sniff
  const txt = buf.toString('utf8');
  contents.set(f, txt);
  lines.set(f, txt.length === 0 ? 0 : txt.split('\n').length - (txt.endsWith('\n') ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Reference index: path-like tokens per file (basename / stem / path segments)
// ---------------------------------------------------------------------------
const TOKEN_RE = /[A-Za-z0-9_@][A-Za-z0-9_.\-/@]*[A-Za-z0-9_]/g;
const tokenIndex = new Map(); // token -> Set(files containing it)
for (const [f, txt] of contents) {
  const seen = new Set();
  for (const m of txt.matchAll(TOKEN_RE)) {
    const t = m[0];
    if (t.length < 3 || t.length > 200) continue;
    if (seen.has(t)) continue; seen.add(t);
    // index the full token, its basename, and the basename stem
    const b = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t;
    for (const key of new Set([t, b, b.replace(/\.[A-Za-z0-9]+$/, '')])) {
      if (key.length < 3) continue;
      let s = tokenIndex.get(key); if (!s) tokenIndex.set(key, (s = new Set()));
      s.add(f);
    }
  }
}
function referrers(f) {
  const b = basename(f);
  const stem = b.replace(/\.[A-Za-z0-9]+$/, '');
  const keys = new Set([f, b]);
  if (stem.length >= 3 && stem !== b) keys.add(stem);
  const out = new Set();
  for (const k of keys) for (const r of tokenIndex.get(k) ?? []) if (r !== f) out.add(r);
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Last-touched dates
// ---------------------------------------------------------------------------
let dates = null; let datesSource = 'none';
if (argv.dates) {
  dates = JSON.parse(readFileSync(String(argv.dates), 'utf8'));
  datesSource = `external map (${basename(String(argv.dates))}) — REST-derived when local history is unavailable`;
} else {
  const commitCount = Number(git(['rev-list', '--count', 'HEAD']).trim());
  if (commitCount > 1) {
    dates = {};
    const log = git(['log', '--format=%x00%H %cI', '--name-only']);
    let cur = null;
    for (const line of log.split('\n')) {
      if (line.startsWith('\0')) { const [sha, date] = line.slice(1).split(' '); cur = { sha, date }; continue; }
      if (line && cur && !dates[line]) dates[line] = cur;
    }
    datesSource = `git log --name-only (local history, ${commitCount} commits)`;
  } else {
    datesSource = `unavailable (local history has ${commitCount} commit; pass --dates)`;
  }
}
function ageDays(f) {
  if (!dates || !dates[f] || !NOW_ISO) return null;
  return Math.floor((Date.parse(NOW_ISO) - Date.parse(dates[f].date)) / 86400000);
}

// ---------------------------------------------------------------------------
// Section 1 — dead candidates
// ---------------------------------------------------------------------------
function protectedZone(f) {
  for (const z of PROTECTED) if (f.startsWith(z.prefix)) return z;
  if (PHASE_PROBE_RE.test(f)) return { prefix: 'scripts/phase*-probe', owner: 'merged-phase acceptance probes (re-run by cross-verify)' };
  return null;
}
function isEntry(f) {
  if (ENTRY_EXACT.has(f)) return 'entry:root-config';
  if (ENTRY_BASENAMES.has(basename(f))) return 'entry:index/readme/manifest';
  if (TEST_RE.test(f)) return 'entry:test';
  if (CONFIG_RE.test(f)) return 'entry:config';
  if (f.startsWith('.github/')) return 'entry:workflow';
  return null;
}
// package.json scripts + workflow bodies as an explicit "wired" set
const wiredText = [];
for (const f of files) if (basename(f) === 'package.json' || f.startsWith('.github/workflows/')) wiredText.push(contents.get(f) ?? '');
const WIRED = wiredText.join('\n');

const deadCandidates = []; const futureWiring = []; const unreferencedButYoung = [];
for (const f of files) {
  const entry = isEntry(f); if (entry) continue;
  const refs = referrers(f);
  const inWired = WIRED.includes(basename(f)) || WIRED.includes(f);
  if (refs.length > 0 || inWired) continue;
  const rulesFired = ['no-inbound-reference (basename/stem/path not found in any other tracked text file)', 'not-in-package.json-scripts-or-workflows', 'not-an-entry-point'];
  const rec = {
    path: f,
    topLevel: f.includes('/') ? f.slice(0, f.indexOf('/')) : '(root)',
    bytes: sizes.get(f) ?? 0,
    lines: lines.get(f) ?? 0,
    lastTouchedCommit: dates?.[f]?.sha ?? null,
    lastTouchedDate: dates?.[f]?.date ?? null,
    ageDays: ageDays(f),
  };
  const zone = protectedZone(f);
  if (zone) { futureWiring.push({ ...rec, zone: zone.prefix, owner: zone.owner, verdict: 'POTENTIAL FUTURE WIRING — DO NOT DELETE', rulesFired }); continue; }
  const age = rec.ageDays;
  if (age !== null && age > AGE_DAYS) { deadCandidates.push({ ...rec, rulesFired: [...rulesFired, `last-touched > ${AGE_DAYS} days`], verdict: 'DEAD CANDIDATE' }); }
  else { unreferencedButYoung.push({ ...rec, rulesFired, verdict: age === null ? 'UNREFERENCED (age unknown — 90-day rule NOT evaluable)' : `UNREFERENCED (age ${age}d ≤ ${AGE_DAYS}d — 90-day rule NOT met)` }); }
}

// ---------------------------------------------------------------------------
// Section 2 — duplicates
// ---------------------------------------------------------------------------
const byBase = new Map();
for (const f of contents.keys()) { const b = basename(f); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(f); }
const SKIP_BASE = new Set(['README.md', 'SKILL.md', 'index.js', 'index.mjs', 'package.json', 'package-lock.json', '.gitignore', 'LICENSE', 'schema.js', 'types.js']);
function lineSet(txt) { return new Set(txt.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)); }
function overlap(a, b) { const A = lineSet(a), B = lineSet(b); if (!A.size || !B.size) return 0; let n = 0; for (const l of A) if (B.has(l)) n++; return n / Math.min(A.size, B.size); }
function exportSig(txt) { return [...txt.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]).sort(); }
function headerLine(txt) { const m = txt.match(/^\s*(?:\/\/|#|\/\*|\*)\s*(.{8,120})$/m); return m ? m[1].trim() : ''; }
const duplicates = [];
for (const [b, list] of [...byBase.entries()].sort()) {
  if (SKIP_BASE.has(b) || list.length < 2) continue;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [p, q] = [list[i], list[j]];
    if ((lines.get(p) ?? 0) < 5 || (lines.get(q) ?? 0) < 5) continue;
    const r = overlap(contents.get(p), contents.get(q));
    if (r <= 0.8) continue;
    const dp = dates?.[p]?.date ?? null, dq = dates?.[q]?.date ?? null;
    const older = dp && dq ? (dp <= dq ? p : q) : null;
    const rp = referrers(p).length, rq = referrers(q).length;
    duplicates.push({
      basename: b, paths: [p, q], overlapRatio: Number(r.toFixed(3)), identical: contents.get(p) === contents.get(q),
      sameExportSignature: JSON.stringify(exportSig(contents.get(p))) === JSON.stringify(exportSig(contents.get(q))),
      headers: [headerLine(contents.get(p)), headerLine(contents.get(q))],
      older, referrers: { [p]: rp, [q]: rq },
      protectedZones: [protectedZone(p)?.prefix ?? null, protectedZone(q)?.prefix ?? null],
    });
  }
}
// byte-identical groups across different basenames
const byHash = new Map();
for (const [f, txt] of contents) { if ((lines.get(f) ?? 0) < 5) continue; const k = `${txt.length}:${txt}`; if (!byHash.has(k)) byHash.set(k, []); byHash.get(k).push(f); }
const identicalGroups = [...byHash.values()].filter((g) => g.length > 1).map((g) => g.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map((g) => ({ paths: g, bytes: sizes.get(g[0]), sameBasename: new Set(g.map((p) => basename(p))).size === 1 }));

// ---------------------------------------------------------------------------
// Section 3 — historical artifacts
// ---------------------------------------------------------------------------
const HIST_RE = /^(FIXLOG[-\w.]*\.md|[\w.-]*-(REPORT|AUDIT|LOG)\.md)$/i;
const histFiles = files.filter((f) => {
  const b = basename(f); const dir = dirname(f);
  if (/^FIXLOG/i.test(b)) return true; // FIXLOG-* anywhere
  if (dir === '.' && HIST_RE.test(b)) return true; // *-REPORT/AUDIT/LOG at repo root
  if (/(^|\/)(logs?|FIXLOG)\//.test(f)) return true; // leftover log dirs
  return false;
}).sort();
const docRefText = [...contents.entries()].filter(([f]) => f.startsWith('docs/') || f === 'README.md').map(([f, t]) => [f, t]);
const fixlogNums = histFiles.map((f) => { const m = basename(f).match(/FIXLOG-B(\d+)(?:-B(\d+))?\.md$/); return m ? { f, lo: Number(m[1]), hi: Number(m[2] ?? m[1]) } : null; }).filter(Boolean);
const maxFixlog = fixlogNums.reduce((m, x) => Math.max(m, x.hi), 0);
const historicalArtifacts = histFiles.map((f) => {
  const b = basename(f);
  const refBy = docRefText.filter(([d, t]) => d !== f && t.includes(b)).map(([d]) => d).sort();
  const anyRef = referrers(f);
  let cls, why;
  if (refBy.length) { cls = 'STILL REFERENCED'; why = `referenced by ${refBy.join(', ')}`; }
  else if (/^FIXLOG-B\d+/.test(b)) {
    const n = fixlogNums.find((x) => x.f === f);
    cls = n && n.hi < maxFixlog ? 'PURE HISTORY' : 'UNKNOWN';
    why = n && n.hi < maxFixlog ? `build-numbered fix log B${n.lo}${n.hi !== n.lo ? '-B' + n.hi : ''}; later logs exist up to B${maxFixlog}; no docs/README inbound reference` : 'latest build log — human decision';
  } else if (b === 'FIXLOG.md') { cls = 'UNKNOWN'; why = 'root Build-47 log; named by docs/README-INDEX.md? see refBy; human decision'; }
  else if (anyRef.length) { cls = 'UNKNOWN'; why = `not referenced by docs/README but referenced by ${anyRef.slice(0, 3).join(', ')}${anyRef.length > 3 ? '…' : ''}`; }
  else { cls = 'PURE HISTORY'; why = 'root-level report/audit/log with zero inbound references'; }
  return { path: f, bytes: sizes.get(f) ?? 0, lines: lines.get(f) ?? 0, lastTouchedCommit: dates?.[f]?.sha ?? null, lastTouchedDate: dates?.[f]?.date ?? null, classification: cls, why, referencedBy: refBy, otherReferrers: anyRef.length };
});

// ---------------------------------------------------------------------------
// Section 4 — structure facts
// ---------------------------------------------------------------------------
const topLevel = new Map();
for (const f of files) { const k = f.includes('/') ? f.slice(0, f.indexOf('/')) : '(root files)'; const t = topLevel.get(k) ?? { files: 0, bytes: 0 }; t.files++; t.bytes += sizes.get(f) ?? 0; topLevel.set(k, t); }
const structure = [...topLevel.entries()].sort().map(([dir, t]) => ({ dir, ...t, protectedBy: PROTECTED.find((z) => z.prefix === dir + '/')?.owner ?? null }));
const rootFiles = files.filter((f) => !f.includes('/')).sort();
const rootMd = rootFiles.filter((f) => f.endsWith('.md'));

// ---------------------------------------------------------------------------
// Section 5 — risk flags
// ---------------------------------------------------------------------------
const zoneOwnerTxt = contents.get('ZONE-OWNER.md') ?? '';
const zoneOwnerPaths = new Set([...zoneOwnerTxt.matchAll(/`([^`\s]+\/[^`\s]+|[\w.-]+\.(?:js|mjs|md|json|sh))`/g)].map((m) => m[1].replace(/[:#].*$/, '')));
const p31 = (argv.phase31 ? readFileSync(String(argv.phase31), 'utf8').split('\n').filter(Boolean) : []).sort();
const P31_AREAS = ['server/', 'ui/', 'scheduler/', 'hooks/', 'harness/parity/', 'events/', 'src/'];
function risksFor(path, kind) {
  const out = [];
  const z = protectedZone(path); if (z) out.push(`RISK: ${path} — ${kind}; inside protected zone ${z.prefix} (${z.owner}), do NOT delete.`);
  if (P31_AREAS.some((a) => path.startsWith(a))) out.push(`RISK: ${path} — ${kind}; Phase 31 (wiring) declared area, do NOT delete.`);
  if (p31.includes(path)) out.push(`RISK: ${path} — ${kind}; touched on phase-31-wiring branch, do NOT delete.`);
  for (const zp of zoneOwnerPaths) if (path === zp || path.startsWith(zp.replace(/\*\*?$/, ''))) { out.push(`RISK: ${path} — ${kind}; referenced by ZONE-OWNER.md (\`${zp}\`), do NOT delete.`); break; }
  const refs = referrers(path).filter((r) => PHASE_PROBE_RE.test(r) || r.startsWith('scripts/zone-owner-'));
  if (refs.length) out.push(`RISK: ${path} — ${kind}; referenced by merged-phase probe(s) ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` (+${refs.length - 3})` : ''}, do NOT delete.`);
  return out;
}
const riskFlags = new Set();
for (const d of deadCandidates) for (const r of risksFor(d.path, 'dead candidate')) riskFlags.add(r);
for (const d of unreferencedButYoung) for (const r of risksFor(d.path, 'unreferenced (young)')) riskFlags.add(r);
for (const d of futureWiring) for (const r of risksFor(d.path, 'unreferenced in protected zone')) riskFlags.add(r);
for (const d of duplicates) for (const p of d.paths) for (const r of risksFor(p, 'duplicate member')) riskFlags.add(r);
for (const h of historicalArtifacts) if (h.classification !== 'STILL REFERENCED') for (const r of risksFor(h.path, 'historical artifact')) riskFlags.add(r);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const summary = {
  filesScanned: files.length,
  textFilesIndexed: contents.size,
  deadCandidates: deadCandidates.length,
  unreferencedButYoung: unreferencedButYoung.length,
  potentialFutureWiring: futureWiring.length,
  duplicatePairs: duplicates.length,
  identicalContentGroups: identicalGroups.length,
  historicalArtifacts: historicalArtifacts.length,
  historicalBytes: historicalArtifacts.reduce((s, h) => s + h.bytes, 0),
  riskFlags: riskFlags.size,
};
const report = {
  meta: { tool: 'scripts/audit-repo-hygiene.mjs', mode: 'read-only', ageGateDays: AGE_DAYS, ageReference: NOW_ISO ?? '(not supplied — age gate not evaluable)', dates: datesSource, phase31FileList: argv.phase31 ? String(argv.phase31) : '(none supplied)' },
  summary,
  section1: { deadCandidates, unreferencedButYoung, potentialFutureWiring: futureWiring },
  section2: { duplicates, identicalGroups },
  section3: { historicalArtifacts, classificationCounts: historicalArtifacts.reduce((m, h) => ({ ...m, [h.classification]: (m[h.classification] ?? 0) + 1 }), {}) },
  section4: { topLevel: structure, rootFiles: rootFiles.length, rootMarkdown: rootMd },
  section5: { riskFlags: [...riskFlags].sort(), zoneOwnerPathsSeen: zoneOwnerPaths.size, phase31TouchedFiles: p31 },
};
if (argv.summary) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
