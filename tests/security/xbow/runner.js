#!/usr/bin/env node
/**
 * JEXI OS — Phase 8 Scope H — XBOW BENCHMARK HARNESS: RUNNER.
 *
 * Orchestrates the Phase 8A pentest pipeline against benchmark target
 * descriptors (tests/security/xbow/level-N/*.json) and scores the results.
 *
 * What it measures — and what it does NOT:
 *   - Findings are counted ONLY after the Phase 8G gate: a finding exists
 *     for scoring iff the independent verifier said VERIFIED and the
 *     evidence snapshot is intact ("no exploit, no report" — reporting
 *     already dropped everything else before this harness sees it).
 *   - Scoring is per the Scope H contract:
 *       resolved       = verified findings matching an expected vulnerability
 *       missed         = expected vulnerabilities not matched by any finding
 *       false_positive = verified findings matching no expected vulnerability
 *   - The descriptors shipped in level-1/ + level-2/ come from the MOCK XBOW
 *     interface (Scope A planted fixture as ground truth). Scores from them
 *     are REAL measurements against a REAL local target — they are NOT XBOW
 *     scores. level-3/ is empty: the real XBOW dataset is not available in
 *     this sandbox and this runner does not fabricate targets or scores.
 *
 * Usage:
 *   node runner.js --list
 *   node runner.js --level 1 --dry-run
 *   node runner.js --level 1 [--json out.json] [--dataset DIR] [--clean] [--verbose]
 *   node runner.js --level all ...          # every level that has targets
 *
 * Exit codes: 0 ran (or listed/dry-ran) successfully · 2 clean refusal
 * (empty/missing target set, bad usage, dataset problems) · 1 harness error.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { loadTargets, resolveFixture, TAXONOMY } from './targets.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = path.resolve(MODULE_DIR, '../../../security/pipeline');
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..');

const HARNESS = {
  name: 'jexi-xbow-harness',
  version: '1.0.0',
  pipeline: 'phase-8a pentest pipeline (6 phases) + phase-8g independent verification gate',
};

/* ------------------------------------------------------------------ */
/* scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Strict matcher: a verified finding resolves an expected vulnerability iff
 * the taxonomy rule for expected.type matches the finding's OWASP class AND
 * title, AND the severity matches exactly. A type match with a different
 * severity is a MISSED expected (strict benchmark semantics) — surfaced with
 * reason "severity-mismatch" for transparency rather than silently dropped.
 */
function matchRule(expected, finding) {
  const rule = TAXONOMY[expected.type];
  if (!rule) return { match: false, typeMatch: false };
  const owasp = (finding.finding && finding.finding.owasp) || finding.owasp || null; // nested report shape OR flat run.findings shape
  const typeMatch = owasp === rule.owasp && rule.titlePattern.test(finding.title || '');
  return { match: typeMatch && finding.severity === expected.severity, typeMatch };
}

/**
 * Score one target's verified findings against its expected vulnerabilities.
 * 1:1 greedy assignment in descriptor order (deterministic).
 *
 * @param {object} target      validated descriptor
 * @param {Array}  findings    report.json findings (VERIFIED + snapshot intact)
 * @param {Array}  allTargets  every loaded descriptor — used ONLY to label
 *                             false positives that resolve another target's
 *                             answer key (shared-fixture transparency)
 */
export function scoreTarget(target, findings, allTargets) {
  const used = new Set();
  const resolved = [];
  const missed = [];

  for (const expected of target.expectedVulnerabilities) {
    const idx = findings.findIndex((f, i) => !used.has(i) && matchRule(expected, f).match);
    if (idx >= 0) {
      used.add(idx);
      const f = findings[idx];
      resolved.push({
        type: expected.type, severity: expected.severity, cwe: expected.cwe, mitreId: expected.mitreId,
        matchedFinding: { findingId: f.findingId, title: f.title, severity: f.severity, owasp: f.finding ? f.finding.owasp : null },
      });
    } else {
      const near = findings.find((f, i) => !used.has(i) && matchRule(expected, f).typeMatch);
      missed.push({
        type: expected.type, severity: expected.severity, cwe: expected.cwe, mitreId: expected.mitreId,
        reason: near
          ? `severity-mismatch: pipeline reported it as "${near.severity}", expected "${expected.severity}"`
          : 'no verified finding matched this class (not found, not exploitable, or rejected by the verification gate)',
      });
    }
  }

  const false_positive = findings
    .filter((_, i) => !used.has(i))
    .map((f) => ({
      findingId: f.findingId, title: f.title, severity: f.severity, owasp: f.finding ? f.finding.owasp : null,
      matchedElsewhere: allTargets
        .filter((t) => t.id !== target.id && t.expectedVulnerabilities.some((ev) => matchRule(ev, f).match))
        .map((t) => t.id),
    }));

  const counts = {
    expected: target.expectedVulnerabilities.length,
    resolved: resolved.length,
    missed: missed.length,
    false_positive: false_positive.length,
    verifiedFindings: findings.length,
  };
  const passed = counts.missed === 0 || (target.acceptUnsolved && counts.resolved > 0);
  return { resolved, missed, false_positive, counts, passed };
}

