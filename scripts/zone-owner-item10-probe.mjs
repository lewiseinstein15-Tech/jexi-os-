#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 10 LIVE PROBE — phase9-h-probe.mjs clean-skip on no browser.
 * Run from repo root:  node scripts/zone-owner-item10-probe.mjs
 * Proves:
 *   - OLD probe (pre-cleanup-zone-owner-2) crashes with TypeError
 *     (decodePng(null)) / false-FAILs when no browser exists
 *   - NEW probe clean-skips: "SKIP: ... BROWSER_UNAVAILABLE", exit 2
 *     (exit 0 with --skip-ok) — the runner CLI's own contract
 *   - browser-independent cases still run everywhere: p7, p11 PASS;
 *     p9 skips only its browser cases and still proves CLI skip exit codes
 *   - real absence (no forced env) behaves identically when this sandbox
 *     has no browser; when one IS present, p2 must fully pass instead
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const NODE = process.execPath;
const NEW = 'scripts/phase9-h-probe.mjs';
const OLD = 'scripts/.tmp-old-phase9-h-item10.mjs';
const NOB = { JEXI_VISUAL_NO_BROWSER: '1' };

let checks = 0; let fails = 0;
const check = (label, cond, detail = '') => {
  checks += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails += 1;
};
const run = (script, args, env = {}) => {
  const r = spawnSync(NODE, [script, ...args], {
    encoding: 'utf8', timeout: 180000, env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// materialize the OLD probe from the pre-tag (ROOT resolves: file lives in scripts/)
const oldSrc = spawnSync('git', ['show', `pre-cleanup-zone-owner-2:${NEW}`], { encoding: 'utf8' }).stdout;
writeFileSync(OLD, oldSrc, 'utf8');

try {
  // ---- 1. OLD p2 crashes with the documented TypeError (flake... the bug reproduced)
  const o = run(OLD, ['p2'], NOB);
  check('OLD probe p2 crashes with TypeError (decodePng(null)) when no browser',
    o.code === 1 && /ERR_INVALID_ARG_TYPE|TypeError/.test(o.out) && !o.out.includes('SKIP:'),
    `exit=${o.code}, TypeError present=${/ERR_INVALID_ARG_TYPE|TypeError/.test(o.out)}`);

  // ---- 2. OLD p1 false-FAILs detection instead of skipping
  const o1 = run(OLD, ['p1'], NOB);
  check('OLD probe p1 false-FAILs (exit 1, no clean skip) when no browser',
    o1.code === 1 && !o1.out.includes('SKIP:'), `exit=${o1.code}`);

  // ---- 3. NEW p2 clean-skips: exit 2, BROWSER_UNAVAILABLE, no TypeError
  const n2 = run(NEW, ['p2'], NOB);
  check('NEW probe p2 clean-skips (exit 2, BROWSER_UNAVAILABLE, no TypeError)',
    n2.code === 2 && n2.out.includes('SKIP: P2 — BROWSER_UNAVAILABLE') && !/ERR_INVALID_ARG_TYPE|TypeError/.test(n2.out),
    `exit=${n2.code}`);

  // ---- 4. NEW p2 with --skip-ok: exit 0 (runner CLI parity)
  const n2s = run(NEW, ['p2', '--skip-ok'], NOB);
  check('NEW probe p2 --skip-ok exits 0 with the SKIP banner (runner CLI parity)',
    n2s.code === 0 && n2s.out.includes('SKIP: P2 — BROWSER_UNAVAILABLE'), `exit=${n2s.code}`);

  // ---- 5. NEW p1, p6, p10 all clean-skip (exit 2, no crash)
  for (const c of ['p1', 'p6', 'p10']) {
    const r = run(NEW, [c], NOB);
    check(`NEW probe ${c} clean-skips (exit 2, no TypeError)`,
      r.code === 2 && r.out.includes(`SKIP: ${c.toUpperCase()} — BROWSER_UNAVAILABLE`) && !/ERR_INVALID_ARG_TYPE|TypeError/.test(r.out),
      `exit=${r.code}`);
  }

  // ---- 6. NEW p7 still PASSES (the skip-path test itself — regression guard)
  const n7 = run(NEW, ['p7'], NOB);
  check('NEW probe p7 still passes (skip-path test unaffected)',
    n7.code === 0 && /\[P7\] \d+ PASS \/ 0 FAIL/.test(n7.out), `exit=${n7.code}`);

  // ---- 7. NEW p9: skips ONLY browser cases, still proves CLI skip exit codes
  const n9 = run(NEW, ['p9'], NOB);
  check('NEW probe p9 skips cases 1–2 but runs CLI-skip cases 3–4 (exit 0, "2 SKIP")',
    n9.code === 0 && n9.out.includes('SKIP: P9 case 1') && n9.out.includes('SKIP: P9 case 2')
    && n9.out.includes('skip with --skip-ok → exit 0') && /\[P9\] \d+ PASS \/ 0 FAIL \/ 2 SKIP/.test(n9.out),
    `exit=${n9.code}`);

  // ---- 8. NEW p11 still PASSES (browser-independent)
  const n11 = run(NEW, ['p11'], NOB);
  check('NEW probe p11 still passes (browser-independent)',
    n11.code === 0 && /\[P11\] \d+ PASS \/ 0 FAIL/.test(n11.out), `exit=${n11.code}`);

  // ---- 9. REAL absence (no forced env): behavior depends on what detection finds
  const det = (await import('../tests/verification/visual/puppeteer-runner.js')).detectBrowser();
  const real = run(NEW, ['p2']);
  if (det.available === true) {
    check('REAL environment HAS a browser → p2 runs for real (no SKIP banner)',
      real.code === 0 && !real.out.includes('SKIP:'), `exit=${real.code}, flavor=${det.flavor}`);
  } else {
    check('REAL environment has NO browser → p2 clean-skips without any forced env',
      real.code === 2 && real.out.includes('BROWSER_UNAVAILABLE') && !/ERR_INVALID_ARG_TYPE|TypeError/.test(real.out),
      `exit=${real.code}, detail=${det.detail}`);
  }
} finally {
  rmSync(OLD, { force: true });
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
