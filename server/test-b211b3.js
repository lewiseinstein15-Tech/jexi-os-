#!/usr/bin/env node
/**
 * B211 B3 — COMPUTER LAYER: Atlas + real browser driving in the Director lane.
 *
 * Under test (real execution, no mocks pretending to be production):
 *   ComputerOps: action-line parsing, capability HONESTY (local runtime →
 *   COMPUTER_BLOCKED with the true reason, never a fake page), the mock
 *   provider's deterministic round (actions + REAL observation fed back),
 *   bounded rounds, unparseable lines reported honestly.
 *   Employees: Atlas = Computer Operations (computer capability, browser-act
 *   tool, COMPUTER permission), capability synonyms, staffing.
 *   Permissions: browser-act requires READ+COMPUTER, enforced.
 *   EmployeeSession: the ```browser loop — Atlas's blocks REALLY execute,
 *   the observed page state lands in the NEXT model prompt, browserActions
 *   rides the RESULT; a non-computer employee's browser blocks are DENIED;
 *   a browserless environment produces an honest UNAVAILABLE context, never
 *   a fabricated page.
 *   MissionRunner: a computer-capability work item staffs Atlas and his
 *   computer telemetry lands in the mission's event record.
 */

// B211b3 store isolation: set BEFORE any module that reads config is loaded.
process.env.DATA_DIR = './data/test-b211b3';

const fs = (await import('node:fs')).default;
const { MissionRunner } = await import('./src/services/director/MissionRunner.js');
const { loadMission, loadMissionEvents } = await import('./src/services/director/Mission.js');
const { parseBrowserLine, runBrowserRound, computerCapabilities } = await import('./src/services/director/ComputerOps.js');
const { getEmployee, selectEmployee, normalizeCap } = await import('./src/services/director/Employees.js');
const { checkToolPermission, toolPermissionsFor } = await import('./src/services/director/Permissions.js');
const { runEmployeeSession, assembleBrief, employeeSystemPrompt, extractBrowserRequests, extractCommandRequests } = await import('./src/services/director/EmployeeSession.js');
const { DirectorTask } = await import('./src/services/director/TaskState.js');
const { TaskMailbox } = await import('./src/services/director/AgentMail.js');

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

fs.rmSync('./data/test-b211b3', { recursive: true, force: true });

console.log('\n== A. Browser action-line parsing ==');
{
  const g = parseBrowserLine('goto https://example.com');
  check('goto with protocol', g.action === 'goto' && g.url === 'https://example.com');
  const g2 = parseBrowserLine('goto example.com');
  check('goto without protocol gets https://', g2.action === 'goto' && g2.url === 'https://example.com');
  const c = parseBrowserLine('click-index 3');
  check('click-index', c.action === 'click-index' && c.index === 3);
  const t = parseBrowserLine('type-index 2 hello world with spaces');
  check('type-index keeps the full text', t.action === 'type-index' && t.index === 2 && t.text === 'hello world with spaces');
  const ct = parseBrowserLine('click-text Log in');
  check('click-text', ct.action === 'click-text' && ct.text === 'Log in');
  const s = parseBrowserLine('scroll up');
  check('scroll direction', s.action === 'scroll' && s.direction === 'up');
  const p = parseBrowserLine('press Enter');
  check('press key', p.action === 'press' && p.key === 'Enter');
  check('observe / back / forward bare actions', parseBrowserLine('observe').action === 'observe' && parseBrowserLine('back').action === 'back' && parseBrowserLine('forward').action === 'forward');
  check('garbage line → null', parseBrowserLine('do the thing please') === null);
  check('click-index without a number → null', parseBrowserLine('click-index') === null);
  check('empty line → null', parseBrowserLine('   ') === null);
}

console.log('\n== B. extractBrowserRequests: fenced blocks, one action per line ==');
{
  const out = [
    '## DELIVERABLE',
    'Working on it.',
    '```browser',
    'goto https://example.com',
    '```',
    '```run',
    'node analyze.js',
    '```',
    '```browser',
    'click-index 1',
    'type-index 2 find widgets',
    '```',
  ].join('\n');
  const lines = extractBrowserRequests(out);
  check('browser blocks extracted in order (2 blocks, 3 lines)', lines.length === 3 && lines[0] === 'goto https://example.com' && lines[2] === 'type-index 2 find widgets');
  check('run blocks are NOT browser requests', extractCommandRequests(out).length === 1);
  check('no blocks → no requests', extractBrowserRequests('plain text only').length === 0);
}