/* ------------------------------------------------------------------ */
/* execution                                                           */
/* ------------------------------------------------------------------ */

async function runTarget(target, { datasetSource, verbose = false } = {}) {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const fixture = resolveFixture(target.target.location);
  const run = {
    status: 'completed', engagementId: null, baseUrl: null, sourceRoot: null,
    phasesCompleted: [], verifiedFindings: 0, droppedFindings: 0, durationMs: 0,
    error: null, findings: [], dropped: [],
  };

  if (!fixture) {
    run.status = 'skipped';
    run.error = `no runnable fixture for target.location "${target.target.location}" — declared in the schema, not runnable in this sandbox (see README: kind "source" declared-not-exercised)`;
    run.durationMs = Math.round(performance.now() - t0);
    return { target, run, scores: null, report: null };
  }

  const { createWorkflow, store } = await import(path.resolve(PIPELINE_DIR, 'index.js'));
  const { startVulnApp } = await import(fixture.appModule);

  const engagementId = `${target.id}-${process.pid}-${Date.now()}`;
  run.engagementId = engagementId;

  const app = await startVulnApp({ port: 0 }); // ephemeral localhost port — never leaves 127.0.0.1
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  run.baseUrl = baseUrl;
  run.sourceRoot = fixture.sourceRoot;

  try {
    const wf = createWorkflow({
      engagementId,
      sourceRoot: fixture.sourceRoot,
      baseUrl,
      stateRoot: PIPELINE_DIR,
      engagement: null, // benchmark runs execute in the pipeline's legacy ungated mode (documented in README)
    });

    for await (const event of wf.execute()) {
      if (verbose) console.log(`      [evt] ${JSON.stringify(event)}`);
      if (event.type === 'log' && typeof event.data?.message === 'string' && event.data.message.startsWith('phase complete')) {
        run.phasesCompleted.push(event.phaseId);
      }
      if (event.type === 'finding' && event.phaseId === 'verification') {
        // raw verification verdicts, straight from the event stream
        const d = event.data;
        console.log(`      verdict ${d.findingId}: doer=${d.doerClaim} → verifier=${d.status} (${d.methodsSucceeded}/${d.methodsRequired} own methods re-executed)`);
      }
    }

    const report = store.readArtifact(PIPELINE_DIR, engagementId, 'report.json');
    if (!report) throw new Error('pipeline finished but artifacts/report.json is missing');

    run.phasesCompleted = [...new Set(run.phasesCompleted)];
    run.verifiedFindings = report.findings.length;
    run.droppedFindings = report.dropped.length;
    run.findings = report.findings.map((f) => ({
      findingId: f.findingId,
      title: f.title,
      severity: f.severity,
      owasp: f.finding ? f.finding.owasp : null,
      verification: f.verification ? {
        status: f.verification.status,
        methodsSucceeded: f.verification.methodsSucceeded,
        methodsRequired: f.verification.methodsRequired,
        verifierAgent: f.verification.verifierAgent,
        evidenceHash: f.verification.evidenceHash,
      } : null,
    }));
    run.dropped = report.dropped.map((d) => ({ findingId: d.findingId, title: d.title, status: d.status }));

    const scores = scoreTarget(target, report.findings, datasetSource.allTargets);
    run.durationMs = Math.round(performance.now() - t0);
    return { target, run, scores, report: null };
  } catch (err) {
    run.status = 'error';
    run.error = err.message;
    run.durationMs = Math.round(performance.now() - t0);
    return { target, run, scores: null, report: null };
  } finally {
    app.close(); // the fixture app NEVER outlives its target run
  }
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */

const EMPTY_COUNTS = { expected: 0, resolved: 0, missed: 0, false_positive: 0, verifiedFindings: 0 };

function sumCounts(acc, counts) {
  for (const k of Object.keys(EMPTY_COUNTS)) acc[k] = (acc[k] || 0) + (counts?.[k] || 0);
  return acc;
}

function buildReport({ dataset, results, totalMs, startedAt }) {
  const levelKeys = [...new Set(results.map((r) => r.target.level))].sort((a, b) => a - b);
  const levels = {};
  for (const level of levelKeys) {
    const rs = results.filter((r) => r.target.level === level && r.scores);
    const counts = rs.reduce((acc, r) => sumCounts(acc, r.scores.counts), { ...EMPTY_COUNTS });
    levels[String(level)] = {
      targets: results.filter((r) => r.target.level === level).length,
      scores: { counts, resolved: rs.flatMap((r) => r.scores.resolved), missed: rs.flatMap((r) => r.scores.missed), false_positive: rs.flatMap((r) => r.scores.false_positive) },
    };
  }

  const scored = results.filter((r) => r.scores);
  const aggCounts = scored.reduce((acc, r) => sumCounts(acc, r.scores.counts), { ...EMPTY_COUNTS });

  // Deduplicated union view: score every verified finding ONCE against the
  // union of all executed answer keys. Under the shipped fixture partition,
  // per-level false positives are findings that resolve ANOTHER level's key
  // (labeled matchedElsewhere); the union view is the honesty cross-check.
  const unionExpected = [];
  for (const r of scored) for (const ev of r.target.expectedVulnerabilities) unionExpected.push(ev);
  const unionFindings = [];
  const seenFinding = new Set();
  for (const r of scored) for (const f of r.run.findings) {
    if (!seenFinding.has(f.findingId)) { seenFinding.add(f.findingId); unionFindings.push(f); }
  }
  const unionUsed = new Set();
  const unionResolved = unionExpected.filter((ev) => {
    const idx = unionFindings.findIndex((f, i) => !unionUsed.has(i) && matchRule(ev, f).match);
    if (idx >= 0) { unionUsed.add(idx); return true; }
    return false;
  }).length;
  const unionFalsePositives = unionFindings.length - unionUsed.size;

  return {
    harness: HARNESS,
    generatedAt: new Date().toISOString(),
    dataset,
    runtime: { totalMs: Math.round(totalMs), startedAt, finishedAt: new Date().toISOString() },
    targets: results.map(({ target, run, scores }) => ({
      id: target.id, name: target.name, level: target.level, target: target.target,
      acceptUnsolved: target.acceptUnsolved, provenance: target.provenance, descriptorFile: target._file,
      run,
      scores: scores ? { resolved: scores.resolved, missed: scores.missed, false_positive: scores.false_positive, counts: scores.counts } : null,
      passed: scores ? scores.passed : false,
    })),
    levels,
    aggregate: {
      targets: results.length,
      runs: {
        completed: results.filter((r) => r.run.status === 'completed').length,
        error: results.filter((r) => r.run.status === 'error').length,
        skipped: results.filter((r) => r.run.status === 'skipped').length,
      },
      scores: { counts: aggCounts },
      deduplicated: {
        resolved: unionResolved,
        missed: unionExpected.length - unionResolved,
        false_positive: unionFalsePositives,
        note: 'each verified finding scored once against the union of all executed answer keys; per-level false_positive entries labeled matchedElsewhere are expected under the shared-fixture partition (see README)',
      },
      passRate: `${results.filter((r) => r.scores && r.scores.passed).length}/${results.length}`,
    },
    notes: [
      'Findings are counted only AFTER the Phase 8G gate (VERIFIED + intact evidence snapshot).',
      dataset.source === 'mock-xbow-interface'
        ? 'Dataset source: MOCK XBOW INTERFACE (Scope A fixture ground truth). Real XBOW dataset NOT available in sandbox — NOT VERIFIED FROM SOURCE. Scores are real measurements against a real local target; they are NOT XBOW scores.'
        : `Dataset source: external dataset at ${dataset.root}. Verify provenance before comparing to any published numbers.`,
    ],
  };
}

function printHuman(report) {
  console.log('\n  ═══ XBOW HARNESS RESULTS ═══');
  for (const t of report.targets) {
    console.log(`\n  ▸ ${t.id} — ${t.name} (level ${t.level})`);
    console.log(`    target: ${t.target.kind} ${t.target.location} · descriptor: ${t.descriptorFile}`);
    console.log(`    run: ${t.run.status} engagement=${t.run.engagementId} base=${t.run.baseUrl} ${t.run.durationMs}ms`);
    console.log(`    pipeline: ${t.run.phasesCompleted.length}/6 phases complete · ${t.run.verifiedFindings} verified · ${t.run.droppedFindings} dropped by the 8G gate`);
    if (t.run.error) console.log(`    error: ${t.run.error}`);
    for (const d of t.run.dropped) console.log(`    dropped: ${d.findingId} "${d.title}" (${d.status})`);
    if (t.scores) {
      for (const r of t.scores.resolved) console.log(`    resolved:       ${r.type} sev=${r.severity} ${r.cwe} ${r.mitreId} ← ${r.matchedFinding.findingId}`);
      for (const m of t.scores.missed) console.log(`    missed:         ${m.type} sev=${m.severity} ${m.cwe} ${m.mitreId} — ${m.reason}`);
      for (const fp of t.scores.false_positive) console.log(`    false_positive: ${fp.findingId} "${fp.title}" sev=${fp.severity}${fp.matchedElsewhere.length ? ` — resolves another key: ${fp.matchedElsewhere.join(', ')}` : ''}`);
      console.log(`    counts: ${JSON.stringify(t.scores.counts)} · passed=${t.passed}`);
    }
  }
  console.log('\n  ═══ PER LEVEL ═══');
  for (const [level, l] of Object.entries(report.levels)) {
    console.log(`  level ${level}: targets=${l.targets} ${JSON.stringify(l.scores.counts)}`);
  }
  console.log('\n  ═══ AGGREGATE ═══');
  console.log(`  runs: ${JSON.stringify(report.aggregate.runs)} · passRate=${report.aggregate.passRate}`);
  console.log(`  scores (per Scope H contract, per-level keys): ${JSON.stringify(report.aggregate.scores.counts)}`);
  console.log(`  deduplicated union view: ${JSON.stringify({ resolved: report.aggregate.deduplicated.resolved, missed: report.aggregate.deduplicated.missed, false_positive: report.aggregate.deduplicated.false_positive })}`);
  console.log(`  total run time: ${report.runtime.totalMs}ms`);
  for (const n of report.notes) console.log(`  NOTE: ${n}`);
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const cleanFailEarly = (message) => { console.error(`error: ${message}`); process.exit(2); };

async function main() {
  // Supports BOTH --key=value and "--key value" (space form), plus boolean
  // flags (--list --dry-run --verbose --clean).
  const VALUE_KEYS = new Set(['level', 'json', 'dataset']);
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) cleanFailEarly(`unexpected argument "${tok}"`);
    const [k, v] = tok.replace(/^--/, '').split('=');
    if (v !== undefined) { args[k] = v; continue; }
    if (VALUE_KEYS.has(k)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) cleanFailEarly(`--${k} needs a value`);
      args[k] = next;
      i += 1;
    } else {
      args[k] = true;
    }
  }

  const datasetRoot = path.resolve(args.dataset || MODULE_DIR);
  const datasetSource = { root: datasetRoot, source: datasetRoot === MODULE_DIR ? 'mock-xbow-interface' : `external:${datasetRoot}` };
  const { targets, problems, counts } = loadTargets(datasetRoot);
  datasetSource.allTargets = targets; // for matchedElsewhere labeling

  const cleanFail = (message) => { console.error(`error: ${message}`); process.exit(2); };

  // dataset problems are fatal only when they affect what was asked to run;
  // --list always surfaces them as information.

  if (args.list) {
    console.log(`XBOW harness — target descriptors (dataset: ${datasetSource.source})`);
    for (const level of [1, 2, 3]) {
      const ts = targets.filter((t) => t.level === level);
      console.log(`\n  level ${level}: ${ts.length} target(s)`);
      for (const t of ts) {
        console.log(`    ${t.id}  "${t.name}"`);
        console.log(`      target: ${t.target.kind} ${t.target.location} · expected=${t.expectedVulnerabilities.length} · acceptUnsolved=${t.acceptUnsolved} · file=${t._file}`);
        for (const ev of t.expectedVulnerabilities) {
          console.log(`        - ${ev.type} sev=${ev.severity} ${ev.cwe} ${ev.mitreId}`);
        }
      }
    }
    console.log(`\n  counts per level: level-1=${counts[1]} level-2=${counts[2]} level-3=${counts[3]} · total=${targets.length}`);
    for (const p of problems) console.log(`  problem: ${p}`);
    process.exit(0);
  }

  const levelArg = args.level;
  if (!levelArg) cleanFail('missing --level (1|2|3|all). Try --list first.');
  if (levelArg !== 'all' && !['1', '2', '3'].includes(String(levelArg))) {
    cleanFail(`--level must be 1|2|3|all (got "${levelArg}")`);
  }
  const selectedLevels = levelArg === 'all' ? [1, 2, 3] : [Number(levelArg)];

  const selected = targets.filter((t) => selectedLevels.includes(t.level));
  if (selected.length === 0) {
    const levelDetail = selectedLevels.map((l) => `level-${l}: ${counts[l]} target(s)`).join(', ');
    console.error(`error: no targets to run — ${levelDetail}.`);
    if (problems.length) for (const p of problems) console.error(`  (${p})`);
    console.error('  A missing target set is a clean stop: no scores are emitted, nothing is fabricated.');
    console.error('  For level-3 the real XBOW dataset is not available in this sandbox — NOT VERIFIED FROM SOURCE.');
    process.exit(2);
  }
  // Surface only problems that affect levels actually being executed (an
  // empty level among 'all' is the documented mock-interface state — see P7,
  // not a dataset problem). Descriptor corruption inside a running level
  // stays fatal.
  for (const p of problems) {
    const m = p.match(/^level-(\d):/);
    const lvl = m ? Number(m[1]) : null;
    if (lvl === null || (selectedLevels.includes(lvl) && counts[lvl] > 0)) console.error(`dataset problem: ${p}`);
  }
  const brokenDescriptors = problems.filter((p) => /invalid JSON|descriptor|does not match|must be|must match|not in the taxonomy/.test(p));
  if (brokenDescriptors.length && selected.some((t) => brokenDescriptors.some((p) => p.startsWith(`level-${t.level}/`)))) {
    cleanFail(`dataset has invalid descriptors: ${brokenDescriptors.join(' | ')}`);
  }

  if (args['dry-run']) {
    console.log(`DRY RUN — nothing will execute (dataset: ${datasetSource.source})`);
    for (const t of selected) {
      const fx = resolveFixture(t.target.location);
      console.log(`\n  WOULD RUN ${t.id} — ${t.name}`);
      console.log(`    start target: ${t.target.kind} ${t.target.location}${fx ? ` (fixture: ${fx.appModule})` : ' (no runnable fixture — would be skipped, see README)'}`);
      console.log(`    run pipeline: 6 phases (pre-recon → recon → vulnerability → exploitation → verification → reporting) as engagement xbow-<run>-<stamp>, ungated legacy RoE mode`);
      console.log(`    then score: ${t.expectedVulnerabilities.length} expected vulnerability classes (${t.expectedVulnerabilities.map((e) => e.type).join(', ')}) against Phase 8G-verified findings only`);
    }
    console.log(`\n  ${selected.length} target(s) would run. No execution performed.`);
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const results = [];
  for (const target of selected) {
    console.log(`\n  ▶ running ${target.id} — ${target.name}`);
    const result = await runTarget(target, { datasetSource, verbose: Boolean(args.verbose) });
    results.push(result);
    if (args.clean && result.run.engagementId) {
      fs.rmSync(path.join(PIPELINE_DIR, '.state', result.run.engagementId), { recursive: true, force: true });
    }
  }

  const report = buildReport({ dataset: datasetSource, results, totalMs: performance.now() - t0, startedAt });
  printHuman(report);

  if (args.json) {
    const out = path.resolve(String(args.json));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(`\n  JSON report → ${out}`);
  }

  const hardFailure = results.some((r) => r.run.status === 'error');
  process.exit(hardFailure ? 1 : 0);
}

main().catch((err) => {
  console.error(`harness error: ${err.stack || err.message}`);
  process.exit(1);
});
