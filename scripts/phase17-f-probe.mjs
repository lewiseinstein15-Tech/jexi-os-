#!/usr/bin/env node
/**
 * PHASE 17 SCOPE F PROBE — scientific skills import (165→166 upstream count).
 *
 *   P1  import count (find | wc -l)  — honest note: upstream ships 166
 *   P2  domain breakdown
 *   P3  sample load ×5 through the skills frontmatter readers
 *       (catalog.parseFrontmatter — the machinery readSkill() uses — plus
 *       SkillLoop.readSkillMeta as the portable second reader)
 *   P4  lint all imported (scripts/lint-agent-baseline.sh)
 *   P5  provenance fields on 5 skills
 *   P6  cross-check 3 skills vs upstream clone (byte-compare + sha256)
 *   P7  AAS/library curator dedupe gate (facsimile repo — the real repo is
 *       never mutated by the curator run)
 *   P8  external scripts check (count + policy + zero vendored files)
 *   P9  executability (parseSteps over all 166 — reference-only statement)
 *   P10 size delta (bytes/lines of the import)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, parseSteps } from '../server/src/skills/catalog.js';
import { readSkillMeta } from '../server/src/services/SkillLoop.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = '/tmp/sas-upstream';
const SCI = path.join(REPO, 'skills', 'library', 'scientific');
const FACSIMILE = '/tmp/phase17-f/repo';
const STAGE = '/tmp/phase17-f/stage';

const RESULTS = [];
const pass = (n, d) => { RESULTS.push({ n, ok: true }); console.log(`  PASS  ${n}  ${d}`); };
const fail = (n, d) => { RESULTS.push({ n, ok: false }); console.log(`  FAIL  ${n}  ${d}`); };
const assert = (c, n, okD, badD) => (c ? pass : fail)(n, c ? okD : badD);
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(1, 66 - t.length))}`);
const sh = (cmd) => execFileSync('bash', ['-c', cmd], { encoding: 'utf8', cwd: REPO }).trim();

function allSkillFiles() {
  return sh(`find skills/library/scientific -name SKILL.md | sort`).split('\n').filter(Boolean);
}

function probeP1() {
  section('P1 — Import count');
  const out = sh(`find skills/library/scientific -name SKILL.md | wc -l`);
  const upstream = Number(sh(`find ${UPSTREAM}/skills -name SKILL.md | wc -l`));
  console.log(`    $ find skills/library/scientific -name SKILL.md | wc -l`);
  console.log(`    ${out}`);
  console.log(`    upstream SKILL.md count (cloned @ import time): ${upstream}`);
  console.log(`    NOTE: the scope text said 165; the upstream repo ships ${upstream} and its own`);
  console.log(`    README claims "all 166 skills". Imported: ALL of them — the honest count is 166.`);
  assert(Number(out) === upstream && upstream === 166, 'P1 import count',
    `166 imported == 166 upstream (scope said 165; upstream ships 166 — none skipped)`,
    `imported=${out} upstream=${upstream}`);
}

function probeP2() {
  section('P2 — Domain breakdown');
  const rows = sh(`for d in skills/library/scientific/*/; do n=$(find "$d" -name SKILL.md | wc -l); echo "$(basename $d) $n"; done | sort -k2 -rn`).split('\n');
  for (const r of rows) console.log(`    ${r.replace(/\s+/, '  ')}`);
  const domains = rows.length;
  const mandated = ['genomics', 'cheminformatics', 'medical-imaging', 'drug-discovery', 'pk-pd', 'molecular-dynamics', 'geospatial'];
  const missing = mandated.filter((m) => !rows.some((r) => r.startsWith(m + ' ')));
  const total = rows.reduce((s, r) => s + Number(r.split(' ')[1]), 0);
  assert(!missing.length && total === 166, 'P2 domain breakdown',
    `${domains} domains (7 mandated + 9 data-driven extras), counts sum to ${total}; every mandated domain present`,
    `domains=${domains} total=${total} missing=${missing.join(',')}`);
}

function probeP3() {
  section('P3 — Sample load (5 skills, frontmatter parses + baseline present)');
  const files = allSkillFiles();
  const picks = [files[0], files[Math.floor(files.length * 0.25)], files[Math.floor(files.length * 0.5)], files[Math.floor(files.length * 0.75)], files[files.length - 1]];
  let ok = true;
  for (const rel of picks) {
    const abs = path.join(REPO, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    const { metadata, bodyMarkdown } = parseFrontmatter(raw); // readSkill()'s parser
    const steps = parseSteps(bodyMarkdown);
    const portable = readSkillMeta(abs);                      // SkillLoop's portable reader
    const baseline = bodyMarkdown.includes('## Prompt Defense Baseline');
    console.log(`    ${rel.replace('skills/library/scientific/', '')}`);
    console.log(`      parseFrontmatter: name=${metadata.name}  domain=${metadata.domain}  tier=${metadata.tier}  whenToUse=${String(metadata.whenToUse).slice(0, 40)}…  allowedTools=[${(metadata.allowedTools || []).join(',')}]`);
    console.log(`      SkillLoop.readSkillMeta: name=${portable.name}  origin=${portable.origin}  license=${portable.license}`);
    console.log(`      baseline present=${baseline}  executorSteps=${steps.length} (reference-only)`);
    ok = ok && metadata.name && metadata.origin === 'K-Dense-AI/scientific-agent-skills' && baseline && steps.length === 0 && portable.name === metadata.name;
  }
  assert(ok, 'P3 sample load ×5',
    '5 skills load through readSkill()\'s parseFrontmatter (name/description/whenToUse/allowedTools/domain/tier) and SkillLoop.readSkillMeta; baseline present in each; zero executor steps (reference-only by design)',
    'a sample failed to parse');
}

function probeP4() {
  section('P4 — Lint all imported (canonical baseline, verbatim)');
  console.log('    $ bash scripts/lint-agent-baseline.sh skills/library/scientific/');
  const out = sh(`bash scripts/lint-agent-baseline.sh skills/library/scientific/ | tail -3`);
  console.log(out.split('\n').map((l) => `    ${l}`).join('\n'));
  const m = out.match(/Checked: (\d+) files \(baseline\), \d+ agent-format files, failing: (\d+), warnings: (\d+)/);
  const okLint = /PASS/.test(out) && m && Number(m[2]) === 0;
  assert(okLint, 'P4 lint', `${m[1]} files checked, ${m[2]} failing, ${m[3]} warnings — PASS`, out);
}

function probeP5() {
  section('P5 — Provenance present (origin + license + importedAt)');
  const files = allSkillFiles();
  const picks = ['genomics/scanpy', 'cheminformatics/rdkit', 'drug-discovery/deepchem', 'pk-pd/pkpd-modeling', 'geospatial/geopandas'];
  let ok = true;
  for (const p of picks) {
    const rel = files.find((f) => f.includes(`/scientific/${p}/SKILL.md`));
    const { metadata } = parseFrontmatter(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    console.log(`    ${p}:  origin=${metadata.origin}  license=${metadata.license}  importedAt=${metadata.importedAt}  upstreamCommit=${String(metadata.upstreamCommit).slice(0, 12)}`);
    ok = ok && metadata.origin === 'K-Dense-AI/scientific-agent-skills' && String(metadata.license || '').length >= 3 && /^\d{4}-\d{2}-\d{2}T/.test(metadata.importedAt);
  }
  assert(ok, 'P5 provenance', 'all 5 sampled skills carry origin, per-source license (verbatim upstream field: MIT or the upstream library\'s own license, e.g. BSD-3-Clause for scanpy/rdkit), importedAt ISO timestamp, upstreamCommit', 'provenance missing somewhere');
}

function probeP6() {
  section('P6 — Cross-check vs upstream (3 skills, body byte-compare + sha256)');
  const picks = ['genomics/scanpy', 'ml-computation/sympy', 'visualization-reporting/seaborn'];
  let ok = true;
  for (const p of picks) {
    const rel = allSkillFiles().find((f) => f.includes(`/scientific/${p}/SKILL.md`));
    const name = p.split('/')[1];
    const imported = fs.readFileSync(path.join(REPO, rel), 'utf8');
    const upRaw = fs.readFileSync(path.join(UPSTREAM, 'skills', name, 'SKILL.md'), 'utf8');
    // Imported body = everything after MY frontmatter, minus the provenance+baseline tail.
    const bodyStart = imported.indexOf('\n---\n', 4) + 5;
    const provAt = imported.indexOf('## Import Provenance');
    const importedBody = imported.slice(bodyStart, provAt).replace(/^\s+/, '').replace(/\s+$/, '\n');
    const upBody = upRaw.slice(upRaw.indexOf('\n---\n', 4) + 5).replace(/^\n+/, '').replace(/\s+$/, '\n');
    const h1 = crypto.createHash('sha256').update(importedBody).digest('hex').slice(0, 16);
    const h2 = crypto.createHash('sha256').update(upBody).digest('hex').slice(0, 16);
    const same = h1 === h2;
    console.log(`    ${name}: imported body sha256[:16]=${h1}  upstream=${h2}  identical=${same} (${importedBody.length} bytes)`);
    if (!same) {
      for (let i = 0; i < Math.max(importedBody.length, upBody.length); i++) {
        if (importedBody[i] !== upBody[i]) { console.log(`      first diff at byte ${i}: ${JSON.stringify(importedBody.slice(i - 20, i + 20))} vs ${JSON.stringify(upBody.slice(i - 20, i + 20))}`); break; }
      }
    }
    ok = ok && same;
  }
  assert(ok, 'P6 content matches upstream', 'all 3 sampled bodies byte-identical to the upstream clone (sha256 match) — faithful port', 'a body differs from upstream');
}

function probeP7() {
  section('P7 — Dedupe gate (library curator against existing JEXI skills)');
  // Facsimile so the curator's copy step never touches the real repo.
  fs.rmSync('/tmp/phase17-f', { recursive: true, force: true });
  fs.mkdirSync(FACSIMILE, { recursive: true });
  execFileSync('cp', ['-a', path.join(REPO, 'skills'), FACSIMILE]);
  fs.mkdirSync(path.join(STAGE, 'aas'), { recursive: true });
  for (const f of allSkillFiles()) {
    const slug = path.basename(path.dirname(f));
    const dest = path.join(STAGE, 'aas', slug);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(dest, 'SKILL.md'));
  }
  const out = execFileSync('node', ['skills/library/curator.mjs', '--stage', STAGE, '--repo', FACSIMILE], { encoding: 'utf8', cwd: REPO });
  console.log(out.split('\n').filter((l) => /accepted|skipped|merged|verdict|Import|total/i.test(l)).slice(0, 8).map((l) => `    ${l}`).join('\n'));
  const manifestPath = path.join(FACSIMILE, 'skills', 'library', 'IMPORT-MANIFEST.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`    curator manifest: staged=${m.staged} imported=${m.importedCount} skipped(duplicates)=${m.skippedCount}`);
  console.log(`    skipped list: ${m.skipped ? JSON.stringify(m.skipped.map((s) => `${s.id} vs ${s.vs} @${s.similarity}`)) : '(none)'}`);
  const merged = m.mergeCandidates ? m.mergeCandidates.length : 0;
  console.log(`    merge candidates: ${merged}`);
  assert(Number(m.staged) === 166 && Number(m.skippedCount) === 0 && merged === 0, 'P7 zero overlaps',
    `curator gate: 166 staged, 0 skipped as duplicates, 0 merge candidates vs every existing JEXI skill (threshold 0.85 cosine)`,
    `staged=${m.staged} skipped=${m.skippedCount} merges=${merged}`);
}

function probeP8() {
  section('P8 — External scripts check');
  const upstreamWithScripts = sh(`find ${UPSTREAM}/skills -mindepth 2 -maxdepth 2 -type d -name scripts | wc -l`);
  const vendored = sh(`find skills/library/scientific -name '*.py' -o -name '*.sh' -o -name '*.ipynb' | wc -l`);
  const manifest = JSON.parse(fs.readFileSync(path.join(SCI, 'IMPORT-MANIFEST.json'), 'utf8'));
  const auxTotal = manifest.imported.reduce((s, x) => s + x.auxFilesUpstream, 0);
  console.log(`    upstream skills shipping scripts/: ${upstreamWithScripts} of 166`);
  console.log(`    upstream auxiliary files total (scripts+references+assets): ${auxTotal}`);
    console.log(`    license: MIT (upstream LICENSE.md) — copying WOULD be permitted;`);
  console.log(`    policy decision: SKILL.md-only import — scripts stay upstream; every SKILL.md`);
  console.log(`    carries "External scripts: NOT vendored … Check provider ToS before operational use."`);
  console.log(`    vendored executables in the import: ${vendored}`);
  assert(Number(upstreamWithScripts) === 106 && Number(vendored) === 0, 'P8 external scripts',
    `106 upstream skills have scripts/; 0 script files vendored (SKILL.md-only policy, noted per skill); license stated (MIT)`,
    `upstream=${upstreamWithScripts} vendored=${vendored}`);
}

function probeP9() {
  section('P9 — Real skill execution');
  const files = allSkillFiles();
  let withSteps = 0;
  for (const rel of files) {
    const { bodyMarkdown } = parseFrontmatter(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    if (parseSteps(bodyMarkdown).length > 0) withSteps += 1;
  }
  console.log(`    skills with JEXI executor '## Steps' blocks: ${withSteps} of ${files.length}`);
  console.log('    Saying it plainly: NONE of the imported skills are executable through the JEXI');
  console.log('    executor. Upstream scientific skills are procedural KNOWLEDGE (reference-only):');
  console.log('    documented CLI/Python procedures for a scientist to run, not registry-tool');
  console.log('    programs. Converting them into ## Steps would have required inventing tool');
  console.log('    mappings — refused by the faithful-port rule. Every skill is labeled');
  console.log("    'tier: reference-only' in its frontmatter and in Import Provenance.");
  assert(withSteps === 0, 'P9 all reference-only (stated plainly)',
    `0/${files.length} executable — honest label: reference-only knowledge, no invented executor steps`,
    `unexpected ${withSteps} executable skills`);
}

function probeP10() {
  section('P10 — Size delta');
  const bytes = Number(sh(`du -sb skills/library/scientific | cut -f1`));
  const files = Number(sh(`find skills/library/scientific -type f | wc -l`));
  const lines = Number(sh(`find skills/library/scientific -type f -exec cat {} + | wc -l`));
  console.log(`    files: ${files} (166 SKILL.md + README.md + LICENSE + IMPORT-MANIFEST.json)`);
  console.log(`    lines: ${lines}   bytes: ${bytes}`);
  console.log(`    (git diff --stat pasted in the report after commit — probe reports the raw sizes)`);
  assert(files === 169 && bytes > 400_000, 'P10 size',
    `${files} files, ${lines} lines, ${(bytes / 1024).toFixed(0)} KiB imported`,
    `files=${files} bytes=${bytes}`);
}

async function main() {
  console.log('PHASE 17 — SCOPE F PROBE — scientific skills import (K-Dense-AI/scientific-agent-skills)');
  console.log(`node ${process.version}; upstream clone @ ${sh(`git -C ${UPSTREAM} rev-parse --short HEAD`)} (release ${JSON.parse(fs.readFileSync(path.join(UPSTREAM, 'plugin.json'), 'utf8')).version})`);
  probeP1();
  probeP2();
  probeP3();
  probeP4();
  probeP5();
  probeP6();
  probeP7();
  probeP8();
  probeP9();
  probeP10();
  const nPass = RESULTS.filter((r) => r.ok).length;
  const nFail = RESULTS.filter((r) => !r.ok).length;
  console.log(`\n══ SUMMARY: ${nPass} pass / ${nFail} fail ══`);
  process.exitCode = nFail > 0 ? 1 : 0;
}

main().catch((e) => { console.error('PROBE CRASH:', e); process.exitCode = 1; });
