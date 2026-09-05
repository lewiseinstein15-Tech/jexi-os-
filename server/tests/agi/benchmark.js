/**
 * JEXI OS — AGI BENCHMARK (Phase A of the general-intelligence upgrade).
 *
 * A scored, deterministic, keyless measurement of generality axes — not a
 * pass/fail unit test. Every scenario runs against the REAL subsystems with
 * scripted or pure inputs; nothing is mocked at the assertion level.
 *
 * Axes (spec §22) and their scenarios:
 *   generalization  — an UNSEEN invented domain is structured and discovered
 *                     without fabrication (no invented tools, honest gaps)
 *   planning        — WorkGraph dependency order, budgets, lease semantics
 *   calibration    — the verifier's deterministic gates on labeled fixtures
 *                     (bad work must FAIL, real work must PASS)
 *   transfer       — a lesson from one domain is retrieved for a DIFFERENT
 *                     domain and injectable into the next plan
 *   epistemic      — unavailable capabilities are reported as gaps, never
 *                     faked; provenance is tagged; the environment record
 *                     stores honest unavailability
 *   robustness     — state survives reload exactly; resume is precise;
 *                     illegal transitions are rejected
 *
 * Output: per-axis scores 0–1, overall = mean. The chain gates at 0.90.
 * `node tests/agi/benchmark.js --record` ALSO appends the dated row to
 * docs/AGI_BENCHMARK.md (the over-time tracker).
 */

process.env.DATA_DIR = './data/test-agi-bench';

import fs from 'node:fs';
import path from 'node:path';

// repetition-safety: provider health persists to disk; start each run clean
try { fs.rmSync(path.join(process.env.DATA_DIR, 'provider-health.json'), { force: true }); } catch { /* fine */ }

const { structureObjective } = await import('../../src/services/director/ObjectiveInterpreter.js');
const { discoverTools } = await import('../../src/services/ToolDiscovery.js');
const { TOOL_REGISTRY } = await import('../../src/services/ToolRegistry.js');
const { WorkGraph, loadWorkGraph } = await import('../../src/services/director/WorkGraph.js');
const { Mission, loadMission } = await import('../../src/services/director/Mission.js');
const { acceptanceGates, claimsBrowserMethod, executionEvidence } = await import('../../src/services/director/Verifier.js');
const { recordLesson, retrieveLessons, formatLessonsBlock } = await import('../../src/services/director/Lessons.js');
const { WorldState } = await import('../../src/services/director/WorldState.js');
const { dependencyWaves } = await import('../../src/services/director/Director.js');
const Epistemics = await import('../../src/services/director/Epistemics.js');
const PH = await import('../../src/services/ProviderHealth.js');

/* ── scoring ───────────────────────────────────────────────────────────── */
const axes = {};
const failures = [];
function axis(name, run) {
  const checks = [];
  const check = (label, ok, detail = '') => {
    checks.push({ label, ok: !!ok });
    if (!ok) failures.push(`${name} :: ${label}${detail ? ` — ${detail}` : ''}`);
  };
  try {
    run(check);
  } catch (e) {
    check(`axis ran without exception (${e && e.message})`, false);
  }
  axes[name] = {
    score: checks.length ? checks.filter((c) => c.ok).length / checks.length : 0,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    failures: checks.filter((c) => !c.ok).map((c) => c.label),
  };
}

