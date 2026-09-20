#!/usr/bin/env node
/**
 * JEXI OS — Phase 22 Scope D — LIVE PROBES P1–P7 (superpowers skills + hooks).
 *
 * Raw output only. P2 cross-checks every ported skill against the pinned
 * upstream commit; P4/P5 execute the real hook runner in a child process and
 * parse its JSON; P5 also exercises the Phase 12 D gates.
 *
 * Usage: node scripts/phase22-d-probe.mjs [--only=P1,…]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, '..');
const BUNDLE = 'skills/library/claude-ecosystem/superpowers';
const ABS = path.join(REPO, BUNDLE);
const SRC = process.env.SUPERPOWERS_SRC || '/tmp/superpowers-src';
const UPSTREAM_COMMIT = '5bf4e78011075bcfc0dc295f0724994cd123ee71';

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

const skillDirs = () => fs.readdirSync(path.join(ABS, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ABS, 'skills', d.name, 'SKILL.md')))
  .map((d) => d.name).sort();

function P1() {
  header('P1', 'Skill count');
  const dirs = skillDirs();
  console.log(`$ find ${BUNDLE} -name SKILL.md | wc -l`);
  console.log(`${dirs.length}`);
  show('names', dirs);
  const ok = dirs.length === 15;
  (ok ? pass : fail)('P1', ok ? `15 SKILL.md files` : `expected 15, found ${dirs.length}`);
}

function P2() {
  header('P2', 'Pinned-commit match');
  if (!fs.existsSync(path.join(SRC, 'skills'))) {
    show('upstream source', `not found at ${SRC} — cannot cross-check`);
    fail('P2', `upstream source missing at ${SRC}`);
    return;
  }
  const upstreamNames = fs.readdirSync(path.join(SRC, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SRC, 'skills', d.name, 'SKILL.md')))
    .map((d) => d.name).sort();
  const mine = skillDirs();

  const fm = (raw) => {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    return { head: m[1], body: m[2] };
  };
  const nameOf = (head) => (/^name:\s*(.*)$/m.exec(head) || [])[1]?.trim();

  let verbatim = 0; let drifted = 0;
  for (const slug of mine) {
    const up = fm(fs.readFileSync(path.join(SRC, 'skills', slug, 'SKILL.md'), 'utf8'));
    const me = fm(fs.readFileSync(path.join(ABS, 'skills', slug, 'SKILL.md'), 'utf8'));
    const ported = me.body.split('\n\n## Import Provenance\n')[0].trim();
    const bodyOk = ported === up.body.trim();
    const nameOk = nameOf(up.head) === nameOf(me.head);
    const originOk = /^origin:\s*obra\/superpowers$/m.test(me.head);
    const commitOk = new RegExp(`^upstreamCommit:\\s*${UPSTREAM_COMMIT}$`, 'm').test(me.head);
    const ok = bodyOk && nameOk && originOk && commitOk;
    console.log(`  ${ok ? 'VERBATIM' : 'DRIFT   '} ${slug.padEnd(32)} body=${bodyOk} name=${nameOk} origin=${originOk} commit=${commitOk}`);
    if (ok) verbatim += 1; else drifted += 1;
  }
  const listOk = JSON.stringify(upstreamNames) === JSON.stringify(mine);
  show('upstream skill names', upstreamNames);
  show('local skill names', mine);
  show('name list identical', listOk);
  show('counts', { total: mine.length, verbatim, drifted });
  const ok = drifted === 0 && listOk && mine.length === 15;
  (ok ? pass : fail)('P2', ok
    ? `${mine.length} total, ${verbatim} verbatim, 0 drifted`
    : `${mine.length} total, ${verbatim} verbatim, ${drifted} drifted`);
}

function P3() {
  header('P3', 'Lint on the new skills');
  const r = spawnSync('bash', ['scripts/lint-agent-baseline.sh', `${BUNDLE}/skills/`], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  const summary = (out.match(/Checked: .*/) || [''])[0];
  show('lint exit code', r.status);
  const ok = r.status === 0 && /failing: 0/.test(summary);
  (ok ? pass : fail)('P3', ok ? summary : `lint exit ${r.status} — ${summary || 'no summary'}`);
}

