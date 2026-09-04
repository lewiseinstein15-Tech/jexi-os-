#!/usr/bin/env node
/**
 * B211 B4 — LONG-HORIZON AUTONOMY: an unguided mission builds + tests + FIXES
 * + verifies a small full-stack app.
 *
 * The only faked thing is the MODEL (the established harness pattern: the
 * LLM is scripted, the MACHINERY is real). Everything else actually runs:
 *
 *   - the MissionRunner plans a 2-item work graph and executes it in
 *     dependency order with zero steering from this test (unguided);
 *   - Forge's artifacts really land in the task workspace;
 *   - `node --test api.test.js` REALLY executes in that workspace via the
 *     allowlisted CommandRunner — and REALLY FAILS first (server.js ships
 *     with a planted bug);
 *   - the real failing output is fed back to the employee, whose fix really
 *     rewrites the file, and the suite REALLY passes on the second run;
 *   - the anti-fabrication verifier sees the real TEST_* events;
 *   - finally THIS TEST re-runs the suite itself, fresh, trusting nothing
 *     the mission claimed.
 */

process.env.DATA_DIR = './data/test-b211b4-lh';

const fs = (await import('node:fs')).default;
const path = (await import('node:path')).default;
const { execFile } = (await import('node:child_process')).default;
const { promisify } = (await import('node:util')).default;
const execFileAsync = promisify(execFile);

const { MissionRunner } = await import('../../src/services/director/MissionRunner.js');
const { loadMission, loadMissionEvents } = await import('../../src/services/director/Mission.js');
const { loadWorkGraph } = await import('../../src/services/director/WorkGraph.js');
const { COMMAND_WORKSPACE_ROOT } = await import('../../src/services/director/CommandRunner.js');

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

fs.rmSync('./data/test-b211b4-lh', { recursive: true, force: true });
fs.rmSync(path.join(COMMAND_WORKSPACE_ROOT), { recursive: true, force: true });

/* ── the app the mission will build ─────────────────────────────────────── */

const BUGGY_SERVER = `const http = require('http');
// add handler — planted bug: subtracts instead of adding
function add(a, b) { return a - b; }
module.exports = { add, createServer: () => http.createServer((req, res) => res.end(JSON.stringify({ ok: true, sum: add(2, 3) }))) };
`;
const FIXED_SERVER = `const http = require('http');
// add handler — fixed after the test suite caught the real bug
function add(a, b) { return a + b; }
module.exports = { add, createServer: () => http.createServer((req, res) => res.end(JSON.stringify({ ok: true, sum: add(2, 3) }))) };
`;
const INDEX_HTML = '<!doctype html><html><head><title>Sum API</title></head><body><h1>Sum API</h1><p>GET / returns the sum of 2 and 3.</p></body></html>';
const TEST_FILE = `const test = require('node:test');
const assert = require('node:assert');
const { add } = require('./server.js');
test('add(2,3) returns 5', () => { assert.strictEqual(add(2, 3), 5); });
test('add(-1,1) returns 0', () => { assert.strictEqual(add(-1, 1), 0); });
`;

const out = (deliverable) => `## DELIVERABLE\n${deliverable}\n\n## REPORT\nWorking from the real results.\n## CONFIDENCE\nhigh`;

/* ── the scripted workforce (model only — machinery is real) ────────────── */

const sessionScript = [
  // item 1: build the app (bug included — the mission must catch it in item 2)
  out(['Built the app: the API module and the static page.', '', '```js server.js', BUGGY_SERVER, '```', '', '```html public/index.html', INDEX_HTML, '```'].join('\n')),
  // item 2, round 0: write the suite, run it → the REAL run fails
  out(['Wrote the test suite. Running it now.', '', '```js api.test.js', TEST_FILE, '```', '', '```run', 'node --test api.test.js', '```'].join('\n')),
  // item 2, round 1: the real failure came back → fix and re-run (content completed below after seeing real output)
  null,
  // item 2, round 2: deliver grounded in the real pass
  null,
];

const llm = {
  analysisJson: { complexity: 'MODERATE', risk: 'LOW', reasons: ['two-stage build'] },
  prompts: [],
  async employee({ system, user } = {}) {
    const sys = String(system || '');
    if (/MISSION COMPLEXITY/.test(sys)) return JSON.stringify(this.analysisJson);
    if (/COUNTERFACTUAL STRATEGY/.test(sys) || /STRATEGY JUDGE/.test(sys)) throw new Error('no lane');
    if (/PERSISTENT MISSION/.test(sys)) {
      this.prompts.push(String(user || ''));
      return JSON.stringify({
        refinedObjective: 'Build, test, fix and verify a small full-stack app (Node API + static page)',
        assumptions: [], constraints: [],
        successCriteria: ['server.js implements add correctly', 'the test suite passes', 'a static page exists'],
        items: [
          { title: 'Build the API server and the static page', details: 'Write server.js (an add handler + server factory) and public/index.html.', capability: 'code', requirements: ['code'], dependsOn: [], searchQueries: [], expectedOutput: 'the app files', priority: 'normal' },
          { title: 'Write the test suite, run it, and fix every failure', details: 'Write api.test.js for the add handler, run node --test, fix what fails, re-run until green.', capability: 'code', requirements: ['code'], dependsOn: [1], searchQueries: [], expectedOutput: 'all tests passing, for real', priority: 'high' },
        ],
      });
    }
    if (/Part of a persistent mission failed/.test(sys)) return JSON.stringify({ refinedObjective: 'fix', items: [] });
    if (/Mid-mission steering/.test(sys)) return JSON.stringify({ affectedItemIds: [], newItems: [], rationale: 'none' });
    // employee session rounds
    this.prompts.push(String(user || ''));
    const idx = (this.sessionCalls = (this.sessionCalls || 0) + 1) - 1;
    if (idx === 0) return sessionScript[0];
    if (idx === 1) return sessionScript[1];
    if (idx === 2) {
      // the fix must be a REACTION to the real output this test verifies below
      const sawRealFailure = /add\(2,3\) returns 5|AssertionError|strictEqual|failing/i.test(String(user || ''));
      if (!sawRealFailure) throw new Error('round-1 employee got no real failure output — the loop is not grounded');
      return out(['The test run caught a real bug: add subtracted instead of adding. Fixed server.js and re-running.', '', '```js server.js', FIXED_SERVER, '```', '', '```run', 'node --test api.test.js', '```'].join('\n'));
    }
    return out(['Both tests pass now (real exit 0 from node --test): add(2,3)=5 and add(-1,1)=0. The app is built, tested and fixed.']);
  },
  async verify() { return JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'criteria met with real test events' }); },
  async interpret() { return null; },
  async report() { return 'report'; },
};