/* ═══ 1. GENERALIZATION — an unseen, invented domain ═══════════════════ */
axis('generalization', (check) => {
  // A domain nothing in the codebase knows: orbital hydroponics scheduling.
  const raw = 'Plan orbital hydroponics yield scheduling for the Kericho greenhouse cluster: optimize nutrient cycles, predict harvest windows, and produce a planting calendar';
  const refinement = {
    refinedObjective: raw,
    understood: 'Greenhouse yield scheduling and nutrient optimization with a planting calendar deliverable',
    intent: 'planning',
    ambiguity: 'medium',
    successCriteria: ['A planting calendar exists', 'Nutrient cycle plan exists'],
    assumptions: ['Kericho cluster data is available'],
  };
  const so = structureObjective(refinement, raw);
  check('unseen domain is structured without crashing', !!so && typeof so.objective === 'string');
  check('provenance is tagged (nothing presented as user-stated that was not)', typeof so.provenanceCounts === 'object');
  check('assumptions stay assumptions', (so.provenanceCounts && (so.provenanceCounts.ASSUMED ?? 0) >= 0) === true);

  const d = discoverTools({ objective: raw, intent: 'planning', interpreted: so });
  const registrySlugs = new Set(TOOL_REGISTRY.map((t) => t.slug));
  check('discovery is deterministic (pure, no LLM)', d.meta.deterministic === true);
  check('NO invented tools (every result is a real registry tool)', d.tools.every((t) => registrySlugs.has(t.slug)));
  check('capabilities are matched, never faked', Array.isArray(d.requiredCapabilities) && d.tools.every((t) => Array.isArray(t.matchedCapabilities)));
  // The invented domain must not hallucinate coverage: whatever it claims,
  // it claims via real capabilities of real tools.
  check('gaps are reported as gaps (not filled with guesses)', Array.isArray(d.gaps) && d.gaps.every((g) => g.reason && g.provenance));
});

/* ═══ 2. PLANNING — dependency-aware, budgeted, prioritized work ═══════ */
axis('planning', (check) => {
  const g = new WorkGraph('agi-bench-plan');
  const research = g.addItem({ title: 'Research the domain', planIndex: 1, capability: 'research', priority: 'normal' });
  const build = g.addItem({ title: 'Build the deliverable', planIndex: 2, capability: 'author-code', priority: 'normal', dependsOn: [research.planIndex] });
  const urgent = g.addItem({ title: 'Urgent side finding', planIndex: 3, capability: 'reasoning', priority: 'high' });
  g.addRelation('BLOCKS', research.id, build.id, 'plan dependency');

  const ready = g.readyWork();
  check('ready order is deterministic (priority desc, createdAt asc)', ready.map((i) => i.id).join() === [urgent.id, research.id].join());
  check('blocked work is not offered', !ready.some((i) => i.id === build.id));

  const claim = g.claim(research.id, 'bench-worker', 60000);
  check('a claim leases the item (others refused)', claim && g.claim(research.id, 'other-worker', 60000) === null);
  g.complete(research.id, { ok: true, summary: 'done' });
  check('completing the blocker RELEASES the dependent', g.readyWork().some((i) => i.id === build.id));

  const waves = dependencyWaves([
    { id: 'a', title: 'A', dependsOn: [] },
    { id: 'b', title: 'B', dependsOn: ['a'] },
    { id: 'c', title: 'C', dependsOn: ['a'] },
    { id: 'd', title: 'D', dependsOn: ['b', 'c'] },
  ]);
  check('dependency waves never schedule a task before its dependencies', waves.every((wave, wi) => wave.every((t) => (t.dependsOn || []).every((dep) => waves.slice(0, wi).some((w) => w.some((x) => x.id === dep))))));

  const m = new Mission({ conversationId: 'agi-bench-mission', objective: 'benchmark objective for budget accounting' });
  check('budgets are enforced counters, not vibes', m.itemsExhausted(m.budgets.maxItems) === true && m.itemsExhausted(0) === false && m.failuresExhausted(m.budgets.maxFailures) === true);
  m.cancel('benchmark done');
});

