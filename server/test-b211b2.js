#!/usr/bin/env node
/**
 * B211 B2 — INTELLIGENCE LAYER: analyzer, imagination, operational lessons.
 *
 * Under test (real execution, no mocks pretending to be production):
 *   ComplexityAnalyzer: heuristic classification (deterministic floor), LLM
 *   refinement (decidedBy tracked), honest fallback on invalid/throwing lanes,
 *   depth mapping (imagination/checkpoints/approval gate).
 *   ImaginationEngine: bounded branch generation (MAX_BRANCHES/MAX_LLM_CALLS),
 *   CREATED→SELECTED/REJECTED statuses with reasons, honest
 *   SIMULATION_UNAVAILABLE (never faked), deterministic fallback judging,
 *   PREDICTED vs ACTUAL deviation computation from real numbers.
 *   Lessons: record → persist → dedupe → relevance retrieval → prompt block;
 *   cross-process reload (real restart semantics).
 *   MissionRunner integration: MISSION_ANALYZED / IMAGINATION_PASS /
 *   IMAGINATION_REVIEW / LESSON_RECORDED events from real runs; simulated
 *   strategy + lessons + gate steering injected into REAL plan prompts;
 *   CRITICAL risk approval gate (AWAITING_INPUT before anything runs);
 *   failure lessons feed the NEXT mission's planning.
 */

// B211b2 store isolation: set BEFORE any module that reads config is loaded.
process.env.DATA_DIR = './data/test-b211b2';

const fs = (await import('node:fs')).default;
const { execFileSync } = await import('node:child_process');
const { MissionRunner } = await import('./src/services/director/MissionRunner.js');
const { loadMission, loadMissionEvents } = await import('./src/services/director/Mission.js');
const { analyzeObjective, depthFor, heuristicAnalysis } = await import('./src/services/director/ComplexityAnalyzer.js');
const { imagine, comparePredictedVsActual, IMAGINATION_BUDGETS } = await import('./src/services/director/ImaginationEngine.js');
const { recordLesson, retrieveLessons, formatLessonsBlock, lessonCount } = await import('./src/services/director/Lessons.js');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(60); }
  return fn();
}
const eventTypes = (id) => loadMissionEvents(id).map((e) => e.type);
const hasEvent = (id, type) => eventTypes(id).includes(type);

fs.rmSync('./data/test-b211b2', { recursive: true, force: true });

/* ────────────────────────── fake infrastructure ────────────────────────── */

const empOut = (deliverable) => `## DELIVERABLE\n${deliverable}\n## REPORT\nDelivered as asked, no fabrication.\n## CONFIDENCE\nhigh`;

class FakeLlm {
  constructor() {
    this.analysisJson = null;      // MISSION COMPLEXITY marker
    this.analysisThrows = false;
    this.strategyJson = null;      // COUNTERFACTUAL STRATEGY marker
    this.strategyThrows = false;
    this.judgeJson = null;         // STRATEGY JUDGE marker
    this.judgeThrows = false;
    this.planJson = null;
    this.impactJson = null;
    this.replanJson = null;
    this.employeeQueue = [];
    this.alwaysThrowSession = null;
    this.verifyJson = { pass: true, score: 1.0, problems: [], rationale: 'criteria met' };
    this.sessionCalls = 0;
    this.planPrompts = [];         // captured PERSISTENT MISSION user prompts
    this.llmCallsByMarker = { complexity: 0, strategy: 0, judge: 0 };
  }
  async employee({ system, user } = {}) {
    const sys = String(system || '');
    if (/MISSION COMPLEXITY/.test(sys)) {
      this.llmCallsByMarker.complexity += 1;
      if (this.analysisThrows) throw new Error('lane down');
      if (this.analysisJson) return JSON.stringify(this.analysisJson);
      throw new Error('no analysis configured');
    }
    if (/COUNTERFACTUAL STRATEGY/.test(sys)) {
      this.llmCallsByMarker.strategy += 1;
      if (this.strategyThrows) throw new Error('imagination lane down');
      if (this.strategyJson) return JSON.stringify(this.strategyJson);
      throw new Error('no strategies configured');
    }
    if (/STRATEGY JUDGE/.test(sys)) {
      this.llmCallsByMarker.judge += 1;
      if (this.judgeThrows) throw new Error('judge lane down');
      if (this.judgeJson) return JSON.stringify(this.judgeJson);
      throw new Error('no judge configured');
    }
    if (/PERSISTENT MISSION/.test(sys)) { this.planPrompts.push(String(user || '')); return JSON.stringify(this.planJson); }
    if (/Part of a persistent mission failed/.test(sys)) return JSON.stringify(this.replanJson);
    if (/Mid-mission steering/.test(sys)) return JSON.stringify(this.impactJson);
    this.sessionCalls += 1;
    if (this.alwaysThrowSession) throw new Error(this.alwaysThrowSession);
    const next = this.employeeQueue.length ? this.employeeQueue.shift() : empOut('A thorough, real deliverable with plenty of substance for the objective at hand.');
    if (next && typeof next === 'object' && next.throw) throw new Error(next.throw);
    return next;
  }
  async verify() { return JSON.stringify(this.verifyJson); }
  async interpret() { return null; }
  async report() { return 'report'; }
}