console.log('\n== LONG-HORIZON MISSION: build + test + fix + verify (unguided) ==');
{
  const runner = new MissionRunner();
  runner.configure({ llm, tools: { search: async () => 'none needed' } });
  const mission = runner.create({
    conversationId: 'cv-b4-lh',
    objective: 'As a mission: build a small full-stack app — a Node API with an add handler and a static page — then write a test suite, run it, fix every failure, and verify it all works.',
    rawRequest: 'same',
  });

  await waitFor(() => ['COMPLETED', 'FAILED'].includes(loadMission(mission.id).state), 60000);
  const m = loadMission(mission.id);
  const graph = loadWorkGraph(mission.id);
  const evts = loadMissionEvents(mission.id);
  const types = evts.map((e) => e.type);
  const build = graph.items.find((i) => /Build the API/.test(i.title));
  const fix = graph.items.find((i) => /test suite/.test(i.title));

  check('mission COMPLETED', m.state === 'COMPLETED', `state=${m.state}`);
  check('both work items DONE', build?.status === 'DONE' && fix?.status === 'DONE', `${build?.status}/${fix?.status}`);
  const buildDoneAt = evts.findIndex((e) => e.type === 'WORK_COMPLETED' && e.data?.itemId === build.id);
  const fixStartAt = evts.findIndex((e) => e.type === 'WORK_STARTED' && e.data?.itemId === fix.id);
  check('dependency order respected (build DONE event before fix START event)', buildDoneAt >= 0 && fixStartAt >= 0 && buildDoneAt < fixStartAt, `buildDoneAt=${buildDoneAt} fixStartAt=${fixStartAt}`);

  // the REAL execution trace
  check('the first test run REALLY FAILED (real node --test exit non-zero)', types.includes('TEST_FAILED'));
  check('the second test run REALLY PASSED', types.includes('TEST_COMPLETED'));
  const testCompleted = evts.filter((e) => e.type === 'TEST_COMPLETED');
  check('TEST_COMPLETED is corroborated by exit 0 + bytes', testCompleted.some((e) => e.data?.exitCode === 0 && Number(e.data?.bytes ?? 0) > 0));
  check('the fix round was grounded in the REAL failure output', llm.prompts.some((p) => /# COMMAND RESULTS/.test(p) && /BROWSER RESULTS/.test(p) === false && /add|AssertionError|failing/i.test(p)));

  // files on disk — the mission claimed them; verify independently
  const dirs = fs.readdirSync(COMMAND_WORKSPACE_ROOT).map((d) => path.join(COMMAND_WORKSPACE_ROOT, d));
  const ws = dirs.find((d) => fs.existsSync(path.join(d, 'api.test.js')));
  check('the app files really exist in the task workspace', Boolean(ws));
  const serverOnDisk = ws ? fs.readFileSync(path.join(ws, 'server.js'), 'utf8') : '';
  check('server.js on disk is the FIXED version (a + b)', /a \+ b/.test(serverOnDisk) && !/a - b/.test(serverOnDisk));
  check('index.html really exists', ws ? fs.existsSync(path.join(ws, 'public', 'index.html')) : false);

  // ZERO TRUST: this test re-runs the suite itself, fresh
  let rerunOk = false;
  let rerunOut = '';
  if (ws) {
    try { const r = await execFileAsync('node', ['--test', 'api.test.js'], { cwd: ws }); rerunOk = true; rerunOut = r.stdout; }
    catch (e) { rerunOk = false; rerunOut = String(e.stdout || e.stderr || e.message); }
  }
  check('INDEPENDENT re-run of the test suite passes (exit 0, fresh process)', rerunOk, rerunOut.slice(0, 200));
  check('independent re-run shows 2 passing tests', /2 passing|tests 2/i.test(rerunOut));

  check('mission verification passed with the real event record', m.verification?.verdict === 'pass');
  check('budget recorded honestly (items, failures, window)', typeof m.usage?.itemsCreated === 'number' && m.usage.failures === 0);
}

console.log('\n============================================================');
console.log(`B211 B4 LONG-HORIZON: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