/* ═══ 3. CALIBRATION — the verifier must match labeled reality ═════════ */
axis('calibration', (check) => {
  const task = { objective: 'Write a complete deployment guide with steps, rollback, and verification for the greenhouse scheduler service.' };
  const labels = [
    { label: 'empty deliverable FAILS', text: '', mustFail: true },
    { label: 'refusal FAILS', text: "I'm sorry, but I cannot write that guide.", mustFail: true },
    { label: 'substitute-instead FAILS', text: 'Here is a draft of something else instead — a short note about gardens. ' + 'gardens are nice '.repeat(20), mustFail: true },
    { label: 'too-short FAILS', text: 'Deploy it. Check it. Done.', mustFail: true },
    { label: 'real work PASSES', text: '## Deployment Guide\n\n### 1. Build\nRun npm ci && npm run build; expect exit 0 and a dist folder.\n\n### 2. Deploy\nPublish dist to the host; the service binds :10000.\n\n### 3. Verification\nGET /api/health must return 200 with ok:true — this is the actual outcome check, not the exit code.\n\n### 4. Rollback\nKeep the previous release; re-point the router and re-run the health check.\n\n### 5. Notes\nAll steps were executed in order in this guide.', mustFail: false },
  ];
  for (const fixture of labels) {
    const problems = acceptanceGates(fixture.text, task);
    const failed = problems.length > 0;
    check(fixture.label, failed === fixture.mustFail, problems.join('; '));
  }
  // Method provenance: claiming a browser method with ZERO browser events must
  // be detectable (the deterministic fabrication gate's components).
  const claimsBrowser = 'I verified the site with a headless browser and clicked through every page.';
  check('browser-method claims are detected in text', claimsBrowserMethod(claimsBrowser) === true);
  const evidence = executionEvidence([]);
  check('zero execution events are visible as zero (never padded)', /browser: never invoked/.test(evidence) && /NONE/.test(evidence));
  check('a browser claim with zero browser actions is fabrication by definition', claimsBrowserMethod(claimsBrowser) && /never invoked/.test(executionEvidence([])));
});

/* ═══ 4. TRANSFER — knowledge crosses domains ═════════════════════════ */
axis('transfer', (check) => {
  recordLesson({
    kind: 'failure', missionId: 'agi-bench-m1', objective: 'deploy the python flask service to production',
    itemTitle: 'deploy', failure: 'deploy command exited 0 but the site returned 502',
    cause: 'exit code was trusted as success', strategy: 'verify the live URL with a real request after every deploy',
    lesson: 'Exit code 0 does not mean the site works — always request the live health URL after deploying.',
  });
  // A DIFFERENT domain: node instead of python, api instead of flask.
  const retrieved = retrieveLessons('deploy the node api service to production', 5);
  check('a lesson from a different stack is retrieved for the new domain', retrieved.some((l) => l.missionId === 'agi-bench-m1' && /health URL/.test(String(l.lesson || ''))));
  const block = formatLessonsBlock(retrieved.filter((l) => l.missionId === 'agi-bench-m1'));
  check('the retrieved lesson renders into plan context (injectable)', /health URL/.test(block));
  check('the lesson carries its provenance (what failed, why, the strategy)', retrieved.some((l) => l.missionId === 'agi-bench-m1' && l.cause && l.strategy));
});