const PLAN = (items) => ({
  refinedObjective: 'Test mission objective', assumptions: [], constraints: [],
  successCriteria: ['deliverable produced'],
  items: items.map((title, i) => ({ title, details: `Do ${title}`, capability: 'reasoning', requirements: [], dependsOn: i === 0 ? [] : [i], searchQueries: [], expectedOutput: 'done', priority: 'normal' })),
});
const STRATEGIES = {
  candidates: [
    { name: 'Sequential build', approach: 'Build the whole thing step by step in one lane, verify at the end.', predictedOutcome: 'works first try', predictedRisks: 'late failures compound', predictedItems: 2 },
    { name: 'Parallel split', approach: 'Split independent halves, run them in parallel, integrate.', predictedOutcome: 'faster, some integration risk', predictedRisks: 'integration mismatch', predictedItems: 4 },
    { name: 'Spike then build', approach: 'Spike the risky part first, then build on what survived.', predictedOutcome: 'risk retired early', predictedRisks: 'spike eats time', predictedItems: 3 },
  ],
};
const JUDGE = {
  selectedName: 'Spike then build',
  verdicts: [
    { name: 'Sequential build', because: 'late verification risks compounding' },
    { name: 'Parallel split', because: 'integration risk on a small mission' },
    { name: 'Spike then build', because: 'retires the biggest risk first' },
  ],
};

const newRunner = (llm) => {
  const r = new MissionRunner();
  r.configure({ llm, tools: { search: async () => 'no results needed' } });
  return r;
};

console.log('\n== A. ComplexityAnalyzer: heuristics are the deterministic floor ==');
{
  const cases = [
    ['What is 2+2?', 'SIMPLE', 'LOW'],
    ['Research coffee prices and write a summary', 'MODERATE', 'LOW'],
    ['Build a full-stack web app, then test it', 'COMPLEX', 'LOW'],
    ['Delete the production database and wipe all user data', 'SIMPLE', 'CRITICAL'],
    ['Send an email to all users about the outage', 'SIMPLE', 'CRITICAL'],
    ['Pay the hosting invoice', 'SIMPLE', 'CRITICAL'],
    ['Research the market, design the pages, build the site and verify everything', 'COMPLEX', 'LOW'],
  ];
  for (const [q, c, r] of cases) {
    const a = await analyzeObjective(q);
    check(`"${q.slice(0, 42)}" → ${c}/${r}`, a.complexity === c && a.risk === r, `got ${a.complexity}/${a.risk}`);
  }
  const d1 = depthFor('SIMPLE', 'LOW');
  check('SIMPLE → no imagination, light checkpoints', d1.imagination === false && d1.checkpointMode === 'light');
  check('COMPLEX → imagination ON', depthFor('COMPLEX', 'LOW').imagination === true);
  check('LONG_HORIZON → deep checkpoints, fewer parallel', depthFor('LONG_HORIZON', 'LOW').checkpointMode === 'deep' && depthFor('LONG_HORIZON', 'LOW').suggestedParallel === 2);
  check('CRITICAL risk → approval gate (any complexity)', depthFor('SIMPLE', 'CRITICAL').requiresApproval === true && depthFor('LONG_HORIZON', 'CRITICAL').requiresApproval === true);
  check('HIGH risk → flagged but no gate', depthFor('MODERATE', 'HIGH').requiresApproval === false);
  const h = heuristicAnalysis('Research coffee prices and write a summary');
  check('heuristic reasons are real signals', Array.isArray(h.reasons) && h.reasons.length > 0 && h.decidedBy === 'heuristics');
}

