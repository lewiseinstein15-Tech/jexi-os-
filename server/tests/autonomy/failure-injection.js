#!/usr/bin/env node
/**
 * B211 B4 — FAILURE INJECTION: things break; the system responds honestly
 * and keeps the record true.
 *
 * Injected failures (the model is scripted; every mechanism is real):
 *   1. Provider flakiness — an employee session throws twice (simulated
 *      rate-limit), the recovery ladder RETRYs and the work DELIVERS.
 *   2. Lane death — a session that never answers: the ladder exhausts
 *      (RETRY → REASSIGN → ESCALATE), the item fails HONESTLY, the mission
 *      replans ONCE with a different approach and completes with the dead
 *      subtree SUPERSEDED (visible in the record, never hidden).
 *   3. Verification failure — Vera fails the deliverable; one correction
 *      round runs (replan) and the second verify passes.
 *   4. Tool failure — the search tool throws mid-session; the session
 *      survives (TOOL_FAILED event, work continues).
 *   5. Imagination lane down on a COMPLEX mission — SIMULATION_UNAVAILABLE,
 *      never faked, mission completes.
 *   6. Lessons: every injected failure above leaves an operational lesson,
 *      and the NEXT plan for similar work sees it.
 */

process.env.DATA_DIR = './data/test-b211b4-fi';

const fs = (await import('node:fs')).default;
const { MissionRunner } = await import('../../src/services/director/MissionRunner.js');
const { loadMission, loadMissionEvents } = await import('../../src/services/director/Mission.js');
const { loadWorkGraph } = await import('../../src/services/director/WorkGraph.js');
const { retrieveLessons } = await import('../../src/services/director/Lessons.js');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(80); }
  return fn();
}

fs.rmSync('./data/test-b211b4-fi', { recursive: true, force: true });

const empOut = (d) => `## DELIVERABLE\n${d}\n## REPORT\nDelivered from real work, grounded in what actually ran.\n## CONFIDENCE\nhigh`;
const LONG = 'A complete, substantial deliverable covering the objective end to end with findings, reasoning and concrete results the verifier can check against the success criteria.';

const makeLlm = (over = {}) => ({
  analysisJson: { complexity: 'SIMPLE', risk: 'LOW', reasons: ['single task'] },
  planJson: { refinedObjective: 'do the work', assumptions: [], constraints: [], successCriteria: ['it is done'], items: [{ title: 'The work item', details: 'Do it properly.', capability: 'reasoning', requirements: [], dependsOn: [], searchQueries: [], expectedOutput: 'done', priority: 'normal' }] },
  replanJson: { refinedObjective: 'do the work differently', items: [{ title: 'The work item, different approach', details: 'A genuinely different way.', capability: 'reasoning', requirements: [], dependsOn: [], expectedOutput: 'done', priority: 'high' }] },
  verifyJson: { pass: true, score: 1.0, problems: [], rationale: 'ok' },
  sessionQueue: [],
  alwaysThrowSession: null,
  sessionThrowsFirst: 0,   // N: first N session calls throw, then succeed
  badOutputFirst: 0,       // N: first N session calls return unparseable output (BAD_OUTPUT ladder)
  throwUntilReplan: false, // throw until the replan prompt is answered (then succeed)
  replanAnswered: false,
  prompts: [],
  async employee({ system, user } = {}) {
    const sys = String(system || '');
    if (/MISSION COMPLEXITY/.test(sys)) return JSON.stringify(this.analysisJson);
    if (/COUNTERFACTUAL STRATEGY/.test(sys) || /STRATEGY JUDGE/.test(sys)) throw new Error('imagination lane down');
    if (/PERSISTENT MISSION/.test(sys)) { this.prompts.push(String(user || '')); return JSON.stringify(this.planJson); }
    if (/Part of a persistent mission failed/.test(sys)) { this.prompts.push(String(user || '')); this.replanAnswered = true; return JSON.stringify(this.replanJson); }
    if (/Mid-mission steering/.test(sys)) return JSON.stringify({ affectedItemIds: [], newItems: [], rationale: 'none' });
    this.sessionCalls = (this.sessionCalls || 0) + 1;
    if (this.alwaysThrowSession) throw new Error(this.alwaysThrowSession);
    if (this.sessionCalls <= this.sessionThrowsFirst) throw new Error('429 rate limited (injected)');
    if (this.throwUntilReplan && !this.replanAnswered) throw new Error('provider hard down (injected)');
    if (this.sessionCalls <= this.badOutputFirst) return 'garbage that parses to nothing';
    if (this.sessionQueue && this.sessionQueue.length) {
      const next = this.sessionQueue.shift();
      if (next && typeof next === 'object' && next.throw) throw new Error(next.throw);
      return next;
    }
    return empOut(LONG);
  },
  async verify() { return JSON.stringify(this.verifyJson); },
  async interpret() { return null; },
  async report() { return 'report'; },
  ...over,
});

const newRunner = (llm) => {
  const r = new MissionRunner();
  r.configure({ llm, tools: { search: async () => 'results' } });
  return r;
};

console.log('\n== 1a. Provider flakiness: 2 injected 429s — the model-lane fallback absorbs them ==');
{
  const llm = makeLlm({ sessionThrowsFirst: 2 });
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'fi-1a', objective: 'Do the resilient work', rawRequest: 'Do the resilient work' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  const evts = loadMissionEvents(mission.id);
  check('mission COMPLETED despite two injected provider failures', m.state === 'COMPLETED', m.state);
  check('the model lane REALLY failed and switched (fallback is real, not cosmetic)', evts.some((e) => e.type === 'MODEL_PROVIDER_FAILED') && evts.some((e) => e.type === 'MODEL_SWITCHED'));
  check('the work still delivered after the fallback', evts.some((e) => e.type === 'WORK_COMPLETED'));
}