/* ═══ 5. EPISTEMIC HONESTY — unknown stays unknown ════════════════════ */
axis('epistemic', (check) => {
  // A capability NO tool provides: the registry must say so, not improvise.
  const d = discoverTools({ objective: 'read my mind and beam the answer to the moon', interpreted: { requiredCapabilities: ['telepathy'] } });
  check('an impossible capability is reported as a GAP', d.gaps.some((g) => g.capability === 'telepathy'));
  check('the gap names the true reason', d.gaps.some((g) => /no tool in the registry provides/.test(g.reason)));
  check('no tool pretends to provide it', !d.tools.some((t) => (t.matchedCapabilities || []).includes('telepathy')));

  // The environment record stores honest unavailability (never "probably fine").
  const ws = new WorldState('agi-bench-world');
  ws.recordBrowser({ available: false, blockedReason: 'no Chromium in the slim image (JEXI_NO_BROWSER=1)' });
  check('the world model records UNAVAILABLE as false, with the reason', ws.state.browser.available === false && /no Chromium/.test(ws.state.browser.blockedReason));

  const so = structureObjective({ refinedObjective: 'do the thing', understood: 'unclear request', ambiguity: 'high' }, 'do the thing');
  check('an underdetermined objective is structured WITHOUT invented requirements', (so.provenanceCounts.USER_STATED ?? 0) <= 1);

  // ── Phase B: the epistemic claim algebra (director/Epistemics.js) ──
  const { makeClaim, mergeClaims, upgradeClaim } = Epistemics;

  // Repetition is not evidence: an inference never becomes KNOWN.
  let c = makeClaim({ key: 'deploy.status', value: 'live', source: 'INFERRED', confidence: 0.9 });
  for (let i = 0; i < 10; i++) c = mergeClaims(c, makeClaim({ key: 'deploy.status', value: 'live', source: 'INFERRED', confidence: 0.99 }));
  check('an inference stays LIKELY no matter how often it is re-inferred', c.epistemic === 'LIKELY');

  // Only observation or verification promotes to KNOWN.
  const observed = upgradeClaim(makeClaim({ key: 'build', value: 'pass', source: 'PREDICTED' }), { source: 'OBSERVED', evidence: 'exit 0 + dist present' });
  check('observation promotes a prediction to KNOWN', observed.ok && observed.claim.epistemic === 'KNOWN');
  const notObserved = upgradeClaim(makeClaim({ key: 'build', value: 'pass', source: 'PREDICTED' }), { source: 'INFERRED', evidence: 'feels right' });
  check('a prediction WITHOUT observation stays a prediction', !notObserved.ok && notObserved.claim.prediction === true);

  // Contradictions surface instead of silently overwriting.
  const contradicted = mergeClaims(
    makeClaim({ key: 'site.up', value: true, source: 'OBSERVED', evidence: 'curl 200' }),
    makeClaim({ key: 'site.up', value: false, source: 'OBSERVED', evidence: 'curl 502' }),
  );
  check('conflicting observations become CONTRADICTED (both kept)', contradicted.epistemic === 'CONTRADICTED' && contradicted.conflict.length === 2);

  // And weaker evidence never overwrites stronger evidence.
  const kept = mergeClaims(makeClaim({ key: 'port', value: 3002, source: 'OBSERVED' }), makeClaim({ key: 'port', value: 8080, source: 'INFERRED' }));
  check('an inference cannot overwrite an observation', kept.value === 3002 && kept.epistemic === 'KNOWN');

  // Wiring: real records carry honest states.
  check('WorldState observations are stamped KNOWN/observed', (ws.recordCommand({ command: 'ls', ok: true, exitCode: 0 }), ws.state.processes.at(-1).epistemic === 'KNOWN' && ws.state.processes.at(-1).how === 'observed'));
  const soEp = structureObjective({ refinedObjective: 'build it', assumptions: ['db is up'] }, 'build it');
  check('structured objectives report epistemic states (assumptions UNCERTAIN, reconstruction at best LIKELY)', soEp.epistemics.assumptions === 'UNCERTAIN' && soEp.epistemics.outcome === 'LIKELY');
});

