#!/usr/bin/env node
/**
 * B211 B4 — BROWSER DISCONNECT: chat is a VIEW; the mission is the work.
 *
 * A browser disconnecting (socket drop, app backgrounded, proxy kill) is
 * simulated by a sendEvent/done that THROWS — exactly what the stream
 * consumer's death looks like to the bridge. What must be true:
 *
 *   1. a viewer dying mid-stream changes NOTHING server-side: the mission
 *      runs to completion in the background;
 *   2. every event is still persisted (the record is the source of truth);
 *   3. a RECONNECTED viewer (fresh subscribe / "Continue.") receives the
 *      full replayed history — the work is not lost to the dead socket;
 *   4. a viewer that is dead on arrival (first event throws) still changes
 *      nothing.
 */

process.env.DATA_DIR = './data/test-b211b4-bd';

const fs = (await import('node:fs')).default;
const { MissionRunner } = await import('../../src/services/director/MissionRunner.js');
const { loadMission, loadMissionEvents } = await import('../../src/services/director/Mission.js');

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

fs.rmSync('./data/test-b211b4-bd', { recursive: true, force: true });

const empOut = () => '## DELIVERABLE\nA complete, substantial deliverable covering the objective end to end with findings, reasoning and concrete results the verifier can check against the success criteria.\n## REPORT\nDone from real work.\n## CONFIDENCE\nhigh';

const makeLlm = () => ({
  async employee({ system } = {}) {
    const sys = String(system || '');
    if (/MISSION COMPLEXITY/.test(sys)) return JSON.stringify({ complexity: 'SIMPLE', risk: 'LOW', reasons: ['x'] });
    if (/COUNTERFACTUAL STRATEGY/.test(sys) || /STRATEGY JUDGE/.test(sys)) throw new Error('down');
    if (/PERSISTENT MISSION/.test(sys)) return JSON.stringify({
      refinedObjective: 'do the disconnected work', assumptions: [], constraints: [],
      successCriteria: ['it is done'],
      items: [{ title: 'The work item', details: 'Do it.', capability: 'reasoning', requirements: [], dependsOn: [], searchQueries: [], expectedOutput: 'done', priority: 'normal' }],
    });
    if (/Part of a persistent mission failed/.test(sys)) return JSON.stringify({ refinedObjective: 'x', items: [] });
    if (/Mid-mission steering/.test(sys)) return JSON.stringify({ affectedItemIds: [], newItems: [], rationale: 'none' });
    await new Promise((r) => setTimeout(r, 1200)); // the work takes a moment — the viewer dies mid-run
    return empOut();
  },
  async verify() { return JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'ok' }); },
  async interpret() { return null; },
  async report() { return 'report'; },
});

const newRunner = () => {
  const r = new MissionRunner();
  r.configure({ llm: makeLlm(), tools: { search: async () => 'none' } });
  return r;
};

console.log('\n== 1. Viewer dies MID-STREAM: the mission continues server-side ==');
{
  const runner = newRunner();
  let delivered = 0;
  const sendEvent = () => { // the socket delivers 2 events, then the viewer is GONE
    if (delivered >= 2) throw new Error('ECONNRESET — viewer gone (injected)');
    delivered += 1;
  };
  const handled = await runner.handleChat({
    raw: 'As a mission: do the disconnected work',
    effectiveQuery: 'As a mission: do the disconnected work',
    convId: 'bd-1',
    sendEvent,
    done: () => {}, // the dead viewer's done() — later turns use their own
  });
  check('the mission lane claimed the message', handled === true);

  const m0 = loadMission(fs.readdirSync('./data/test-b211b4-bd/missions').map((id) => loadMission(id)).find((x) => x.conversationId === 'bd-1').id);
  // the viewer reconnects WHILE THE MISSION IS STILL RUNNING (slow session)
  const stillRunning = await waitFor(() => loadMission(m0.id).state === 'EXECUTING', 8000);
  check('reconnect happens while the mission is still executing', stillRunning, loadMission(m0.id).state);

  const reSeen = [];
  const continueDone = [];
  const claimed = await runner.handleChat({
    raw: 'Continue.', effectiveQuery: 'Continue.', convId: 'bd-1',
    sendEvent: (type, payload) => { if (type === 'team' && payload?.event) reSeen.push(payload.event); },
    done: (p) => { continueDone.push(p); },
  });
  await waitFor(() => continueDone.length > 0, 30000);
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(m0.id).state));
  const m = loadMission(m0.id);
  check('mission COMPLETED although the first viewer died at event 3', m.state === 'COMPLETED', m.state);
  const evts = loadMissionEvents(m0.id);
  check('far more events persisted than the dead viewer ever saw', evts.length > 5 && delivered === 2, `persisted=${evts.length} delivered=${delivered}`);
  check('the full record is intact (created → completed)', evts[0].type === 'MISSION_CREATED' && evts.some((e) => e.type === 'MISSION_COMPLETED'));
  check('Continue. re-attached the reconnected viewer and finished the turn', claimed === true && continueDone.length > 0 && continueDone[0].success !== false);
  check('the reconnected viewer received the REPLAYED history first (reconnect contract)', reSeen.length >= 3 && reSeen[0].type === 'MISSION_CREATED');
  check('the reconnected viewer saw the live completion too', reSeen.some((e) => e.type === 'MISSION_COMPLETED'));
}

console.log('\n== 2. Viewer dead ON ARRIVAL: still nothing lost ==');
{
  const runner = newRunner();
  const donePayloads = [];
  const handled = await runner.handleChat({
    raw: 'As a mission: do the never-seen work',
    effectiveQuery: 'As a mission: do the never-seen work',
    convId: 'bd-2',
    sendEvent: () => { throw new Error('socket closed before the first byte (injected)'); },
    done: (p) => { donePayloads.push(p); },
  });
  check('the mission lane still claimed the message', handled === true);
  const dir = './data/test-b211b4-bd/missions';
  const ids = fs.readdirSync(dir);
  const m2 = loadMission(ids.map((id) => loadMission(id)).find((x) => x.conversationId === 'bd-2').id);
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(m2.id).state));
  check('mission COMPLETED with a viewer that saw literally nothing', loadMission(m2.id).state === 'COMPLETED');
  check('the record is complete regardless', loadMissionEvents(m2.id).some((e) => e.type === 'MISSION_COMPLETED'));
}

console.log('\n============================================================');
console.log(`B211 B4 BROWSER-DISCONNECT: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
