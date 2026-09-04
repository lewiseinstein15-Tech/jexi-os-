#!/usr/bin/env node
/**
 * B212 — GAP CLOSURE: the two honest limitations from the B211 report.
 *
 * 1. FIX-IN-PLACE: an employee rewriting a file she wrote in an EARLIER
 *    round of the SAME session (the classic build → run → see it fail →
 *    fix the file → re-run loop) now really lands: FILE_UPDATED event, the
 *    disk file is the new version, and the employee's own NEXT command
 *    reads the fixed content back (zero-trust: the command output is the
 *    proof, not the event). Identical re-writes are no-ops.
 * 2. ANSWER VIA API: control('answer', { text }) — an AWAITING_INPUT
 *    mission (risk gate or blocking NEEDS) can be answered from the
 *    Missions screen without the chat.
 */

process.env.DATA_DIR = './data/test-b212';

const fs = (await import('node:fs')).default;
const path = (await import('node:path')).default;
const { MissionRunner } = await import('./src/services/director/MissionRunner.js');
const { loadMission, loadMissionEvents } = await import('./src/services/director/Mission.js');
const { runEmployeeSession, assembleBrief } = await import('./src/services/director/EmployeeSession.js');
const { DirectorTask } = await import('./src/services/director/TaskState.js');
const { TaskMailbox } = await import('./src/services/director/AgentMail.js');
const { getEmployee } = await import('./src/services/director/Employees.js');
const { COMMAND_WORKSPACE_ROOT } = await import('./src/services/director/CommandRunner.js');

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

fs.rmSync('./data/test-b212', { recursive: true, force: true });

console.log('\n== 1. Fix-in-place: same-session artifact rewrite really lands ==');
{
  const forge = getEmployee('forge');
  const events = [];
  const prompts = [];
  const V1 = 'function total(items) { return items.length; } // wrong on purpose\nmodule.exports = { total };\n';
  const V2 = 'function total(items) { return items.reduce((a, b) => a + b, 0); } // fixed after the real failing run\nmodule.exports = { total };\n';
  const TEST = `const test = require('node:test');\nconst assert = require('node:assert');\nconst { total } = require('./calc.js');\ntest('total([2,3]) is 5', () => assert.strictEqual(total([2, 3]), 5));\n`;
  let round = 0;
  const llm = async ({ user } = {}) => {
    prompts.push(String(user || ''));
    round += 1;
    if (round === 1) {
      return ['## DELIVERABLE', 'Writing the module and its test, then running it.', '', '```js calc.js', V1, '```', '', '```js calc.test.js', TEST, '```', '', '```run', 'node --test calc.test.js', '```', '', '## REPORT', 'running the suite', '## CONFIDENCE', 'medium'].join('\n');
    }
    if (round === 2) {
      // fix-in-place AND read the file back with the employee's OWN command —
      // if the rewrite had not landed, this cat would show the OLD content
      return ['## DELIVERABLE', 'The real test run failed — total returned the count, not the sum. Fixing calc.js in place, reading it back, re-running.', '', '```js calc.js', V2, '```', '', '```run', 'cat calc.js', '```', '', '```run', 'node --test calc.test.js', '```', '', '## REPORT', 'fix-in-place, verifying and re-running', '## CONFIDENCE', 'high'].join('\n');
    }
    return ['## DELIVERABLE', 'Fixed and verified: the cat output showed the fixed reduce version on disk, and total([2,3]) === 5 with the suite passing for real.', '## REPORT', 'done', '## CONFIDENCE', 'high'].join('\n');
  };
  const task = new DirectorTask({ conversationId: 'b212-1', rawQuery: 'q', objective: 'write and fix calc.js', successCriteria: ['tests pass'] });
  task.workspaceId = 'b212-ws-1';
  const brief = assembleBrief({ task, subtask: { id: 'st1', title: 'write and fix calc.js', capability: 'code' }, employee: forge, dependencies: [] });
  const res = await runEmployeeSession({
    task, subtask: { id: 'st1', title: 'write and fix calc.js', capability: 'code' },
    employee: forge, brief, mailbox: new TaskMailbox('b212-1'),
    hooks: { onEvent: (e) => events.push(e) }, llm,
  });

  check('session delivered', Boolean(res && res.message && res.message.content));
  check('FILE_CREATED fired once for calc.js', events.filter((e) => e.type === 'FILE_CREATED' && e.data?.file === 'calc.js').length === 1);
  check('FILE_UPDATED fired for the fix-in-place', events.filter((e) => e.type === 'FILE_UPDATED' && e.data?.file === 'calc.js').length === 1);
  const onDisk = fs.readFileSync(path.join(COMMAND_WORKSPACE_ROOT, 'b212-ws-1', 'calc.js'), 'utf8');
  check('the file on disk is the FIXED version', onDisk.includes('reduce') && !onDisk.includes('wrong on purpose'));
  const catRound = prompts.findIndex((p) => /COMMAND RESULTS/.test(p) && /cat calc\.js/.test(p));
  check("the employee's own `cat calc.js` results came back (round 2 executed it)", catRound >= 0, `prompts=${prompts.length}`);
  const catOutput = catRound >= 0 ? prompts[catRound] : '';
  check('the cat COMMAND RESULTS show the FIXED content on disk (zero-trust proof)', /reduce/.test(catOutput) && !/wrong on purpose/.test(catOutput), catOutput.slice(0, 160));
  check('identical rewrite would be a no-op (bytes tracked)', events.filter((e) => e.type === 'FILE_UPDATED' && e.data?.file === 'calc.js').length === 1);
  check('the real test suite failed then passed (real node --test runs)', events.some((e) => e.type === 'TEST_FAILED') && events.some((e) => e.type === 'TEST_COMPLETED'));
}

