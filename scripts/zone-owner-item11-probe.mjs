#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 11 LIVE PROBE — phase9-i p12 / phase9-j p11 stale session
 * assertions (hardcoded branch `phase-9-glm` + HEAD + clean tree).
 * Run from repo root:  node scripts/zone-owner-item11-probe.mjs
 * Proves:
 *   - OLD probes (pre-cleanup-zone-owner-2) FAIL in any post-merge session
 *   - NEW probes PASS: the gate commit is DISCOVERED from history (the commit
 *     that added the probe) and matches the documented gate commits
 *     (8858281 phase-9(I) 16 files, 53ca1d7 phase-9(J) 2 files)
 *   - override (--commit / JEXI_PHASE_COMMIT) is wired and assertions are
 *     NOT vacuous: a wrong-shape commit makes them fail
 *   - a dirty working tree no longer matters (session-state check retired)
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const NODE = process.execPath;
const OLD_I = 'scripts/.tmp-old-phase9-i-item11.mjs';
const OLD_J = 'scripts/.tmp-old-phase9-j-item11.mjs';

let checks = 0; let fails = 0;
const check = (label, cond, detail = '') => {
  checks += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails += 1;
};
const run = (script, args = [], env = {}) => {
  const r = spawnSync(NODE, [script, ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const git = (args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();

for (const [tag, file, out] of [['phase9-i-probe.mjs', 'scripts/phase9-i-probe.mjs', OLD_I], ['phase9-j-probe.mjs', 'scripts/phase9-j-probe.mjs', OLD_J]]) {
  writeFileSync(out, git(['show', `pre-cleanup-zone-owner-2:${file}`]), 'utf8');
}

try {
  // ---- 1. OLD probes fail in this post-merge session (staleness reproduced)
  const oi = run(OLD_I, ['p12']);
  check('OLD i-probe p12 FAILS post-merge (hardcoded branch/HEAD/clean-tree)',
    oi.code === 1 && oi.out.includes("phase-9-glm"), `exit=${oi.code}`);
  const oj = run(OLD_J, ['p11']);
  check('OLD j-probe p11 FAILS post-merge (same stale session assertions)',
    oj.code === 1 && oj.out.includes("phase-9-glm"), `exit=${oj.code}`);

  // ---- 2. NEW probes pass and discover the documented gate commits
  const expI = git(['log', '--format=%H', '--diff-filter=A', '--', 'scripts/phase9-i-probe.mjs']);
  const expJ = git(['log', '--format=%H', '--diff-filter=A', '--', 'scripts/phase9-j-probe.mjs']);
  check('history has exactly ONE commit adding each probe (discovery is deterministic)',
    expI.split('\n').length === 1 && expJ.split('\n').length === 1, `I=${expI.slice(0, 7)}, J=${expJ.slice(0, 7)}`);
  check('discovered gate commits are the documented ones (8858281 / 53ca1d7)',
    expI.startsWith('8858281') && expJ.startsWith('53ca1d7'), `I=${expI.slice(0, 7)}, J=${expJ.slice(0, 7)}`);

  const ni = run('scripts/phase9-i-probe.mjs', ['p12']);
  check('NEW i-probe p12 PASSES post-merge (16-file shape + ancestor containment)',
    ni.code === 0 && ni.out.includes(`PHASE COMMIT: ${expI}`) && /\[P12\] \d+ PASS \/ 0 FAIL/.test(ni.out), `exit=${ni.code}`);
  const nj = run('scripts/phase9-j-probe.mjs', ['p11']);
  check('NEW j-probe p11 PASSES post-merge (2-file shape + ancestor containment)',
    nj.code === 0 && nj.out.includes(`PHASE COMMIT: ${expJ}`) && /\[P11\] \d+ PASS \/ 0 FAIL/.test(nj.out), `exit=${nj.code}`);

  // ---- 3. override is wired; assertions are NOT vacuous (wrong-shape commit fails)
  const wrong = git(['rev-parse', 'pre-cleanup-zone-owner-2']); // merge-tag commit: many files, not the gate shape
  const ow = run('scripts/phase9-i-probe.mjs', ['p12', `--commit=${wrong}`]);
  check('--commit override reaches the shape assertions (wrong-shape commit → FAIL, not vacuous pass)',
    ow.code === 1 && ow.out.includes(`PHASE COMMIT: ${wrong} (override)`) && ow.out.includes('exactly 16 files'), `exit=${ow.code}`);
  const oe = run('scripts/phase9-j-probe.mjs', ['p11'], { JEXI_PHASE_COMMIT: expJ });
  check('JEXI_PHASE_COMMIT env override works (right commit → PASS)',
    oe.code === 0 && oe.out.includes('(override)'), `exit=${oe.code}`);

  // ---- 4. dirty tree no longer matters (session-state check retired)
  writeFileSync('tmp-item11-junk.txt', 'untracked junk for the dirty-tree check\n', 'utf8');
  const nd = run('scripts/phase9-i-probe.mjs', ['p12']);
  const od = run(OLD_I, ['p12']);
  rmSync('tmp-item11-junk.txt', { force: true });
  check('NEW p12 passes with an untracked junk file in the tree (status check retired)',
    nd.code === 0, `exit=${nd.code}`);
  check('OLD p12 flags the same tree (proves the retired check was session state)',
    od.code === 1, `exit=${od.code}`);
} finally {
  rmSync(OLD_I, { force: true });
  rmSync(OLD_J, { force: true });
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