console.log('\n== B. ComplexityAnalyzer: LLM refinement, honest fallback ==');
{
  const llmOk = async () => JSON.stringify({ complexity: 'COMPLEX', risk: 'MEDIUM', reasons: ['three domains cited'] });
  const a1 = await analyzeObjective('write a thing', { llm: llmOk });
  check('llm verdict wins when valid (decidedBy llm)', a1.complexity === 'COMPLEX' && a1.risk === 'MEDIUM' && a1.decidedBy === 'llm');
  check('llm path still carries executionDepth', a1.executionDepth.imagination === true);
  const llmJunk = async () => 'not json at all {{{';
  const a2 = await analyzeObjective('Research coffee prices and write a summary', { llm: llmJunk });
  check('invalid llm answer → heuristics, marked honestly', a2.decidedBy === 'heuristics' && a2.complexity === 'MODERATE');
  const llmDead = async () => { throw new Error('429'); };
  const a3 = await analyzeObjective('Build a full-stack web app, then test it', { llm: llmDead });
  check('throwing lane → heuristics, never blocks the mission', a3.decidedBy === 'heuristics' && a3.executionDepth.imagination === true);
  const a4 = await analyzeObjective('write a thing');
  check('no llm configured → heuristics (always available)', a4.decidedBy === 'heuristics');
}

console.log('\n== C. ImaginationEngine: bounded, honest branch search ==');
{
  const r1 = await imagine({ objective: 'test' });
  check('no lane → SIMULATION_UNAVAILABLE, never faked', r1.status === 'SIMULATION_UNAVAILABLE' && r1.simulated === false && r1.branches.length === 0 && r1.cost.llmCalls === 0);
  check('unavailable carries a real reason', /no model lane/.test(r1.reason || ''));

  let strategyCalls = 0;
  const llm = async ({ system }) => {
    const sys = String(system || '');
    if (/COUNTERFACTUAL/.test(sys) || /STRATEGY JUDGE/.test(sys)) { strategyCalls += 1; }
    if (/COUNTERFACTUAL/.test(sys)) return JSON.stringify(STRATEGIES);
    if (/STRATEGY JUDGE/.test(sys)) return JSON.stringify(JUDGE);
    throw new Error('unexpected marker');
  };
  const r2 = await imagine({ objective: 'build x', llm });
  check('3 candidates → 3 branches, all CREATED first', r2.branches.length === 3 && r2.status === 'COMPLETED');
  check('judge selects exactly one, rejects the rest with reasons', r2.branches.filter((b) => b.status === 'SELECTED').length === 1 && r2.branches.filter((b) => b.status === 'REJECTED').length === 2 && r2.branches.every((b) => b.status === 'SELECTED' || b.status === 'REJECTED'));
  const sel = r2.branches.find((b) => b.id === r2.selectedId);
  check('selected branch is the judge\'s pick ("Spike then build")', sel.name === 'Spike then build' && /retires/.test(sel.verdict || ''));
  check('rejected branches carry their because-reason', r2.branches.filter((b) => b.status === 'REJECTED').every((b) => (b.rejectedBecause || '').length > 3));
  check('bounded: exactly 2 llm calls (generate + judge)', r2.cost.llmCalls === 2 && strategyCalls === 2);
  check('predicted outcome stored on the selected branch', typeof sel.predictedOutcome === 'string' && sel.predictedItems === 3);

  const five = { candidates: [1, 2, 3, 4, 5].map((i) => ({ name: `S${i}`, approach: `approach ${i}`, predictedOutcome: 'x', predictedRisks: 'r', predictedItems: 2 })) };
  const r3 = await imagine({ objective: 'x', llm: async ({ system }) => (/(COUNTERFACTUAL|STRATEGY JUDGE)/.test(String(system)) ? JSON.stringify(five) : JSON.stringify({ selectedName: 'S2', verdicts: [] })) });
  check('MAX_BRANCHES enforced (5 offered → 3 kept)', r3.branches.length === IMAGINATION_BUDGETS.MAX_BRANCHES);

  const r4 = await imagine({ objective: 'x', llm: async () => { throw new Error('down'); } });
  check('generation failure → SIMULATION_UNAVAILABLE with real reason', r4.status === 'SIMULATION_UNAVAILABLE' && /generation failed/.test(r4.reason));
  check('a failed imagination pass costs 1 call, not a storm', r4.cost.llmCalls === 1);

  const r5 = await imagine({ objective: 'x', llm: async ({ system }) => (/(COUNTERFACTUAL)/.test(String(system)) ? JSON.stringify(STRATEGIES) : (() => { throw new Error('judge down'); })()) });
  const sel5 = r5.branches.find((b) => b.id === r5.selectedId);
  check('judge down → deterministic first-viable fallback, honestly labeled', r5.status === 'COMPLETED' && sel5.name === 'Sequential build' && /fallback/.test(r5.judgedBy));

  const single = { candidates: [{ name: 'Only way', approach: 'just do it', predictedOutcome: 'fine', predictedRisks: 'none', predictedItems: 1 }] };
  const r6 = await imagine({ objective: 'x', llm: async () => JSON.stringify(single) });
  check('single candidate → selected without a judge call (budget respected)', r6.status === 'COMPLETED' && r6.cost.llmCalls === 1 && r6.judgedBy === 'only-candidate');
}