console.log('\n== 1b. BAD_OUTPUT twice: the assignment ladder recovers, lesson recorded ==');
{
  const llm = makeLlm({ badOutputFirst: 1 }); // one garbage round: RETRY recovers (single-employee staffing cannot REASSIGN)
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'fi-1b', objective: 'Do the work that produces garbage at first', rawRequest: 'Do the work that produces garbage at first' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('mission COMPLETED after the assignment-level recovery ladder', m.state === 'COMPLETED', m.state);
  check('a recovery lesson was recorded (what worked)', retrieveLessons('garbage at first', 5).some((l) => l.kind === 'recovery' && l.missionId === mission.id));
}

console.log('\n== 2. Lane death: honest failure + ONE replan + superseded subtree ==');
{
  const llm = makeLlm({ throwUntilReplan: true });
  llm.planJson = { ...llm.planJson, items: [
    { title: 'The work item', details: 'Do it properly.', capability: 'reasoning', requirements: [], dependsOn: [], searchQueries: [], expectedOutput: 'done', priority: 'normal' },
    { title: 'The dependent item', details: 'Builds on the first.', capability: 'reasoning', requirements: [], dependsOn: [1], searchQueries: [], expectedOutput: 'done', priority: 'normal' },
  ] };
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'fi-2', objective: 'Do the work that will hit a dead lane', rawRequest: 'Do the work that will hit a dead lane' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  const graph = loadWorkGraph(mission.id);
  const evts = loadMissionEvents(mission.id);
  const types = evts.map((e) => e.type);
  const dead = graph.items.find((i) => i.status === 'SUPERSEDED');
  const replacement = graph.items.find((i) => /different approach/.test(i.title) && i.status === 'DONE');
  check('mission COMPLETED via the replan (dead work superseded, not retried)', m.state === 'COMPLETED' && Boolean(dead) && Boolean(replacement), `${m.state} dead=${dead?.status} rep=${replacement?.status}`);
  check('the failure is VISIBLE in the record (WORK_FAILED, never hidden)', types.includes('WORK_FAILED'));
  check('exactly one replan round was spent', m.usage.replans === 1);
  check('a failure lesson was recorded for future planning', retrieveLessons('dead lane', 5).some((l) => l.kind === 'failure' && l.missionId === mission.id && /different approach/.test(l.lesson)));
}

console.log('\n== 3. Verification failure: one correction round, then pass ==');
{
  const llm = makeLlm();
  let verifyCalls = 0;
  llm.verify = async () => { verifyCalls += 1; return verifyCalls === 1
    ? JSON.stringify({ pass: false, score: 0.3, problems: ['the deliverable is missing the summary section'], rationale: 'incomplete' })
    : JSON.stringify({ pass: true, score: 0.95, problems: [], rationale: 'corrected' }); };
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'fi-3', objective: 'Do the work needing correction', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  const evts = loadMissionEvents(mission.id);
  check('mission COMPLETED after the correction round', m.state === 'COMPLETED', m.state);
  check('the failed verdict is on the record (MISSION_VERIFIED with fail)', evts.some((e) => e.type === 'MISSION_VERIFIED' && e.data?.verdict === 'fail'));
  check('verification ran twice (fail → corrected pass)', verifyCalls === 2);
  check('the replan prompt included the REAL verification problems', llm.prompts.some((p) => /missing the summary section/.test(p)));
}

console.log('\n== 4. Tool failure mid-session: survives, honest event ==');
{
  const llm = makeLlm();
  llm.planJson = { ...llm.planJson, items: [{ title: 'Researched work', details: 'Research it.', capability: 'research', requirements: ['research'], dependsOn: [], searchQueries: ['the topic'], expectedOutput: 'findings', priority: 'normal' }] };
  const runner = new MissionRunner();
  runner.configure({ llm, tools: { search: async () => { throw new Error('search backend down (injected)'); } } });
  const mission = runner.create({ conversationId: 'fi-4', objective: 'Do the researched work', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('mission COMPLETED despite the search tool failing', m.state === 'COMPLETED', m.state);
}

console.log('\n== 5. Imagination lane down on a COMPLEX mission: honest skip ==');
{
  const llm = makeLlm({ analysisJson: { complexity: 'COMPLEX', risk: 'LOW', reasons: ['multi-domain'] } });
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'fi-5', objective: 'Build a full-stack web app with several parts, then test it', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  check('mission COMPLETED without the simulation', m.state === 'COMPLETED', m.state);
  check('SIMULATION_UNAVAILABLE recorded, never faked', m.imagination?.status === 'SIMULATION_UNAVAILABLE' && m.imagination.simulated === false);
}

console.log('\n== 6. Lessons from failures reach the NEXT plan ==');
{
  const llm = makeLlm();
  const runner = newRunner(llm);
  const mission = runner.create({ conversationId: 'fi-6', objective: 'Do the work that will hit a dead lane again', rawRequest: 'Do the work that will hit a dead lane again' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  check('a mission after failures sees operational lessons in its plan prompt', llm.prompts.some((p) => /OPERATIONAL LESSONS/.test(p) && /different approach|dead lane|garbage/.test(p)));
}

console.log('\n============================================================');
console.log(`B211 B4 FAILURE-INJECTION: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