function P4() {
  header('P4', 'Hooks manifest present + runner POSIX-sh compatible');
  const manifestPath = path.join(ABS, 'hooks/hooks.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  console.log(`$ cat ${BUNDLE}/hooks/hooks.json`);
  console.log(raw.replace(/\n$/, ''));
  const manifest = JSON.parse(raw);
  const entries = manifest.hooks?.SessionStart || [];
  const cmds = entries.flatMap((e) => (e.hooks || []).map((h) => h.command));
  show('parsed events', Object.keys(manifest.hooks || {}));
  show('SessionStart matchers', entries.map((e) => e.matcher));
  show('commands', cmds);

  const runner = path.join(ABS, 'hooks/run-hook.sh');
  show('runner exists', fs.existsSync(runner));
  const syntax = spawnSync('/bin/sh', ['-n', runner], { encoding: 'utf8' });
  show('run-hook.sh POSIX syntax (sh -n)', syntax.status === 0 ? 'OK' : syntax.stderr);

  const sh = path.join(ABS, 'hooks/session-start.sh');
  const shSyntax = spawnSync('/bin/sh', ['-n', sh], { encoding: 'utf8' });
  show('session-start.sh POSIX syntax (sh -n)', shSyntax.status === 0 ? 'OK' : shSyntax.stderr);

  // Failure modes through the real runner.
  const noArg = spawnSync('/bin/sh', [runner], { encoding: 'utf8' });
  show('runner no-arg exit', noArg.status);
  show('runner no-arg stderr', (noArg.stderr || '').trim());
  const unknown = spawnSync('/bin/sh', [runner, 'does-not-exist'], { encoding: 'utf8' });
  show('runner unknown-hook exit', unknown.status);
  show('runner unknown-hook stderr', (unknown.stderr || '').trim());

  // The real hook, executed and JSON-parsed.
  const ran = spawnSync('/bin/sh', [runner, 'session-start'], { encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(ran.stdout); } catch { /* reported below */ }
  show('run-hook.sh session-start exit', ran.status);
  show('hook output keys', parsed ? Object.keys(parsed) : '(invalid JSON)');
  if (parsed) {
    const ctx = parsed.additionalContext || parsed.additional_context
      || parsed.hookSpecificOutput?.additionalContext || '';
    show('context chars', ctx.length);
    show('embeds using-superpowers skill', ctx.includes('superpowers:using-superpowers'));
  }

  const ok = cmds.length === 1
    && syntax.status === 0 && shSyntax.status === 0
    && noArg.status === 1 && unknown.status === 1
    && ran.status === 0 && parsed !== null;
  (ok ? pass : fail)('P4', ok
    ? `manifest has 1 SessionStart command; both sh scripts POSIX-clean; runner exits 1 on bad input; hook emits valid JSON`
    : 'manifest, POSIX syntax, failure modes or hook output did not check out');
}

function P5() {
  header('P5', 'Phase 12 D gates untouched — git diff 8b713cd..HEAD -- skills/gates/');
  const r = spawnSync('git', ['diff', '8b713cd..HEAD', '--', 'skills/gates/'], { cwd: REPO, encoding: 'utf8' });
  const out = r.stdout || '';
  console.log(`$ git diff 8b713cd..HEAD -- skills/gates/`);
  console.log(out.length ? out : '(empty)');
  const ok = out.trim() === '';
  (ok ? pass : fail)('P5', ok ? 'empty diff — Phase 12 D gates untouched' : 'Phase 12 D gates were modified');
}

function P6() {
  header('P6', 'Phase 7 B hooks untouched — git diff 8b713cd..HEAD -- hooks/');
  const r = spawnSync('git', ['diff', '8b713cd..HEAD', '--', 'hooks/'], { cwd: REPO, encoding: 'utf8' });
  const out = r.stdout || '';
  console.log(`$ git diff 8b713cd..HEAD -- hooks/`);
  console.log(out.length ? out : '(empty)');
  const ok = out.trim() === '';
  (ok ? pass : fail)('P6', ok ? 'empty diff — Phase 7 B hooks untouched' : 'Phase 7 B hooks were modified');
}

function P7() {
  header('P7', 'Zone check — git status --short');
  const st = spawnSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' });
  const lines = (st.stdout || '').split('\n').filter(Boolean);
  show('status -s', lines.length ? lines : '(clean)');
  const outOfZone = lines
    .map((l) => l.replace(/^\s*\S+\s+/, ''))
    .filter((f) => !(f.startsWith(`${BUNDLE}/`) || /^scripts\/phase22-.*\.mjs$/.test(f)));
  show('out-of-zone entries', outOfZone);
  const ok = outOfZone.length === 0;
  (ok ? pass : fail)('P7', ok
    ? `every changed path is under ${BUNDLE}/** or scripts/phase22-*.mjs`
    : `out-of-zone: ${outOfZone.join(', ')}`);
}

console.log(`PROBE phase22-d  repo=${REPO}  node=${process.version}`);
console.log(`upstream pinned commit: ${UPSTREAM_COMMIT}`);
if (run('P1')) P1();
if (run('P2')) P2();
if (run('P3')) P3();
if (run('P4')) P4();
if (run('P5')) P5();
if (run('P6')) P6();
if (run('P7')) P7();

console.log('\n──────────── VERDICTS ────────────');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
process.exit(Object.values(results).some((v) => v.startsWith('FAIL')) ? 1 : 0);