#!/usr/bin/env node
/**
 * JEXI OS — Phase 22 Scope B — LIVE PROBES P1–P4 (n8n skills import).
 *
 * Raw output only. P1–P3 run in-process; P2 shells out to the repo's own
 * Prompt Defense Baseline lint so the verdict is the lint's exit code, not a
 * re-implementation of it.
 *
 * Usage: node scripts/phase22-b-probe.mjs [--only=P1,P2,P3,P4]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSkillMeta } from '../server/src/services/SkillLoop.js';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, '..');
const TARGET = 'skills/library/claude-ecosystem/n8n-skills';
const ABS = path.join(REPO, TARGET);

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const run = (id) => !only || only.split(',').includes(id);

const results = {};
const pass = (id, n) => { results[id] = `PASS${n ? ` — ${n}` : ''}`; };
const fail = (id, n) => { results[id] = `FAIL — ${n}`; };
function header(id, title) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`${id} — ${title}`);
  console.log('═══════════════════════════════════════════════════');
}
const show = (l, v) => console.log(`${l}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);

/** Only skill directories — IMPORT-MANIFEST.json sits at the target root. */
function skillDirs() {
  return fs.readdirSync(ABS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** P1 — count SKILL.md under the target. */
function P1() {
  header('P1', 'SKILL.md count under skills/library/claude-ecosystem/n8n-skills/');
  const dirs = skillDirs();
  const files = dirs.map((s) => path.join(TARGET, s, 'SKILL.md'));
  const missing = files.filter((f) => !fs.existsSync(path.join(REPO, f)));
  show('skill directories', dirs.length);
  show('SKILL.md paths', files);
  show('missing', missing);
  const ok = files.length >= 1 && files.length <= 15 && missing.length === 0;
  (ok ? pass : fail)('P1', ok
    ? `${files.length} SKILL.md files (14 specialist + 1 always-on router; upstream cap 14 skills + router)`
    : `${files.length} files, ${missing.length} missing (expected 15)`);
}

/** P2 — repo baseline lint, shelled out; verdict is the lint exit code. */
function P2() {
  header('P2', 'scripts/lint-agent-baseline.sh on the n8n-skills subtree');
  const r = spawnSync('bash', ['scripts/lint-agent-baseline.sh', TARGET], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  show('lint exit code', r.status);
  const summary = (out.match(/Checked: .*/) || [''])[0];
  const ok = r.status === 0 && /failing: 0/.test(summary);
  (ok ? pass : fail)('P2', ok ? summary : `lint exit ${r.status} — ${summary || 'no summary line'}`);
}

/** P3 — load three imported skills through the real readSkillMeta(). */
function P3() {
  header('P3', 'readSkillMeta() on 3 imported skills');
  const picks = ['n8n-expression-syntax', 'n8n-workflow-patterns', 'using-n8n-mcp-skills'];
  let ok = 0;
  for (const slug of picks) {
    const file = path.join(ABS, slug, 'SKILL.md');
    const meta = readSkillMeta(file);
    show(`readSkillMeta(${slug})`, meta && {
      name: meta.name,
      origin: meta.origin,
      upstreamPath: meta.upstreamPath,
      upstreamCommit: (meta.upstreamCommit || '').slice(0, 12),
      license: meta.license,
      router: meta.router,
      tier: meta.tier,
      descriptionChars: (meta.description || '').length,
      bodyChars: (meta.body || '').length,
      baselinePresent: /^## Prompt Defense Baseline$/m.test(meta.body || ''),
    });
    if (meta && meta.name === slug && meta.origin === 'czlonkowski/n8n-skills'
        && meta.license === 'MIT' && (meta.body || '').includes('## Prompt Defense Baseline')) ok += 1;
  }
  const okAll = ok === picks.length;
  (okAll ? pass : fail)('P3', okAll
    ? `${ok}/${picks.length} loaded — frontmatter parses, origin present, baseline present`
    : `${ok}/${picks.length} loaded cleanly`);
}

/** P4 — what the commit actually carried. */
function P4() {
  header('P4', 'git status --short (post-commit working tree)');
  const st = spawnSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' });
  const lines = (st.stdout || '').split('\n').filter(Boolean);
  show('status -s', lines.length ? lines : '(clean)');
  const last = spawnSync('git', ['show', '--stat', '--oneline', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  show('HEAD', (last.stdout || '').split('\n').slice(0, 4).join(' | '));
  const files = spawnSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: REPO, encoding: 'utf8' })
    .stdout.split('\n').filter(Boolean);
  const outOfZone = files.filter((f) => !(f.startsWith(`${TARGET}/`) || /^scripts\/phase22-.*\.mjs$/.test(f)));
  show('HEAD files', files);
  show('out-of-zone files', outOfZone);
  show('working tree clean', lines.length === 0);
  const ok = outOfZone.length === 0;
  (ok ? pass : fail)('P4', ok
    ? `${files.length} files in HEAD, all inside the zone; working tree clean`
    : `out-of-zone: ${outOfZone.join(', ')}`);
}

console.log(`PROBE phase22-b  repo=${REPO}  node=${process.version}`);
if (run('P1')) P1();
if (run('P2')) P2();
if (run('P3')) P3();
if (run('P4')) P4();

console.log('\n──────────── VERDICTS ────────────');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
process.exit(Object.values(results).some((v) => v.startsWith('FAIL')) ? 1 : 0);