console.log('\n== D. PREDICTED vs ACTUAL: deviation from real numbers ==');
{
  const img = { status: 'COMPLETED', selectedId: 's1', judgedBy: 'llm-judge', branches: [{ id: 's1', name: 'Spike then build', approach: 'a', predictedOutcome: 'works first try', predictedRisks: 'spike eats time', predictedItems: 3 }] };
  const ok = comparePredictedVsActual(img, { verdict: 'pass', score: 1.0, itemsTotal: 3, itemsDone: 3, itemsFailed: 0, replans: 0 });
  check('prediction held → outcomeMatched true, delta 0', ok.outcomeMatched === true && ok.itemsDelta === 0);
  check('held lesson says: reuse the strategy shape', /Prediction held/.test(ok.lesson));
  const miss = comparePredictedVsActual(img, { verdict: 'fail', score: 0.3, itemsTotal: 5, itemsDone: 3, itemsFailed: 2, replans: 1 });
  check('deviation computed from real numbers (+2 items, verdict fail)', miss.itemsDelta === 2 && miss.outcomeMatched === false && miss.actual.itemsFailed === 2);
  check('deviation lesson cites reality, advises earlier verification', /reality took 5/.test(miss.lesson) && /hypothesis/.test(miss.lesson));
  check('no selected branch → null (never invents a review)', comparePredictedVsActual({ branches: [], selectedId: null }, { verdict: 'pass' }) === null);
}

console.log('\n== E. Lessons: record, persist, dedupe, retrieve ==');
{
  const e1 = recordLesson({ kind: 'failure', missionId: 'm1', objective: 'build a database migration tool', itemTitle: 'Write migration script', failure: 'ladder exhausted', cause: 'sqlite CLI missing', lesson: 'Check the sqlite CLI exists before scripting migrations.' });
  const e2 = recordLesson({ kind: 'failure', missionId: 'm2', objective: 'another migration mission', itemTitle: 'Write migration script', failure: 'x', cause: 'sqlite CLI missing', lesson: 'Check the sqlite CLI exists before scripting migrations.' });
  check('identical lessons dedupe (same entry, times++ → 2)', e1.id === e2.id && (e2.times || 1) === 2);
  check('lessons persisted to disk', fs.existsSync('./data/test-b211b2/missions/lessons.json'));
  recordLesson({ kind: 'recovery', missionId: 'm3', objective: 'build a poster', itemTitle: 'Render PNG', cause: 'font cache cold', lesson: 'First render may be slow; warm the font cache in the brief.' });
  const hits = retrieveLessons('write a migration script for the database', 3);
  check('retrieval ranks the relevant lesson first', hits.length > 0 && /sqlite/.test(hits[0].lesson));
  const none = retrieveLessons('kubernetes helm chart bamboo', 3);
  check('irrelevant query returns nothing (no noise in prompts)', none.length === 0);
  check('prompt block only appears when there is something real', formatLessonsBlock(none) === '' && /OPERATIONAL LESSONS/.test(formatLessonsBlock(hits)));
  const inProc = lessonCount();
  const childCount = Number(execFileSync('node', ['-e', "process.env.DATA_DIR='./data/test-b211b2'; import('./src/services/director/Lessons.js').then(m => console.log(m.lessonCount()))"], { cwd: process.cwd(), encoding: 'utf8' }).trim());
  check('lessons survive a process restart (cross-process read)', childCount === inProc && inProc >= 2);
}