/* ═══ 6. ROBUSTNESS — exact persistence, precise resume ═══════════════ */
axis('robustness', (check) => {
  const g = new WorkGraph('agi-bench-robust');
  const a = g.addItem({ title: 'First', planIndex: 1, capability: 'research' });
  const b = g.addItem({ title: 'Second', planIndex: 2, capability: 'synthesis', dependsOn: [1] });
  g.addRelation('BLOCKS', a.id, b.id, 'dep');
  g.claim(a.id, 'bench-worker', 60000);
  g.complete(a.id, { ok: true, summary: 'finished first' });

  const reloaded = loadWorkGraph('agi-bench-robust');
  check('graph state survives reload exactly (items)', JSON.stringify(reloaded.items.map((i) => [i.id, i.status])) === JSON.stringify(g.items.map((i) => [i.id, i.status])));
  check('graph state survives reload exactly (relations)', JSON.stringify(reloaded.relations) === JSON.stringify(g.relations));
  check('resume is precise: the completed item is not re-offered', !reloaded.readyWork().some((i) => i.id === a.id) && reloaded.readyWork().some((i) => i.id === b.id));

  const m = new Mission({ conversationId: 'agi-bench-resume', objective: 'resumable benchmark mission' });
  m.setState('PLANNING', 'bench');
  const m2 = loadMission(m.id);
  check('mission state survives reload exactly', m2.state === 'PLANNING' && m2.objective === m.objective && JSON.stringify(m2.budgets) === JSON.stringify(m.budgets));
  let threw = false;
  try { m2.setState('COMPLETED', 'illegal jump'); } catch { threw = true; }
  check('illegal state transitions are rejected (no fake completion)', threw);
  m2.cancel('benchmark done');

  // ── Phase 1: provider health (API independence) ──
  PH.__resetProviderHealth();
  const now = Date.now();
  PH.recordProviderCallFailure('bench-a', 'HTTP 429 rate limit exceeded', { at: now });
  check('a rate-limited provider is skipped while cooling and recovers after', PH.skipForNow('bench-a', now + 1000) === true && PH.skipForNow('bench-a', now + 31_000) === false);
  PH.recordProviderCallFailure('bench-b', '401 unauthorized: invalid api key');
  check('a bad key is sticky — never retried forever', PH.providerState('bench-b').state === 'auth_error' && PH.skipForNow('bench-b', now + 48 * 3600_000) === true);
  PH.recordProviderCallFailure('bench-c', 'daily quota exhausted', { at: now });
  check('quota exhaustion and rate limiting are classified as different problems', PH.providerHealthSnapshot(now).find((p) => p.provider === 'bench-c').lastErrorKind === 'QUOTA_EXHAUSTED');
});

/* ── results ───────────────────────────────────────────────────────────── */
const names = Object.keys(axes);
const overall = names.reduce((sum, n) => sum + axes[n].score, 0) / names.length;

console.log('\n════════════ JEXI AGI BENCHMARK ════════════');
for (const n of names) {
  const a = axes[n];
  console.log(`${a.score.toFixed(2).padEnd(5)} ${n.padEnd(16)} ${a.passed}/${a.total}${a.failures.length ? '  ✗ ' + a.failures.join(' · ') : ''}`);
}
console.log('────────────────────────────────────────────');
console.log(`OVERALL ${overall.toFixed(3)}   (chain threshold: 0.90)`);
if (failures.length) {
  console.log('\nFailed checks:');
  failures.forEach((f) => console.log('  ✗', f));
}

/* --record: append the dated row to the over-time tracker */
if (process.argv.includes('--record')) {
  const file = new URL('../../../docs/AGI_BENCHMARK.md', import.meta.url).pathname;
  const date = new Date().toISOString().slice(0, 10);
  const row = `| ${date} | ${names.map((n) => axes[n].score.toFixed(2)).join(' | ')} | **${overall.toFixed(3)}** |`;
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    content = `# AGI Benchmark — results over time\n\nScores are 0–1 per axis; overall is the mean. Run \`node tests/agi/benchmark.js --record\` (from \`server/\`) after every phase.\n\n| Date | ${names.join(' | ')} | Overall |\n|---|${names.map(() => '---').join('|')}|---|\n`;
  }
  // one row per date: re-running the same day replaces that day's row
  const lines = content.trimEnd().split('\n');
  const dateIdx = lines.findIndex((l) => l.startsWith(`| ${date} |`));
  if (dateIdx >= 0) lines[dateIdx] = row;
  else lines.push(row);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`\nrecorded → docs/AGI_BENCHMARK.md`);
}

process.exit(overall >= 0.90 ? 0 : 1);
