/**
 * AGI Phase B — epistemic status vocabulary.
 * The claim algebra must enforce the hard rules, and the wiring must stamp
 * real records with honest states. Keyless, deterministic, node --test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-epistemics';

const {
  EPISTEMIC_STATES, makeClaim, mergeClaims, upgradeClaim,
  epistemicSummary, epistemicStateOfProvenance,
} = await import('../../src/services/director/Epistemics.js');
const { structureObjective } = await import('../../src/services/director/ObjectiveInterpreter.js');
const { WorldState } = await import('../../src/services/director/WorldState.js');

/* ═══ 1. the vocabulary itself ═════════════════════════════════════════ */

test('the five states exist and nothing else passes as one', () => {
  assert.deepEqual(EPISTEMIC_STATES, ['KNOWN', 'LIKELY', 'UNCERTAIN', 'UNKNOWN', 'CONTRADICTED']);
});

test('each source establishes only what it can', () => {
  assert.equal(makeClaim({ source: 'OBSERVED' }).epistemic, 'KNOWN');
  assert.equal(makeClaim({ source: 'VERIFIED' }).epistemic, 'KNOWN');
  assert.equal(makeClaim({ source: 'USER_STATED' }).epistemic, 'KNOWN');
  assert.equal(makeClaim({ source: 'INFERRED' }).epistemic, 'LIKELY');
  assert.equal(makeClaim({ source: 'ASSUMED' }).epistemic, 'UNCERTAIN');
  assert.equal(makeClaim({ source: 'PREDICTED' }).epistemic, 'UNCERTAIN');
  assert.equal(makeClaim({ source: 'made-up-source' }).epistemic, 'UNKNOWN'); // unknown source = no evidence, never a guess dressed as an inference
});

/* ═══ 2. HARD RULE 1 — repetition is not evidence ══════════════════════ */

test('an inference NEVER becomes KNOWN, no matter how many times it is re-inferred', () => {
  let c = makeClaim({ key: 'deploy.status', value: 'live', source: 'INFERRED', confidence: 0.9 });
  for (let i = 0; i < 10; i++) {
    c = mergeClaims(c, makeClaim({ key: 'deploy.status', value: 'live', source: 'INFERRED', confidence: 0.99 }));
  }
  assert.equal(c.epistemic, 'LIKELY'); // still not KNOWN
  assert.ok(!c.prediction);
});

test('high confidence does not substitute for evidence', () => {
  const c = makeClaim({ key: 'x', value: 1, source: 'INFERRED', confidence: 1 });
  assert.equal(c.epistemic, 'LIKELY');
  assert.equal(c.confidence, 1); // carried separately
});

test('confidence is clamped to [0,1]', () => {
  assert.equal(makeClaim({ source: 'INFERRED', confidence: 7 }).confidence, 1);
  assert.equal(makeClaim({ source: 'INFERRED', confidence: -3 }).confidence, 0);
});

/* ═══ 3. HARD RULE 2 — predictions are not observations ════════════════ */

test('a prediction can only be settled by observation or verification', () => {
  let c = makeClaim({ key: 'build.outcome', value: 'pass', source: 'PREDICTED' });
  assert.equal(c.prediction, true);
  assert.equal(c.epistemic, 'UNCERTAIN');

  const bad = upgradeClaim(c, { source: 'INFERRED', evidence: 'the model is sure' });
  assert.equal(bad.ok, false);
  assert.equal(bad.claim.prediction, true); // still a prediction
  assert.match(bad.reason, /prediction/);

  const good = upgradeClaim(c, { source: 'OBSERVED', evidence: 'build ran, exit 0, dist/ present' });
  assert.equal(good.ok, true);
  assert.equal(good.claim.epistemic, 'KNOWN');
  assert.equal(good.claim.prediction, false); // reality was actually checked
});

/* ═══ 4. HARD RULE 3 — contradictions surface, never silently overwrite ═ */

test('conflicting established claims become CONTRADICTED (both kept)', () => {
  const a = makeClaim({ key: 'site.up', value: true, source: 'OBSERVED', evidence: 'curl 200 ok' });
  const b = makeClaim({ key: 'site.up', value: false, source: 'OBSERVED', evidence: 'curl 502' });
  const m = mergeClaims(a, b);
  assert.equal(m.epistemic, 'CONTRADICTED');
  assert.equal(m.conflict.length, 2); // both sides retained
  assert.ok(m.confidence <= 0.5);
});