console.log('\n== F. Integration: analyzer + imagination drive a REAL mission run ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'COMPLEX', risk: 'LOW', reasons: ['multi-domain objective'] };
  llm.strategyJson = STRATEGIES;
  llm.judgeJson = JUDGE;
  llm.planJson = PLAN(['Research the domain', 'Build the deliverable']);
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2f', objective: 'Build a full-stack web app, then test it', rawRequest: 'Build a full-stack web app, then test it' });

  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('mission completes with the intelligence layer active', m.state === 'COMPLETED', m.state);
  check('MISSION_ANALYZED event exists, decidedBy llm', hasEvent(mission.id, 'MISSION_ANALYZED'));
  check('analysis persisted on the mission (llm verdict)', m.analysis?.complexity === 'COMPLEX' && m.analysis?.decidedBy === 'llm');
  check('IMAGINATION_PASS event: simulated, never claimed as executed', hasEvent(mission.id, 'IMAGINATION_PASS'));
  const ipEvt = loadMissionEvents(mission.id).find((e) => e.type === 'IMAGINATION_PASS');
  check('imagination pass says which strategy was selected', /Spike then build/.test(ipEvt?.summary || '') && ipEvt?.data?.simulated === true);
  check('imagination stored: 3 branches, 1 selected, 2 rejected', m.imagination?.branches?.length === 3 && m.imagination.branches.filter((b) => b.status === 'REJECTED').length === 2);
  check('plan prompt carried the SIMULATED STRATEGY block (a plan input)', llm.planPrompts.some((p) => /SIMULATED STRATEGY/.test(p) && /Spike then build/.test(p)));
  check('IMAGINATION_REVIEW closed the loop (predicted vs actual)', hasEvent(mission.id, 'IMAGINATION_REVIEW'));
  check('review persisted with a real lesson', typeof m.imagination?.review?.lesson === 'string' && m.imagination.review.lesson.length > 30);
  check('deviation lesson recorded to the store', retrieveLessons('full-stack web app', 5).some((l) => l.kind === 'deviation' && l.missionId === mission.id));
  check('snapshot exposes the intelligence layer', runner.snapshot(mission.id).mission.imagination?.selected === 'Spike then build' && runner.snapshot(mission.id).mission.analysis?.complexity === 'COMPLEX');
}

console.log('\n== G. Integration: SIMPLE mission skips imagination (no wasted calls) ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'SIMPLE', risk: 'LOW', reasons: ['one short task'] };
  llm.planJson = PLAN(['Answer the question']);
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2g', objective: 'What is 2+2?', rawRequest: 'What is 2+2?' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('SIMPLE mission completes', m.state === 'COMPLETED', m.state);
  check('no imagination pass for SIMPLE missions', !hasEvent(mission.id, 'IMAGINATION_PASS') && llm.llmCallsByMarker.strategy === 0);
  check('analysis still ran (depth is a decision, not an assumption)', m.analysis?.complexity === 'SIMPLE');
}

console.log('\n== H. Integration: SIMULATION_UNAVAILABLE is honest, mission continues ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'COMPLEX', risk: 'LOW', reasons: ['multi-domain'] };
  llm.strategyThrows = true; // the imagination lane is down
  llm.planJson = PLAN(['Research the domain', 'Build the deliverable']);
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2h', objective: 'Build a full-stack web app, then test it', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('mission still completes without the simulation', m.state === 'COMPLETED', m.state);
  check('SIMULATION_UNAVAILABLE recorded on the mission', m.imagination?.status === 'SIMULATION_UNAVAILABLE' && m.imagination.simulated === false);
  const ipEvt = loadMissionEvents(mission.id).find((e) => e.type === 'IMAGINATION_PASS');
  check('event says unavailable honestly (warn severity, real reason)', ipEvt && /unavailable/.test(ipEvt.summary) && ipEvt.severity === 'warn');
  check('plan prompt has NO simulated strategy block', llm.planPrompts.every((p) => !/SIMULATED STRATEGY/.test(p)));
  check('no fake review was invented at the end', !hasEvent(mission.id, 'IMAGINATION_REVIEW'));
}