console.log('\n== C. Atlas: identity, staffing, permission ==');
{
  const atlas = getEmployee('atlas');
  check('Atlas is Computer Operations', atlas.role === 'Computer Operations');
  check('Atlas carries the computer capability', atlas.capabilities.includes('computer'));
  check('Atlas is staffed with the browser-act tool', atlas.supportedTools.includes('browser-act'));
  check('Atlas holds the COMPUTER permission', atlas.permissions.includes('COMPUTER'));
  check('computer capability staffing selects Atlas', selectEmployee(['computer']).agentId === 'atlas');
  check('synonyms normalize to computer', normalizeCap('browser') === 'computer' && normalizeCap('computer-use') === 'computer' && normalizeCap('desktop') === 'computer');
  check('browsing still means search (web research)', normalizeCap('browsing') === 'search');
  check('browser-act requires READ+COMPUTER', JSON.stringify(toolPermissionsFor('browser-act')) === JSON.stringify(['READ', 'COMPUTER']));
  const gate = checkToolPermission(atlas, 'browser-act');
  check('Atlas may drive the browser', gate.allowed === true);
  const zola = getEmployee('zola');
  const zgate = checkToolPermission(zola, 'browser-act');
  check('Zola is refused browser driving (not staffed, no COMPUTER)', zgate.allowed === false && /not staffed/.test(zgate.reason));
}

console.log('\n== D. ComputerOps: capability honesty (browserless environment) ==');
{
  process.env.COMPUTER_RUNTIME = 'local';
  const caps = computerCapabilities();
  check('local runtime honestly reports no browser', caps.browser === false && caps.provider === 'local');
  const events = [];
  const r = await runBrowserRound({
    lines: ['goto https://example.com', 'click-index 1'],
    emit: (type, f) => events.push({ type, ...f }),
    identity: { agentId: 'atlas', agentName: 'Atlas' },
  });
  check('browserless round is BLOCKED (never a fake page)', r.blocked === true && r.results.length === 0);
  check('COMPUTER_BLOCKED emitted with the true reason', events.some((e) => e.type === 'COMPUTER_BLOCKED' && /no browser/.test(e.summary)));
  check('no act/observe events were invented for a dead browser', !events.some((e) => e.type === 'COMPUTER_ACT' || e.type === 'COMPUTER_OBSERVE'));
}

console.log('\n== E. ComputerOps: a real round through the mock provider ==');
{
  process.env.COMPUTER_RUNTIME = 'mock';
  const caps = computerCapabilities();
  check('mock provider reports browser capability (test-only, env-gated)', caps.browser === true && caps.provider === 'mock');
  const events = [];
  const r = await runBrowserRound({
    lines: ['goto mock://site', 'click-index 1', 'type-index 2 find widgets', 'garbage line', 'click-index'],
    emit: (type, f) => events.push({ type, ...f }),
    identity: { agentId: 'atlas', agentName: 'Atlas' },
  });
  check('round executes (not blocked)', r.blocked === false);
  check('3 valid actions ran (4th cap enforced later at session level)', r.results.length === 4 && r.results.slice(0, 3).every((x) => x.ok));
  check('unparseable lines reported honestly, not silently dropped', r.results.some((x) => x.action === '(unparseable)' && x.ok === false));
  check('COMPUTER_ACT per real action', events.filter((e) => e.type === 'COMPUTER_ACT').length === 3);
  check('COMPUTER_OBSERVE carries the real observed page', events.some((e) => e.type === 'COMPUTER_OBSERVE' && e.data?.elementCount >= 2 && e.data?.textChars > 0));
  check('observation includes real page text and elements', /Mock browser page/.test(r.observation.textSnippet) && r.observation.elements.length >= 2);
  check('mock observation is honestly screenshot-less (never a fake image)', r.observation.screenshot === null);
}

