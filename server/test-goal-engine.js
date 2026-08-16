/**
 * JEXI OS — Goal Engine regression suite (autonomy core).
 * All LLM/planner/orchestrator interactions are mocked — no keys needed.
 */

import { GoalEngine, AUTONOMY_LEVELS } from './src/services/GoalEngine.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// --- Mocks -------------------------------------------------------------
const fakePlanner = {
  async analyzeIntent(goal) {
    return { intent: /flight|trip|book/i.test(goal) ? 'compound_task' : 'code_task', complexity: 'COMPLEX', steps: ['product', 'engineer', 'coder'], teamSlugs: ['product'] };
  },
};

const fakeOrchestrator = {
  async executePlan(plan, query, sendEvent, opts) {
    sendEvent('log', { agent: 'Coder', message: 'mocked run' });
    // Simulate auto-approvals under full autonomy.
    if (opts.autoConfirm) {
      opts._autoApprovals = [{ question: 'Approve booking on airline.com?' }];
    }
    return { success: true, summary: '✅ Mocked goal completed.', statistics: { executionTime: 5, agentsUsed: 3 } };
  },
};

const questionsJson = JSON.stringify({ questions: [{ field: 'departure', question: 'What city are you departing from?' }, { field: 'date', question: 'What date?' }] });

const fakeGenerate = async () => questionsJson;

function freshEngine() {
  const store = {
    saved: null, cleared: false,
    saveRun: (session, data) => { store.saved = { session, data }; },
    loadRun: () => store.saved ? store.saved.data : null,
    clearRun: () => { store.cleared = true; },
  };
  const engine = new GoalEngine({ planner: fakePlanner, orchestrator: fakeOrchestrator, generateContent: fakeGenerate, store });
  return { engine, store };
}

console.log('\n== Autonomy levels ==');
ok(Array.isArray(AUTONOMY_LEVELS) && AUTONOMY_LEVELS.includes('ask') && AUTONOMY_LEVELS.includes('full'), 'ask + full levels defined');

console.log('\n== Full autonomy: preflight questions then park ==');
{
  const { engine } = freshEngine();
  const events = [];
  const out = await engine.startGoal({ goal: 'book me a flight', session: 's1', autonomy: 'full', sendEvent: (t, d) => events.push(t) });
  ok(out.needInfo && out.needInfo.length === 2, 'returns the preflight questions');
  ok(out.needInfo[0].field === 'departure', 'question 1 field correct');
  ok(engine.goal(out.goalId).status === 'need-info', 'goal parked as need-info');
  ok(events.includes('goal.need-info'), 'emitted goal.need-info event');
}

console.log('\n== Full autonomy: answers provided → runs to completion ==');
{
  const { engine } = freshEngine();
  const events = [];
  const out = await engine.startGoal({ goal: 'book me a flight', session: 's2', autonomy: 'full', providedInfo: 'Nairobi, tomorrow', sendEvent: (t) => events.push(t) });
  ok(out.result && out.result.success === true, 'goal completes when info provided upfront');
  ok(events.includes('goal.info-provided'), 'emitted goal.info-provided');
  ok(engine.goal(out.goalId).status === 'done', 'goal marked done');
}

console.log('\n== Ask autonomy: no preflight, orchestrator runs as-is ==');
{
  const { engine } = freshEngine();
  const out = await engine.startGoal({ goal: 'build me a todo app', session: 's3', autonomy: 'ask' });
  ok(out.result && out.result.success === true, 'ask mode runs the orchestrator');
  const g = engine.goal(out.goalId);
  ok(g.autoApprovals === 0, 'no auto-approvals in ask mode');
}

console.log('\n== Full autonomy: auto-approvals recorded ==');
{
  const { engine } = freshEngine();
  const out = await engine.startGoal({ goal: 'book me a flight', session: 's4', autonomy: 'full', providedInfo: 'from Nairobi to Mombasa on Friday' });
  const g = engine.goal(out.goalId);
  ok(g.autoApprovals >= 1, 'auto-approved confirmations recorded');
}

console.log('\n== Resume with info (parked → run) ==');
{
  const { engine } = freshEngine();
  const out = await engine.startGoal({ goal: 'book me a flight', session: 's5', autonomy: 'full' });
  ok(out.needInfo, 'parked');
  const resumed = await engine.resumeWithInfo({ goalId: out.goalId, session: 's5', answer: 'Nairobi → London, next Monday' });
  ok(resumed.result && resumed.result.success === true, 'resume completes the goal');
  ok(engine.goal(out.goalId).status === 'done', 'goal done after resume');
}

console.log('\n== Goal-level retry with failure context ==');
{
  let calls = 0;
  const failingOrchestrator = {
    async executePlan(plan, query, sendEvent, opts) {
      calls += 1;
      if (calls === 1) return { success: false, error: 'provider timeout' };
      return { success: true, summary: '✅ Completed on retry.' };
    },
  };
  const engine = new GoalEngine({ planner: fakePlanner, orchestrator: failingOrchestrator, generateContent: fakeGenerate, store: null });
  const events = [];
  const out = await engine.startGoal({ goal: 'build me a todo app', session: 's6', autonomy: 'ask', sendEvent: (t) => events.push(t) });
  ok(calls === 2, 'failed run retried once');
  ok(out.result && out.result.success === true, 'goal completed after retry');
  ok(events.filter((t) => t === 'goal.attempt').length === 2, 'two goal.attempt events');
}

console.log('\n== Degraded: no generateContent → no questions, runs anyway ==');
{
  const engine = new GoalEngine({ planner: fakePlanner, orchestrator: fakeOrchestrator, generateContent: null, store: null });
  const out = await engine.startGoal({ goal: 'book me a flight', session: 's7', autonomy: 'full' });
  ok(out.result && out.result.success === true, 'no LLM → preflight skipped, orchestrator still runs');
}

console.log('\n== Malformed LLM JSON → safe fallback (no questions) ==');
{
  const badGen = async () => 'not json at all {';
  const engine = new GoalEngine({ planner: fakePlanner, orchestrator: fakeOrchestrator, generateContent: badGen, store: null });
  const out = await engine.startGoal({ goal: 'book me a flight', session: 's8', autonomy: 'full' });
  ok(out.result && out.result.success === true, 'malformed preflight JSON degrades to running without questions');
}

console.log('\n== List / find parked ==');
{
  const { engine } = freshEngine();
  await engine.startGoal({ goal: 'book me a flight', session: 's9', autonomy: 'full' });
  const goals = engine.listGoals();
  ok(goals.length >= 1, 'listGoals returns records');
  ok(goals[0].goal.includes('book me a flight'), 'record has the goal text');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