console.log('\n== I. Integration: CRITICAL risk gates the mission before anything runs ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'SIMPLE', risk: 'CRITICAL', reasons: ['destructive verb against production scope'] };
  llm.planJson = PLAN(['Wipe the database']);
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2i', objective: 'Delete the production database and wipe all user data', rawRequest: 'same' });
  await waitFor(() => loadMission(mission.id).state === 'AWAITING_INPUT');
  const gated = loadMission(mission.id);
  check('mission is AWAITING_INPUT on the risk gate', gated.state === 'AWAITING_INPUT' && /risk/i.test(gated.needsQuestion?.question || ''));
  check('NOTHING ran: no plan, no items, no sessions', llm.planPrompts.length === 0 && llm.sessionCalls === 0);
  const approve = runner.answer(mission.id, 'approve');
  check('approval accepted', approve.ok === true);
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  check('after approval the mission runs to completion', loadMission(mission.id).state === 'COMPLETED', loadMission(mission.id).state);
}

console.log('\n== J. Integration: a gate CHANGE (not approval) steers the plan ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'SIMPLE', risk: 'CRITICAL', reasons: ['destructive verb against production scope'] };
  llm.planJson = PLAN(['Wipe the test database only']);
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2j', objective: 'Delete the production database and wipe all user data', rawRequest: 'same' });
  await waitFor(() => loadMission(mission.id).state === 'AWAITING_INPUT');
  runner.answer(mission.id, 'No — only the test database, never production');
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('changed mission completes', m.state === 'COMPLETED', m.state);
  check('the change reached the REAL plan prompt as steering', llm.planPrompts.some((p) => /USER STEERING/.test(p) && /test database/.test(p)));
}

console.log('\n== K. Integration: failure lessons feed the NEXT mission ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'MODERATE', risk: 'LOW', reasons: ['two domains'] };
  llm.planJson = PLAN(['Write the migration script']);
  llm.alwaysThrowSession = 'sqlite3: command not found';
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2k', objective: 'Build a database migration tool for sqlite', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('failing mission failed honestly (not faked)', m.state === 'FAILED');
  check('failure lesson recorded from the real ladder failure', retrieveLessons('database migration tool sqlite', 10).some((l) => l.kind === 'failure' && l.missionId === mission.id && /different approach/.test(l.lesson)));
  check('LESSON_RECORDED event in the mission record', hasEvent(mission.id, 'LESSON_RECORDED'));

  // mission 2: same territory — the planner must SEE the lesson
  const llm2 = new FakeLlm();
  llm2.analysisJson = { complexity: 'MODERATE', risk: 'LOW', reasons: ['two domains'] };
  llm2.planJson = PLAN(['Check sqlite availability first', 'Write the migration script']);
  const runner2 = newRunner(llm2);
  const mission2 = runner2.create({ conversationId: 'cv-b2k2', objective: 'Build a database migration tool for sqlite', rawRequest: 'same again' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission2.id).state));
  check('second mission completes', loadMission(mission2.id).state === 'COMPLETED', loadMission(mission2.id).state);
  check('the failure lesson was injected into the next plan prompt', llm2.planPrompts.some((p) => /OPERATIONAL LESSONS/.test(p) && /migration/.test(p)));
}

console.log('\n== L. Integration: recovery that WORKS becomes a lesson ==');
{
  const llm = new FakeLlm();
  llm.analysisJson = { complexity: 'SIMPLE', risk: 'LOW', reasons: ['single task'] };
  llm.planJson = PLAN(['Render the poster']);
  llm.employeeQueue = [{ throw: 'font cache cold — render timed out' }]; // fails once, then the default deliverable
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'cv-b2l', objective: 'Design a poster and render it to PNG', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('mission completed after a recovery', m.state === 'COMPLETED', m.state);
  const recLessons = retrieveLessons('render poster png', 10).filter((l) => l.kind === 'recovery' && l.missionId === mission.id);
  check('recovery lesson recorded (what worked, not just what failed)', recLessons.length === 1 && /recovered/.test(recLessons[0].lesson));
}

console.log('\n============================================================');
console.log(`B211 B2 INTELLIGENCE: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
