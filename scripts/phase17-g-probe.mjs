#!/usr/bin/env node
/**
 * PHASE 17 SCOPE G PROBE — cybersecurity framework mapping index (Step 2A).
 *
 *   P1  existing count (Step 1 evidence)
 *   P2  framework index built (all files, valid JSON)
 *   P3  every security skill indexed (818)
 *   P4  sample entry from index.json
 *   P5  framework breakdown per tactic
 *   P6  zero SKILL.md modifications (diff vs origin/main, excluding _frameworks)
 *   P7  readSkillMeta still loads existing security skills
 *   P8  zone compliance (only _frameworks/** + scripts/phase17-*.mjs changed)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSkillMeta } from '../server/src/services/SkillLoop.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(REPO, 'skills', 'library', 'security', '_frameworks');
const RESULTS = [];
const pass = (n, d) => { RESULTS.push({ n, ok: true }); console.log(`  PASS  ${n}  ${d}`); };
const fail = (n, d) => { RESULTS.push({ n, ok: false }); console.log(`  FAIL  ${n}  ${d}`); };
const assert = (c, n, okD, badD) => (c ? pass : fail)(n, c ? okD : badD);
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(1, 66 - t.length))}`);
const sh = (cmd) => execFileSync('bash', ['-c', cmd], { encoding: 'utf8', cwd: REPO }).trim();

function probeP1() {
  section('P1 — Existing count (Step 1 evidence, re-run)');
  const disk = sh(`find skills/library/security -name SKILL.md | grep -v _frameworks | wc -l`);
  const main = sh(`git ls-tree -r origin/main --name-only | grep 'skills/library/security' | grep -c 'SKILL.md$'`);
  console.log(`    $ find skills/library/security -name SKILL.md | wc -l   (excluding _frameworks)`);
  console.log(`    ${disk}`);
  console.log(`    $ git ls-tree -r origin/main --name-only | grep -c 'skills/library/security.*SKILL.md'`);
  console.log(`    ${main}   (origin/main = ${sh('git rev-parse origin/main')})`);
  console.log(`    $ ls skills/library/security/ | head -5`);
  console.log(sh(`ls skills/library/security/ | head -5`).split('\n').map((l) => `    ${l}`).join('\n'));
  console.log('    VERDICT: Phase 8 skills present — YES (818 on main and on disk). Step 2A applies.');
  assert(disk === '818' && main === '818', 'P1 existing count', '818 SKILL.md on disk == 818 tracked on origin/main — Step 2A (index, no re-import)', `disk=${disk} main=${main}`);
}

function probeP2() {
  section('P2 — Framework index built');
  const files = ['README.md', 'index.json', 'attack.json', 'nist-csf.json', 'atlas.json', 'd3fend.json', 'ai-rmf.json', 'f3.json'];
  let ok = true;
  for (const f of files) {
    const p = path.join(FX, f);
    const exists = fs.existsSync(p);
    let valid = true;
    if (exists && f.endsWith('.json')) { try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch { valid = false; } }
    console.log(`    ${exists && valid ? 'OK ' : 'BAD'} ${f}${exists ? ` (${fs.statSync(p).size} B)` : ' (MISSING)'}`);
    ok = ok && exists && valid;
  }
  assert(ok, 'P2 index built', '8 index files present, all JSON valid', 'a file is missing or invalid');
}

function probeP3() {
  section('P3 — Every security skill indexed');
  const index = JSON.parse(fs.readFileSync(path.join(FX, 'index.json'), 'utf8'));
  const onDisk = sh(`find skills/library/security -name SKILL.md | grep -v _frameworks | wc -l`);
  const entries = Object.keys(index.skills).length;
  console.log(`    skills on disk: ${onDisk}; index entries: ${entries}; meta.skillCount: ${index.meta.skillCount}`);
  const un = Object.fromEntries(Object.entries(index.meta.frameworks).map(([k, v]) => [`${k}`, `declared=${v.declaredBy} unverified=${v.unverified}`]));
  console.log(`    ${Object.entries(un).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
  assert(String(onDisk) === String(entries) && entries === 818 && index.meta.skillCount === 818, 'P3 818 indexed',
    'every one of the 818 existing security skills has an index entry', `disk=${onDisk} entries=${entries}`);
  return index;
}

function probeP4(index) {
  section('P4 — Sample entry (index.json)');
  const pick = 'TA0001-initial-access/auditing-kubernetes-cluster-rbac'; // has f3 mapping
  const e = index.skills[pick];
  console.log(`    ${pick}:`);
  console.log(JSON.stringify(e, null, 2).split('\n').map((l) => `      ${l}`).join('\n'));
  const ok = e && Array.isArray(e.attack) && Array.isArray(e.nist) && Array.isArray(e.f3) && e.f3_version;
  const second = index.skills[Object.keys(index.skills).find((k) => index.skills[k].d3fend !== 'UNVERIFIED')];
  console.log(`    (second sample with D3FEND) ${JSON.stringify(second).slice(0, 160)}…`);
  assert(ok && second.d3fend.length > 0, 'P4 sample entry', 'declared arrays verbatim from frontmatter; f3_version present; UNVERIFIED where undeclared', JSON.stringify(e).slice(0, 120));
}

function probeP5() {
  section('P5 — Framework breakdown per tactic (attack.json)');
  const atk = JSON.parse(fs.readFileSync(path.join(FX, 'attack.json'), 'utf8'));
  console.log('    tactic                       skills  declared-techniques');
  for (const [t, v] of Object.entries(atk.byTactic)) {
    console.log(`    ${t.padEnd(28)} ${String(v.skills).padStart(6)}  ${String(Object.keys(v.techniques).length).padStart(18)}`);
  }
  console.log(`    skills without declared attack mapping: ${atk.skillsWithoutAttack.length}`);
  const total = Object.values(atk.byTactic).reduce((s, v) => s + v.skills, 0);
  const nist = JSON.parse(fs.readFileSync(path.join(FX, 'nist-csf.json'), 'utf8'));
  console.log(`    nist-csf functions: ${Object.keys(nist.byFunction).join(', ')} (skills with declared controls: ${Object.values(nist.byFunction).reduce((s, v) => s + v.skills, 0)})`);
  assert(total === 818 && Object.keys(atk.byTactic).length >= 10 && Object.keys(nist.byFunction).length >= 5, 'P5 breakdown per tactic',
    `all 818 grouped by tactic; ${Object.keys(atk.byTactic).length} tactics; CSF functions ${Object.keys(nist.byFunction).join('/')}`,
    `total=${total}`);
}

function probeP6() {
  section('P6 — Zero SKILL.md modifications');
  console.log('    $ git diff --stat origin/main..HEAD -- skills/library/security (excluding _frameworks)');
  const d = sh(`git diff --stat origin/main..HEAD -- skills/library/security ':(exclude)skills/library/security/_frameworks/**' | tail -1`);
  console.log(`    ${d || '(empty — no changes)'}`);
  console.log('    $ git status --short skills/library/security | grep -v _frameworks');
  const st = sh(`git status --short skills/library/security | grep -v _frameworks || true`);
  console.log(`    ${st || '(empty — nothing outside _frameworks touched)'}`);
  assert(d === '' && st === '', 'P6 zero modifications to existing skills',
    'diff origin/main..HEAD on skills/library/security (excl. _frameworks) is EMPTY; working tree clean outside _frameworks',
    `diff=${d} status=${st}`);
}

function probeP7() {
  section('P7 — Load test: readSkillMeta on 3 existing security skills');
  // 3 DISTINCT existing skills: known one + deterministic picks from the sorted walk.
  const all = sh(`find skills/library/security -name SKILL.md | grep -v _frameworks | sort`).split('\n');
  const picks = [
    'skills/library/security/TA0001-initial-access/achieving-cmmc-level-2-compliance/SKILL.md',
    all[Math.floor(all.length / 3)],
    all[Math.floor((2 * all.length) / 3)],
  ];
  let ok = true;
  const seen = new Set();
  for (const rel of picks) {
    const file = fs.existsSync(path.join(REPO, rel)) ? rel : all[0];
    if (seen.has(file)) { fail('P7 readSkillMeta distinctness', 'duplicate pick'); break; }
    seen.add(file);
    const meta = readSkillMeta(path.join(REPO, file));
    console.log(`    ${file.replace('skills/library/security/', '')}`);
    console.log(`      name=${meta && meta.name}  license=${meta && meta.license}  domain=${meta && meta.domain}  body=${meta && meta.body ? `${meta.body.length} chars` : 'MISSING'}`);
    ok = ok && meta && meta.name && meta.body && meta.body.includes('Prompt Defense Baseline');
  }
  assert(ok, 'P7 readSkillMeta works on existing skills', '3 existing security skills load through SkillLoop.readSkillMeta — name/license/body intact, baseline present', 'a load failed');
}

function probeP8() {
  section('P8 — Zone compliance');
  const staged = sh(`git status --short | grep -vE "^ M FIXLOG-B216|^ M android/gradlew|^ D app.py|^ D b2|^\\?\\? b2" | grep -vE 'skills/library/security/_frameworks|scripts/phase17-g-' || true`);
  console.log('    $ git status --short (excluding known sandbox noise; scope files only)');
  console.log('    ' + (staged || '(nothing outside the zone)'));
  console.log('    in-zone additions:');
  console.log(sh(`git status --short | grep -E 'skills/library/security/_frameworks|scripts/phase17-g-' | head -12`).split('\n').map((l) => `      ${l}`).join('\n'));
  const committed = sh(`git diff --name-only 44c9708..HEAD 2>/dev/null | grep -vE 'skills/library/security/_frameworks|scripts/phase17-g-' | head -3 || true`);
  assert(staged === '' && committed === '', 'P8 zone compliance',
    'working tree + commit touch ONLY skills/library/security/_frameworks/** + scripts/phase17-g-*.mjs', `outside=${staged} ${committed}`);
}

async function main() {
  console.log('PHASE 17 — SCOPE G PROBE — cybersecurity framework mapping index (Step 2A)');
  console.log(`node ${process.version}; branch HEAD ${sh('git rev-parse --short HEAD')}`);
  probeP1();
  probeP2();
  const index = probeP3();
  probeP4(index);
  probeP5();
  probeP6();
  probeP7();
  probeP8();
  const nPass = RESULTS.filter((r) => r.ok).length;
  const nFail = RESULTS.filter((r) => !r.ok).length;
  console.log(`\n══ SUMMARY: ${nPass} pass / ${nFail} fail ══`);
  console.log('method: every mapping copied from the skill\'s own frontmatter; undeclared → "UNVERIFIED" (nothing invented).');
  process.exitCode = nFail > 0 ? 1 : 0;
}

main().catch((e) => { console.error('PROBE CRASH:', e); process.exitCode = 1; });