console.log('\n== 2. control(answer): answer an AWAITING_INPUT mission via the API ==');
{
  const llm = {
    analysisJson: { complexity: 'SIMPLE', risk: 'CRITICAL', reasons: ['destructive verb against production scope'] },
    async employee({ system } = {}) {
      const sys = String(system || '');
      if (/MISSION COMPLEXITY/.test(sys)) return JSON.stringify(this.analysisJson);
      if (/COUNTERFACTUAL STRATEGY/.test(sys) || /STRATEGY JUDGE/.test(sys)) throw new Error('down');
      if (/PERSISTENT MISSION/.test(sys)) return JSON.stringify({
        refinedObjective: 'wipe only the test database', assumptions: [], constraints: [],
        successCriteria: ['done'],
        items: [{ title: 'Wipe the test database', details: 'Do it.', capability: 'code', requirements: [], dependsOn: [], searchQueries: [], expectedOutput: 'done', priority: 'normal' }],
      });
      if (/Part of a persistent mission failed/.test(sys)) return JSON.stringify({ refinedObjective: 'x', items: [] });
      if (/Mid-mission steering/.test(sys)) return JSON.stringify({ affectedItemIds: [], newItems: [], rationale: 'none' });
      return '## DELIVERABLE\nA complete, substantial deliverable covering the objective end to end with findings, reasoning and concrete results the verifier can check against the success criteria.\n## REPORT\nDone.\n## CONFIDENCE\nhigh';
    },
    async verify() { return JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'ok' }); },
    async interpret() { return null; },
    async report() { return 'report'; },
  };
  const runner = new MissionRunner();
  runner.configure({ llm, tools: { search: async () => 'none' } });
  const mission = runner.create({ conversationId: 'b212-2', objective: 'Delete the production database and wipe all user data', rawRequest: 'Delete the production database and wipe all user data' });
  await waitFor(() => loadMission(mission.id).state === 'AWAITING_INPUT');
  check('risk gate holds the mission (AWAITING_INPUT)', loadMission(mission.id).state === 'AWAITING_INPUT');

  const bad = runner.control(mission.id, 'answer', {});
  check('empty answer is refused honestly', bad.ok === false);

  const r = runner.control(mission.id, 'answer', { text: 'approve' });
  check('control(answer, approve) is accepted', r.ok === true);
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  check('mission COMPLETED after the API answer', loadMission(mission.id).state === 'COMPLETED', loadMission(mission.id).state);
  check('the answer is on the event record (MISSION_RESUMED)', loadMissionEvents(mission.id).some((e) => e.type === 'MISSION_RESUMED'));
}

console.log('\n============================================================');
console.log(`B212: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