console.log('\n== F. EmployeeSession: the browser loop, for real ==');
{
  process.env.COMPUTER_RUNTIME = 'mock';
  const atlas = getEmployee('atlas');
  const prompts = [];
  const events = [];
  const llm = async ({ system, user } = {}) => {
    prompts.push(String(user || ''));
    if (prompts.length === 1) {
      // round 1: Atlas acts on the page
      return ['## DELIVERABLE', 'I need to see the page first.', '```browser', 'goto mock://shop', 'click-index 1', '```', '', '## REPORT', 'Driving the real browser now.', '## CONFIDENCE', 'high'].join('\n');
    }
    // round 2: deliver grounded in what the page ACTUALLY showed
    return ['## DELIVERABLE', 'The page shows the mock shop with a BUY button and a search input. I clicked BUY via element #1 and observed the real page state afterwards.', '## REPORT', 'Browsed and verified live.', '## CONFIDENCE', 'high'].join('\n');
  };
  const task = new DirectorTask({ conversationId: 'b3-f', rawQuery: 'q', objective: 'open the shop page and click buy', successCriteria: ['buy clicked'] });
  const brief = assembleBrief({ task, subtask: { id: 'st1', title: 'drive the shop page', capability: 'computer' }, employee: atlas, dependencies: [] });
  const res = await runEmployeeSession({
    task, subtask: { id: 'st1', title: 'drive the shop page', capability: 'computer' },
    employee: atlas, brief, mailbox: new TaskMailbox('b3-f'),
    hooks: { onEvent: (e) => events.push(e) }, llm,
  });
  check('session delivered a result', Boolean(res && res.message && res.message.content));
  check('the system prompt carries the browser tool instructions', /DRIVE THE REAL BROWSER/.test(employeeSystemPrompt(atlas, brief)) && /```browser/.test(employeeSystemPrompt(atlas, brief)));
  check('COMPUTER_ACT events fired from the real session', events.filter((e) => e.type === 'COMPUTER_ACT').length === 2);
  check('COMPUTER_OBSERVE fired (observe→act→observe→verify)', events.some((e) => e.type === 'COMPUTER_OBSERVE'));
  check('the observed page state reached the NEXT model prompt', prompts.length >= 2 && /# BROWSER RESULTS/.test(prompts[1]) && /Mock browser page/.test(prompts[1]));
  check('the numbered elements were fed back for the next decision', /#1 <button>/.test(prompts[1]) || /#1 </.test(prompts[1]));
  check('browserActions rides the RESULT data', (res.data?.browserActions ?? res.browserActions) === 2 || events.some((e) => e.type === 'TASK_COMPLETED' && e.data?.browserActions === 2));
  check('the loop is bounded (2 model calls, no more)', prompts.length === 2);
}

console.log('\n== G. EmployeeSession: non-computer employees are DENIED ==');
{
  process.env.COMPUTER_RUNTIME = 'mock';
  const forge = getEmployee('forge');
  const events = [];
  const llm = async () => ['## DELIVERABLE', 'Trying the browser.', '```browser', 'goto mock://shop', '```', '', '## REPORT', 'attempted', '## CONFIDENCE', 'low'].join('\n');
  const task = new DirectorTask({ conversationId: 'b3-g', rawQuery: 'q', objective: 'browse the shop', successCriteria: ['page seen'] });
  const brief = assembleBrief({ task, subtask: { id: 'st1', title: 'browse', capability: 'code' }, employee: forge, dependencies: [] });
  const res = await runEmployeeSession({
    task, subtask: { id: 'st1', title: 'browse', capability: 'code' },
    employee: forge, brief, mailbox: new TaskMailbox('b3-g'),
    hooks: { onEvent: (e) => events.push(e) }, llm,
  });
  check('browser blocks from a non-computer employee are PERMISSION_DENIED', events.some((e) => e.type === 'PERMISSION_DENIED' && /Browser action skipped/.test(e.summary)));
  check('no computer action ran for the unpermitted employee', !events.some((e) => e.type === 'COMPUTER_ACT'));
  check('Forge was never given browser instructions in his system prompt', !/DRIVE THE REAL BROWSER/.test(employeeSystemPrompt(forge, brief)));
}

console.log('\n== H. EmployeeSession: browserless environment stays honest ==');
{
  process.env.COMPUTER_RUNTIME = 'local';
  const atlas = getEmployee('atlas');
  const prompts = [];
  const events = [];
  const llm = async ({ user } = {}) => {
    prompts.push(String(user || ''));
    if (prompts.length === 1) {
      return ['## DELIVERABLE', 'Opening the page.', '```browser', 'goto https://example.com', '```', '', '## REPORT', 'trying', '## CONFIDENCE', 'medium'].join('\n');
    }
    return ['## DELIVERABLE', 'The browser is unavailable in this environment — I could not open any page and I am reporting exactly that, nothing was browsed.', '## REPORT', 'honest unavailability report', '## CONFIDENCE', 'high'].join('\n');
  };
  const task = new DirectorTask({ conversationId: 'b3-h', rawQuery: 'q', objective: 'open the page', successCriteria: ['page opened'] });
  const brief = assembleBrief({ task, subtask: { id: 'st1', title: 'open the page', capability: 'computer' }, employee: atlas, dependencies: [] });
  const res = await runEmployeeSession({
    task, subtask: { id: 'st1', title: 'open the page', capability: 'computer' },
    employee: atlas, brief, mailbox: new TaskMailbox('b3-h'),
    hooks: { onEvent: (e) => events.push(e) }, llm,
  });
  check('COMPUTER_BLOCKED tells the truth in the event stream', events.some((e) => e.type === 'COMPUTER_BLOCKED'));
  check('the employee is told the browser is unavailable (no fake page state)', prompts.length >= 2 && /# BROWSER UNAVAILABLE/.test(prompts[1]) && /never claim/i.test(prompts[1]));
  check('no fake page text was fed back', !/Mock browser page/.test(prompts[1] || ''));
  check('session still completed with an honest report', Boolean(res && res.message && res.message.content));
}

console.log('\n== I. Mission level: a computer item staffs Atlas, telemetry lands ==');
{
  process.env.COMPUTER_RUNTIME = 'mock';
  const llm = {
    analysisJson: { complexity: 'SIMPLE', risk: 'LOW', reasons: ['single domain'] },
    planPrompts: [],
    async employee({ system, user } = {}) {
      const sys = String(system || '');
      if (/MISSION COMPLEXITY/.test(sys)) return JSON.stringify(this.analysisJson);
      if (/COUNTERFACTUAL STRATEGY/.test(sys) || /STRATEGY JUDGE/.test(sys)) throw new Error('no lane');
      if (/PERSISTENT MISSION/.test(sys)) { this.planPrompts.push(String(user || '')); return JSON.stringify({
        refinedObjective: 'Open the shop page in the real browser and click buy', assumptions: [], constraints: [],
        successCriteria: ['the shop page was opened and buy clicked'],
        items: [{ title: 'Drive the shop page in the real browser', details: 'Open the page, click BUY, report what the page actually shows.', capability: 'computer', requirements: ['computer'], dependsOn: [], searchQueries: [], expectedOutput: 'honest browsing report', priority: 'high' }],
      }); }
      if (/Mid-mission steering/.test(sys)) return JSON.stringify({ affectedItemIds: [], newItems: [], rationale: 'none' });
      // session: act once, then deliver grounded in the observed page
      this.sessionCalls = (this.sessionCalls || 0) + 1;
      if (this.sessionCalls === 1) {
        return ['## DELIVERABLE', 'Driving the page now.', '```browser', 'goto mock://shop', 'click-index 1', '```', '', '## REPORT', 'browsing', '## CONFIDENCE', 'high'].join('\n');
      }
      return ['## DELIVERABLE', 'Opened the mock shop and clicked BUY (element #1). The real page state after the click showed the shop page with its search input.', '## REPORT', 'done with real telemetry', '## CONFIDENCE', 'high'].join('\n');
    },
    async verify() { return JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'criteria met' }); },
    async interpret() { return null; },
    async report() { return 'report'; },
  };
  const runner = new MissionRunner();
  runner.configure({ llm, tools: { search: async () => 'none' } });
  const mission = runner.create({ conversationId: 'cv-b3i', objective: 'Open the shop page in the real browser and click buy', rawRequest: 'same' });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state));
  const m = loadMission(mission.id);
  const evts = loadMissionEvents(mission.id);
  check('mission completes', m.state === 'COMPLETED', m.state);
  const item = (loadMission(mission.id), null) || null;
  const graph = (await import('./src/services/director/WorkGraph.js')).loadWorkGraph(mission.id);
  const comp = graph.items.find((i) => i.capability === 'computer');
  check('the computer item exists in the work graph', Boolean(comp));
  check('Atlas executed it (employee record)', comp?.result?.employeeId === 'atlas');
  check('COMPUTER_ACT telemetry landed in the mission record', evts.filter((e) => e.type === 'COMPUTER_ACT').length === 2);
  check('COMPUTER_OBSERVE telemetry landed', evts.some((e) => e.type === 'COMPUTER_OBSERVE'));
  check('mission report exists', Boolean(m.result?.summary));
}

console.log('\n============================================================');
console.log(`B211 B3 COMPUTER: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
