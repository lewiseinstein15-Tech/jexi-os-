/**
 * JEXI OS — Phase 28 Scope I live probe — deterministic dream cycle.
 * P1 dry-run · P2 13 phases · P3 budget continuation · P4 consolidation ·
 * P5 lint gate · P6 determinism · P7 LLM-free static guard.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SemanticaError } from '../services/semantica/_internal.js';
import { createRepo } from '../mind/brain/repo/index.js';
import { createIndex } from '../mind/brain/index/index.js';
import { createHotMemory } from '../mind/brain/hot/index.js';
import {
  createDreamCycle, DECLARED_PHASE_ORDER, DETERMINISTIC_PHASES,
  LLM_BACKED_PHASES, CONSOLIDATION_THRESHOLD, cosineSimilarity,
} from '../mind/brain/cycle/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const NOW = '2026-09-22T14:00:00Z';
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_ORDER = [
  'lint', 'backlinks', 'sync', 'extract', 'extract-facts',
  'resolve-symbol-edges', 'synthesize-concepts', 'recompute-emotional-weight',
  'consolidate', 'propose-takes', 'grade-takes', 'embed', 'orphans',
];

function fixture(prefix = 'p28i-', facts = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repo = createRepo(root);
  repo.create('people', 'alice-example', {
    title: 'Alice Example',
    compiledTruth: 'Alice Example founded Acme Labs. Alice Example advises Bob Stone.',
    now: NOW,
  });
  repo.create('companies', 'acme-labs', {
    title: 'Acme Labs',
    compiledTruth: 'Acme Labs builds analytical engines with Alice Example.',
    now: NOW,
  });
  return {
    root,
    repo,
    hot: createHotMemory({ nowDay: () => 42 }),
    index: createIndex({ repo }),
    facts,
  };
}

function fileSnapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

function gitStatus() {
  return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: WORKSPACE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ── P1: dry run, fixed order, no effects ────────────────────────────────────
console.log('── P1 dry-run ──');
const main = fixture('p28i-main-');
let dryPhaseInvocations = 0;
const dryOverrides = Object.fromEntries(EXPECTED_ORDER.map((name) => [name, async () => {
  dryPhaseInvocations += 1;
  throw new Error(`dry run executed ${name}`);
}]));
const dryCycle = createDreamCycle({ ...main, phaseOverrides: dryOverrides });
const filesBefore = JSON.stringify(fileSnapshot(main.root));
const stateBefore = JSON.stringify(dryCycle.state());
const gitBefore = gitStatus();
const dryReport = await dryCycle.run({ dryRun: true });
const filesAfter = JSON.stringify(fileSnapshot(main.root));
const stateAfter = JSON.stringify(dryCycle.state());
const gitAfter = gitStatus();
console.log('P1 dry-run report:', JSON.stringify(dryReport, null, 2));
console.log('P1 side effects:', JSON.stringify({
  fixtureFilesUnchanged: filesBefore === filesAfter,
  cycleStateUnchanged: stateBefore === stateAfter,
  gitStatusUnchanged: gitBefore === gitAfter,
  phaseInvocations: dryPhaseInvocations,
  filesWritten: JSON.parse(filesAfter).hasOwnProperty('.brain/manifest.json') ? ['.brain/manifest.json'] : [],
}, null, 2));
ok(dryReport.phases.map((phase) => phase.name).join(',') === EXPECTED_ORDER.join(','), 'P1 dry-run reports all phases in fixed order');
ok(dryReport.phases.every((phase) => phase.status === 'dry-run' && phase.durationMs === 0 && phase.budgetUsed === 0) && dryPhaseInvocations === 0, 'P1 dry-run reports intent without invoking phases');
ok(filesBefore === filesAfter && stateBefore === stateAfter && gitBefore === gitAfter, 'P1 dry-run has no fixture, state, or git-status side effects');

// ── P2: full fixture cycle ──────────────────────────────────────────────────
console.log('── P2 full 13-phase run ──');
const mainCycle = createDreamCycle(main);
const fullReport = await mainCycle.run({ dryRun: false });
console.log('P2 report:', JSON.stringify(fullReport, null, 2));
ok(fullReport.phases.length === 13 && fullReport.phases.map((phase) => phase.name).join(',') === EXPECTED_ORDER.join(','), 'P2 all 13 phases run in declared order');
ok(fullReport.phases.every((phase) => ['name', 'ok', 'durationMs', 'budgetUsed'].every((key) => Object.prototype.hasOwnProperty.call(phase, key))), 'P2 every phase reports required contract fields');
ok(fullReport.phases.every((phase) => phase.ok === true), 'P2 fixture cycle completes every phase');

// ── P3: budget abort continues ──────────────────────────────────────────────
console.log('── P3 per-phase budget abort ──');
const budgetFixture = fixture('p28i-budget-');
const budgetCycle = createDreamCycle({
  ...budgetFixture,
  budgetCaps: { 'synthesize-concepts': 0.25 },
  phaseOverrides: {
    'synthesize-concepts': async () => ({
      durationMs: 0,
      budgetUsed: 0.5,
      details: { forced: 'budget-overrun fixture' },
    }),
  },
});
const budgetReport = await budgetCycle.run({
  phaseFilter: ['consolidate', 'recompute-emotional-weight', 'synthesize-concepts'],
});
console.log('P3 report:', JSON.stringify(budgetReport, null, 2));
console.log('P3 audit:', JSON.stringify(budgetCycle.audit(), null, 2));
const budgetAbort = budgetReport.phases[0];
ok(budgetAbort.name === 'synthesize-concepts' && budgetAbort.status === 'budget-aborted' && budgetAbort.error.code === 'E_PHASE_BUDGET_EXCEEDED', 'P3 over-cap phase is aborted and typed');
ok(budgetCycle.audit().some((entry) => entry.event === 'budget-aborted'), 'P3 budget abort is logged');
ok(budgetReport.phases.slice(1).map((phase) => phase.name).join(',') === 'recompute-emotional-weight,consolidate' && budgetReport.phases.slice(1).every((phase) => phase.ok), 'P3 cycle continues through subsequent phases');

// ── P4: cosine consolidation, never delete ──────────────────────────────────
console.log('── P4 consolidation ──');
const consolidationFacts = [
  { id: 'f1', source_id: 'source-a', entity_slug: 'people/alice-example', fact: 'Alice prefers concise reports.', kind: 'preference', confidence: 0.80, op_seq: 1, embedding: [1, 0, 0], consolidated_into: null },
  { id: 'f2', source_id: 'source-a', entity_slug: 'people/alice-example', fact: 'Alice strongly prefers concise reports.', kind: 'preference', confidence: 0.95, op_seq: 2, embedding: [0.99, 0.1, 0], consolidated_into: null },
  { id: 'f3', source_id: 'source-a', entity_slug: 'people/alice-example', fact: 'Concise reports are Alice’s preference.', kind: 'preference', confidence: 0.90, op_seq: 3, embedding: [0.98, 0.2, 0], consolidated_into: null },
  { id: 'f4', source_id: 'source-a', entity_slug: 'people/alice-example', fact: 'Alice attended the Nairobi event.', kind: 'event', confidence: 0.70, op_seq: 4, embedding: [0, 1, 0], consolidated_into: null },
];
const consolidationCycle = createDreamCycle({ facts: consolidationFacts });
const consolidationBefore = consolidationCycle.state();
const similarity = {
  f1_f2: cosineSimilarity(consolidationFacts[0].embedding, consolidationFacts[1].embedding),
  f1_f3: cosineSimilarity(consolidationFacts[0].embedding, consolidationFacts[2].embedding),
  f2_f3: cosineSimilarity(consolidationFacts[1].embedding, consolidationFacts[2].embedding),
  f3_f4: cosineSimilarity(consolidationFacts[2].embedding, consolidationFacts[3].embedding),
  threshold: CONSOLIDATION_THRESHOLD,
};
const consolidationReport = await consolidationCycle.run({ phaseFilter: ['consolidate'] });
const consolidationAfter = consolidationCycle.state();
console.log('P4 similarities:', JSON.stringify(similarity, null, 2));
console.log('P4 before:', JSON.stringify({ factCount: consolidationBefore.facts.length, takeCount: consolidationBefore.takes.length, facts: consolidationBefore.facts }, null, 2));
console.log('P4 report:', JSON.stringify(consolidationReport, null, 2));
console.log('P4 after:', JSON.stringify({ factCount: consolidationAfter.facts.length, takeCount: consolidationAfter.takes.length }, null, 2));
console.log('P4 take:', JSON.stringify(consolidationAfter.takes[0], null, 2));
console.log('P4 retained facts:', JSON.stringify(consolidationAfter.facts, null, 2));
console.log('P4 audit trail:', JSON.stringify(consolidationAfter.consolidationAudit, null, 2));
const promotedIds = consolidationAfter.facts.filter((fact) => fact.consolidated_into).map((fact) => fact.id).sort();
const standalone = consolidationAfter.facts.find((fact) => fact.id === 'f4');
ok(similarity.f1_f2 >= 0.85 && similarity.f1_f3 >= 0.85 && similarity.f2_f3 >= 0.85 && similarity.f3_f4 < 0.85, 'P4 fixture has three above-threshold facts and one sub-threshold fact');
ok(consolidationAfter.takes.length === 1 && consolidationAfter.takes[0].fact_ids.join(',') === 'f1,f2,f3', 'P4 cluster >=2 promotes exactly one take');
ok(consolidationBefore.facts.length === 4 && consolidationAfter.facts.length === 4, 'P4 contributing facts are retained; none deleted');
ok(promotedIds.join(',') === 'f1,f2,f3' && promotedIds.every((id) => consolidationAfter.facts.find((fact) => fact.id === id).consolidated_into === consolidationAfter.takes[0].id), 'P4 each contributing fact carries consolidated_into');
ok(standalone && standalone.consolidated_into === null && !consolidationAfter.takes[0].fact_ids.includes('f4'), 'P4 sub-threshold fact remains standalone');

// ── P5: lint gate abort ─────────────────────────────────────────────────────
console.log('── P5 lint gate failure ──');
const gateCycle = createDreamCycle({
  phaseOverrides: {
    lint: async () => { throw new SemanticaError('E_FORCED_LINT_FAILURE', 'forced lint failure for gate probe'); },
  },
});
const gateReport = await gateCycle.run({ dryRun: false });
console.log('P5 report:', JSON.stringify(gateReport, null, 2));
console.log('P5 audit:', JSON.stringify(gateCycle.audit(), null, 2));
ok(gateReport.phases.length === 1 && gateReport.phases[0].name === 'lint' && gateReport.phases[0].status === 'gate-aborted', 'P5 lint failure aborts the cycle immediately');
ok(gateReport.phases[0].error.code === 'E_FORCED_LINT_FAILURE' && gateReport.phases[0].error.message.includes('forced lint failure'), 'P5 gate abort exposes the reason');

// ── P6: deterministic phases, two independent fixtures ─────────────────────
console.log('── P6 deterministic phases ──');
const deterministicA = fixture('p28i-det-a-');
const deterministicB = fixture('p28i-det-b-');
const cycleA = createDreamCycle(deterministicA);
const cycleB = createDreamCycle(deterministicB);
const reversedFilter = [...DETERMINISTIC_PHASES].reverse();
const reportA = await cycleA.run({ phaseFilter: reversedFilter });
const reportB = await cycleB.run({ phaseFilter: reversedFilter });
const stateProjection = (cycleInstance) => {
  const state = cycleInstance.state();
  return {
    backlinks: state.backlinks,
    sync: state.sync,
    edges: state.edges,
    embedding: state.embedding,
    orphans: state.orphans,
  };
};
const deterministicBytesA = JSON.stringify({ report: reportA, state: stateProjection(cycleA) });
const deterministicBytesB = JSON.stringify({ report: reportB, state: stateProjection(cycleB) });
console.log('P6 run A:', deterministicBytesA);
console.log('P6 run B:', deterministicBytesB);
console.log('P6 byte-identical:', deterministicBytesA === deterministicBytesB);
ok(reportA.phases.map((phase) => phase.name).join(',') === DETERMINISTIC_PHASES.join(','), 'P6 phaseFilter cannot reorder deterministic phases');
ok(deterministicBytesA === deterministicBytesB, 'P6 deterministic phases are byte-identical across equal fixtures');

// ── P7: no provider/network imports + honest LLM labels ─────────────────────
console.log('── P7 LLM-free guard ──');
const phasesDir = path.join(WORKSPACE, 'mind/brain', 'cycle', 'phases');
const phaseFiles = fs.readdirSync(phasesDir).filter((file) => file.endsWith('.js')).sort();
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const providerImports = [];
const networkSites = [];
for (const file of phaseFiles) {
  const code = stripComments(fs.readFileSync(path.join(phasesDir, file), 'utf8'));
  if (/from\s+['"][^'"]*(?:provider|gateway|openai|anthropic|gemini)[^'"]*['"]/i.test(code)) providerImports.push(file);
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|https?:\/\//i.test(code)) networkSites.push(file);
}
const llmLabels = Object.fromEntries(fullReport.phases
  .filter((phase) => LLM_BACKED_PHASES.includes(phase.name))
  .map((phase) => [phase.name, phase.label]));
console.log('P7 guard:', JSON.stringify({ phaseFiles, providerImports, networkSites, llmLabels }, null, 2));
ok(providerImports.length === 0, 'P7 no phase imports a provider module');
ok(networkSites.length === 0, 'P7 no phase contains a network call site');
ok(LLM_BACKED_PHASES.every((name) => llmLabels[name] === 'rule-based — LLM phase NOT VERIFIED'), 'P7 every LLM-backed phase is honestly marked when no capability is injected');

console.log('');
console.log(`SCOPE I: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
