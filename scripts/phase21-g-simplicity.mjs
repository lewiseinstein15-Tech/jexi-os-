// PHASE 21 — SCOPE G — LIVE PROBE: the simplicity criterion.
// Zone-compliant: no file writes at all.
import assert from 'node:assert';
import { score, compare, SIMPLICITY_EPS } from '../services/research/simplicity/scorer.js';

const show = (label, s) => {
  console.log(`[${label}] metricGain=${s.metricGain} complexityCost=${s.complexityCost} minimumGain=${s.minimumGain?.toFixed(6)} worth=${s.worth}`);
  for (const r of s.reasons) console.log(`    - ${r}`);
};

try {
  // ---- case 1: small gain + big hacky code -> NOT worth (the phase's exact rule) ----
  const hackyBig = score({
    metricGain: 0.001,
    diff: { added: 20, removed: 0 },
    filesChanged: 0,
    code: 'const fastPath = eval(userExpr); // dynamic dispatch smell',
  });
  show('case 1: gain 0.001, 20 lines + eval smell', hackyBig);

  // ---- case 2: same small gain, fewer clean lines -> worth ----
  const cleanSmall = score({
    metricGain: 0.001,
    diff: { added: 4, removed: 0 },
    filesChanged: 0,
  });
  show('case 2: gain 0.001, 4 clean lines', cleanSmall);

  // ---- case 3: simpler wins ties ----
  const tieA = { metricGain: 0.002, diff: { added: 10, removed: 0 } };
  const tieB = { metricGain: 0.002, diff: { added: 4, removed: 0 } };
  const cmp = compare(tieA, tieB);
  console.log(`[case 3] compare(10-line, 4-line) with equal gain 0.002 -> ${cmp}`);

  // ---- case 4: pure simplification (zero gain, shrinks the code) -> worth ----
  const simplify = score({ metricGain: 0, diff: { added: 0, removed: 6 } });
  show('case 4: zero gain, -6 lines', simplify);

  // ---- case 5: regression -> never worth ----
  const regression = score({ metricGain: -0.01, diff: { added: 2, removed: 0 } });
  show('case 5: metric regressed', regression);

  // ---- case 6: unscorable input is honest ----
  const nonsense = score({ code: 'predict(x) { return 0.7*x+0.2 }' });
  show('case 6: no metric pair', nonsense);

  // ---- assertions ----
  assert.equal(hackyBig.worth, false, '0.001 gain + 20 hacky lines must NOT be worth it');
  assert.equal(hackyBig.complexityCost, 30, '20 lines + 1 eval smell = 20 + 10');
  assert.equal(cleanSmall.worth, true, '0.001 gain + 4 clean lines must be worth it');
  assert.ok(cleanSmall.complexityCost < hackyBig.complexityCost);
  assert.equal(cmp, 'b', 'simpler experiment must win the tie');
  assert.equal(simplify.worth, true, 'pure simplification is worth it');
  assert.equal(regression.worth, false);
  assert.equal(nonsense.worth, false);
  assert.ok(nonsense.reasons[0].includes('cannot score'));
  assert.equal(SIMPLICITY_EPS, 0.0002);

  console.log('\nSCOPE G PROBE PASSED');
} catch (err) {
  console.error('PROBE FAILURE:', err?.message ?? err);
  process.exit(1);
}