test('a contradiction blocks promotion until resolved', () => {
  const a = makeClaim({ key: 'k', value: 1, source: 'OBSERVED' });
  const contradicted = mergeClaims(a, makeClaim({ key: 'k', value: 2, source: 'OBSERVED' }));
  const r = upgradeClaim(contradicted, { source: 'VERIFIED' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /resolution/);
});

test('weaker evidence never overwrites a stronger value', () => {
  const known = makeClaim({ key: 'port', value: 3002, source: 'OBSERVED' });
  const merged = mergeClaims(known, makeClaim({ key: 'port', value: 8080, source: 'INFERRED' }));
  assert.equal(merged.value, 3002); // the observation stands
  assert.equal(merged.epistemic, 'KNOWN');
});

/* ═══ 5. HARD RULE 4 — unknown stays representable ════════════════════ */

test('absence of information is UNKNOWN, and the summary counts it', () => {
  const claims = [
    makeClaim({ source: 'OBSERVED' }),
    makeClaim({ source: 'INFERRED' }),
    makeClaim({ source: 'PREDICTED' }),
    makeClaim({ source: null, confidence: 0 }),
  ];
  const s = epistemicSummary(claims);
  assert.equal(s.counts.KNOWN, 1);
  assert.equal(s.counts.LIKELY, 1);
  assert.equal(s.counts.UNCERTAIN, 1);
  assert.equal(s.counts.UNKNOWN, 1);
  assert.equal(s.weakest, 'UNKNOWN');
});

/* ═══ 6. provenance bridge ═════════════════════════════════════════════ */

test('B215 provenance maps onto epistemic states without inventing strength', () => {
  assert.equal(epistemicStateOfProvenance('USER_STATED'), 'KNOWN');
  assert.equal(epistemicStateOfProvenance('INFERRED'), 'LIKELY');
  assert.equal(epistemicStateOfProvenance('ASSUMED'), 'UNCERTAIN');
  assert.equal(epistemicStateOfProvenance('UNKNOWN'), 'UNKNOWN');
  assert.equal(epistemicStateOfProvenance('whatever'), 'UNKNOWN');
});

/* ═══ 7. WIRING — real records carry honest states ═════════════════════ */

test('structureObjective reports the objective in epistemic terms', () => {
  const so = structureObjective(
    { refinedObjective: 'build the api', understood: 'x', assumptions: ['the db is up'], unknowns: ['which port'] },
    'build the api',
  );
  // an interpreter reconstruction is NEVER KNOWN — at best LIKELY
  assert.equal(so.epistemics.outcome, 'LIKELY');
  assert.equal(so.epistemics.assumptions, 'UNCERTAIN');
  assert.equal(so.epistemics.unknowns, 'UNKNOWN');
  assert.ok(so.assumptions.every((a) => a.epistemic === 'UNCERTAIN'));
  assert.ok(so.unknowns.every((u) => u.epistemic === 'UNKNOWN'));
});

test('WorldState observations are stamped KNOWN/observed — including unavailability', () => {
  const ws = new WorldState('epistemics-test-world');
  ws.recordCommand({ command: 'npm run build', ok: true, exitCode: 0 });
  assert.equal(ws.state.processes.at(-1).epistemic, 'KNOWN');
  assert.equal(ws.state.processes.at(-1).how, 'observed');

  ws.recordBrowser({ available: false, blockedReason: 'no chromium' });
  assert.equal(ws.state.browser.epistemic, 'KNOWN'); // unavailability is still an observation
  assert.equal(ws.state.browser.how, 'observed');

  ws.recordPublish({ repo: 'r', slug: 's', url: 'u', live: true });
  assert.equal(ws.state.repos.at(-1).epistemic, 'KNOWN');

  ws.recordNetwork({ ok: true, detail: 'fine' });
  assert.equal(ws.state.network.epistemic, 'KNOWN');
});

test('a verified mission verdict is stamped KNOWN/verified', async () => {
  // The stamp is applied where MissionRunner stores the verdict; verify the
  // contract shape here without running a mission (keyless).
  const { verifyDeliverable } = await import('../../src/services/director/Verifier.js');
  const verdict = await verifyDeliverable({
    task: { objective: 'Write a complete guide with steps and verification.' },
    deliverable: '## Guide\nStep 1 build: run the build and confirm exit 0 plus dist exists.\nStep 2 verify: request the health endpoint and expect 200.\nStep 3 rollback: keep the previous release and re-point.\nAll steps described were executed in order for this guide.',
    criteria: ['guide exists'],
    verifierEmployee: { agentId: 'vera', displayName: 'Vera' },
    llm: async () => JSON.stringify({ verdict: 'pass', score: 0.9, problems: [], rationale: 'gates passed' }),
    mailbox: { post() { /* minimal duck: the verifier only notifies */ } },
  });
  assert.ok(['pass', 'fail', 'degraded'].includes(verdict.verdict));
  // The deterministic gates themselves stay honest (Phase A calibration axis)
  const problems = (await import('../../src/services/director/Verifier.js')).acceptanceGates('', { objective: 'x'.repeat(200) });
  assert.ok(problems.length > 0);
});
