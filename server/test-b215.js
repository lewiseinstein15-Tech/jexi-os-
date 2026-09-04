/**
 * B215 — STRUCTURED OBJECTIVE STATE + WORLD STATE
 *
 * §1 ObjectiveInterpreter — provenance-tagged objective state (pure unit)
 * §2 Director integration — structured objective lands on the task + event + disk
 * §3 WorldState — honest empty world, real records, persistence, bounds
 * §4 EmployeeSession→WorldState seam — a REAL command round lands in the world record
 *
 * Run: node test-b215.js   (no network, no keys — the LLM seams are scripted,
 * the COMMAND in §4 really executes via CommandRunner, allowlisted)
 */

import fs from 'fs';
import path from 'path';
import { structureObjective, significantTokens, provenanceOf, objectiveProvenanceSummary } from './src/services/director/ObjectiveInterpreter.js';
import { WorldState, loadWorldState, runtimeCapabilities, globalWorld } from './src/services/director/WorldState.js';
import { Director } from './src/services/director/Director.js';
import { DirectorTask, loadTask } from './src/services/director/TaskState.js';
import { TaskMailbox } from './src/services/director/AgentMail.js';
import { getEmployee } from './src/services/director/Employees.js';
import { assembleBrief, runEmployeeSession } from './src/services/director/EmployeeSession.js';
import { taskCommandDir } from './src/services/director/CommandRunner.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const NL = String.fromCharCode(10);

/* ────────────────────────── scripted infrastructure ────────────────────── */

class FakeLlm {
  constructor() { this.interpretScript = null; this.employeeScript = null; this.verifyScript = null; this.reportScript = null; this.calls = { interpret: 0, employee: 0, verify: 0, report: 0 }; }
  async interpret() { this.calls.interpret++; const r = typeof this.interpretScript === 'function' ? this.interpretScript() : this.interpretScript; return r; }
  async employee(...a) { this.calls.employee++; const r = typeof this.employeeScript === 'function' ? this.employeeScript({ ...a[0], n: this.calls.employee }) : this.employeeScript; return r; }
  async verify() { this.calls.verify++; return this.verifyScript; }
  async report() { this.calls.report++; return this.reportScript; }
}

const REFINEMENT = (over = {}) => ({
  understood: 'build a postgres-backed todo api',
  refinedObjective: 'Build a small REST todo API backed by PostgreSQL with tests.',
  desiredOutcome: 'A running todo API the user can deploy, with data in PostgreSQL.',
  userLine: "On it — I'll build the todo API on PostgreSQL.",
  assumptions: ['REST (not GraphQL) since the user said API'],
  unknowns: ['hosting target for the database (local vs managed)'],
  requiredArtifacts: ['todo-server (runnable project)', 'README with run instructions'],
  ambiguity: 'low', clarifyingQuestion: '', risky: false,
  taskType: 'build', complexity: 'standard',
  constraints: ['use PostgreSQL', 'keep the code maintainable'],
  successCriteria: ['API stores todos in PostgreSQL', 'tests pass with exit 0'],
  formatHint: 'code + instructions', needsVerification: true,
  subtasks: [{ title: 'build it', details: 'build the api', capability: 'code', requirements: ['code'], dependsOn: [], expectedOutput: 'runnable project', priority: 'normal', department: 'build' }],
  ...over,
});

/* ═══════════════════ 1. ObjectiveInterpreter (pure) ══════════════════════ */

console.log('\n[1] ObjectiveInterpreter — provenance-tagged structured objective');
{
  const raw = 'build me a todo api, use PostgreSQL, and it must have tests that pass';
  const so = structureObjective(REFINEMENT(), raw);

  check('objective carried through', so.objective.includes('todo API'));
  check('desiredOutcome uses the lane-provided text', so.desiredOutcome.text.includes('deploy') && so.desiredOutcome.provenance === 'INFERRED');
  check('verbatim constraint → USER_STATED', so.constraints.find((c) => c.text === 'use PostgreSQL')?.provenance === 'USER_STATED');
  check('interpreted constraint → INFERRED', so.constraints.find((c) => c.text === 'keep the code maintainable')?.provenance === 'INFERRED');
  check('verbatim criterion → USER_STATED', so.successCriteria.find((c) => c.text.includes('tests pass'))?.provenance === 'USER_STATED');
  check('requirements split by provenance',
    so.requirements.userStated.some((r) => r.includes('PostgreSQL')) && so.requirements.inferred.some((r) => r.includes('maintainable')));
  check('assumptions tagged ASSUMED', so.assumptions.length === 1 && so.assumptions[0].provenance === 'ASSUMED');
  check('unknowns tagged UNKNOWN (lane-provided only)', so.unknowns.length === 1 && so.unknowns[0].provenance === 'UNKNOWN' && so.unknowns[0].text.includes('hosting'));
  check('requiredCapabilities derived from the real subtasks', so.requiredCapabilities.includes('code') && so.requiredCapabilities.includes('dept:build'));
  check('requiredArtifacts passed through', so.requiredArtifacts.some((a) => a.includes('README')));
  check('provenanceCounts consistent with lists',
    so.provenanceCounts.USER_STATED === so.requirements.userStated.length
    && so.provenanceCounts.ASSUMED === so.assumptions.length
    && so.provenanceCounts.UNKNOWN === so.unknowns.length);
  check('laneProvided flags all true for the B215 schema', so.laneProvided.desiredOutcome && so.laneProvided.unknowns && so.laneProvided.requiredArtifacts);
  check('summary line is compact and honest', /user-stated · \d+ inferred/.test(objectiveProvenanceSummary(so)));

  // graceful degradation: OLD schema (pre-B215 lanes) still structures honestly
  const old = REFINEMENT();
  delete old.desiredOutcome; delete old.unknowns; delete old.requiredArtifacts;
  const soOld = structureObjective(old, raw);
  check('old-schema refinement degrades: desiredOutcome falls back INFERRED', soOld.desiredOutcome.provenance === 'INFERRED' && soOld.desiredOutcome.text.includes('todo API'));
  check('old-schema refinement degrades: unknowns EMPTY, never fabricated', soOld.unknowns.length === 0);
  check('old-schema refinement degrades: artifacts empty, never guessed', soOld.requiredArtifacts.length === 0);
  check('old-schema laneProvided flags honest (all false)', !soOld.laneProvided.desiredOutcome && !soOld.laneProvided.unknowns && !soOld.laneProvided.requiredArtifacts);

  // tokenizer
  check('significantTokens strips stopwords + punctuation', JSON.stringify(significantTokens('The quick, brown fox!')) === JSON.stringify(['quick', 'brown', 'fox']));
  check('provenanceOf conservative default is INFERRED', provenanceOf('completely unrelated wording', new Set(['other', 'words'])) === 'INFERRED');
  check('structureObjective survives null refinement without throwing', structureObjective(null, 'x').objective === '');
}

/* ═══════════════════ 2. Director integration ═════════════════════════════ */

console.log('\n[2] Director integration — structured objective on the task + event + disk');
{
  const llm = new FakeLlm();
  llm.interpretScript = REFINEMENT();
  llm.employeeScript = ['## REPORT', 'Built it.', '', '## DELIVERABLE', 'Runnable todo API scaffold.', '', '## CONFIDENCE', 'high'].join(NL);
  llm.verifyScript = JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'ok' });
  llm.reportScript = 'Done — todo API built and verified.';
  const events = [];
  const director = new Director({ llm, tools: { search: async () => 'source' }, departments: {} });
  const res = await director.runTurn({
    raw: 'build me a todo api, use PostgreSQL, and it must have tests that pass',
    effectiveQuery: 'build me a todo api, use PostgreSQL, and it must have tests that pass',
    contextBlock: '', convId: `b215-${Math.random().toString(36).slice(2, 8)}`,
    sendEvent: (t, d) => { if (t === 'team') events.push(d.event || d); },
    memoryContext: '', activeTaskId: null,
  });

  check('turn completed', Boolean(res && res.summary));
  const interpreted = events.find((e) => e.type === 'OBJECTIVE_INTERPRETED');
  check('OBJECTIVE_INTERPRETED event carries provenance counts', interpreted?.data?.provenance?.USER_STATED >= 1);

  // the structured state persisted with the task record (survives reconnect)
  const taskFiles = fs.readdirSync(path.join('data', 'director-tasks')).filter((f) => f.endsWith('.json'));
  let persisted = null;
  for (const f of taskFiles) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join('data', 'director-tasks', f), 'utf8'));
      if (rec.structuredObjective && rec.structuredObjective.objective.includes('todo API')) { persisted = rec; break; }
    } catch { /* skip */ }
  }
  check('structuredObjective PERSISTED with the task record (disk)', Boolean(persisted));
  check('persisted provenance tags intact', persisted?.structuredObjective?.constraints?.some((c) => c.provenance === 'USER_STATED' && c.text === 'use PostgreSQL'));
}

/* ═══════════════════ 3. WorldState ═══════════════════════════════════════ */

console.log('\n[3] WorldState — honest empty world, real records, persistence, bounds');
{
  const ownerId = `b215-world-${Date.now()}`;
  const w = new WorldState(ownerId);

  check('fresh world reports EMPTY honestly', w.summaryBlock().includes('No prior environment activity recorded'));
  check('fresh snapshot has zero processes/files/repos', w.snapshot().processes.length === 0 && w.snapshot().files.length === 0 && w.snapshot().repos.length === 0);

  w.recordCommand({ command: 'node analysis.js', ok: true, exitCode: 0, ms: 42, workspaceFiles: [{ path: 'analysis.js', bytes: 120, mtime: 'now' }] });
  w.recordCommand({ command: 'node analysis.js', ok: true, exitCode: 0, ms: 41, workspaceFiles: [{ path: 'analysis.js', bytes: 122, mtime: 'now2' }, { path: 'out.txt', bytes: 9, mtime: 'now2' }] });
  check('commands recorded as processes', w.snapshot().processes.length === 2 && w.snapshot().processes[0].command === 'node analysis.js');
  check('workspace files observed and DEDUPED by path (latest wins)', w.snapshot().files.length === 2 && w.snapshot().files.find((f) => f.path === 'analysis.js').bytes === 122);

  w.recordBrowser({ available: false, ok: false, blockedReason: 'JEXI_NO_BROWSER=1 (slim image)' });
  check('browser BLOCKED recorded with the real reason', w.snapshot().browser.available === false && w.snapshot().browser.blockedReason.includes('slim image'));

  w.recordPublish({ repo: 'lewiseinstein15-Tech/jexi-workspace', slug: 'demo', url: 'https://x/example/', live: true });
  check('publish recorded', w.snapshot().repos.length === 1 && w.snapshot().repos[0].slug === 'demo');

  w.recordNetwork({ ok: true, detail: 'pages live' });
  check('network observation recorded', w.snapshot().network.ok === true);

  const block = w.summaryBlock();
  check('summary block lists only REAL entries', block.includes('node analysis.js') && block.includes('unavailable') && block.includes('demo'));

  // persistence round-trip: a NEW instance for the same owner reloads from disk
  const w2 = new WorldState(ownerId);
  check('world state PERSISTS and reloads (atomic write round-trip)', w2.snapshot().processes.length === 2 && w2.snapshot().repos[0].slug === 'demo' && w2.snapshot().browser.blockedReason.includes('slim image'));
  check('seq advances on every record', w2.snapshot().seq >= 5);

  // bounds: lists are capped, never unbounded growth
  const bounded = new WorldState(`b215-bounds-${Date.now()}`);
  for (let i = 0; i < 250; i++) bounded.recordCommand({ command: `echo ${i}`, ok: true, exitCode: 0 });
  check('process records bounded at cap (60)', bounded.snapshot().processes.length === 60);

  // runtime capabilities: real env switch, no faked browser
  const prev = process.env.JEXI_NO_BROWSER;
  process.env.JEXI_NO_BROWSER = '1';
  const capsOff = runtimeCapabilities();
  process.env.JEXI_NO_BROWSER = '';
  const capsOn = runtimeCapabilities();
  if (prev !== undefined) process.env.JEXI_NO_BROWSER = prev; else delete process.env.JEXI_NO_BROWSER;
  check('runtimeCapabilities: browser honestly BLOCKED under JEXI_NO_BROWSER=1', capsOff.browser.available === false && /never faked/.test(capsOff.browser.reason || ''));
  check('runtimeCapabilities: browser available when the flag is off', capsOn.browser.available === true);
  check('runtimeCapabilities: real node version + command allowlist', capsOff.shell.allowlist.includes('node') && capsOff.node.startsWith('v'));

  // global world singleton
  const g = globalWorld();
  g.recordNetwork({ ok: true, detail: 'b215 test' });
  check('global world is a singleton that persists', globalWorld().snapshot().network.detail === 'b215 test');
}

/* ═══════════════ 4. EmployeeSession→WorldState seam (REAL execution) ═════ */

console.log('\n[4] EmployeeSession seam — a REAL command round lands in the world record');
{
  const task = new DirectorTask({ conversationId: 'b215-seam', rawQuery: 'write and run a script' });
  task.workspaceId = `b215-seam-mission-${Date.now()}`; // mission-shared workspace (the MissionRunner pattern)
  const forge = getEmployee('forge');
  check('forge carries the run-command tool', forge.supportedTools.includes('run-command'));

  const brief = assembleBrief({
    task,
    subtask: { id: 'st1', title: 'compute 6*7', capability: 'code', requirements: ['code'], timeBudgetMs: 30000 },
    employee: forge,
  });

  // the employee writes a file then REALLY runs it (CommandRunner executes `node calc.js`)
  const round1 = ['## REPORT', 'Writing and running the script.', '', '## DELIVERABLE', 'See execution.', '', '```js calc.js', 'const fs = require("fs");', 'fs.writeFileSync("result.txt", String(6 * 7));', 'console.log("sum is", 6 * 7);', '```', '', '```run', 'node calc.js', '```', '', '## CONFIDENCE', 'medium'].join(NL);
  const final = ['## REPORT', 'Ran it — the real output was 42.', '', '## DELIVERABLE', 'calc.js computes 6*7 = 42 (verified by execution: exit 0).', '', '## CONFIDENCE', 'high'].join(NL);
  const llm = new FakeLlm();
  llm.employeeScript = ({ n }) => (n === 1 ? round1 : final);
  llm.verifyScript = JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'ok' });

  const sessionEvents = [];
  await runEmployeeSession({
    task,
    subtask: { id: 'st1', title: 'compute 6*7', capability: 'code', requirements: ['code'] },
    employee: forge, brief, mailbox: new TaskMailbox('t'),
    hooks: { onEvent: (e) => sessionEvents.push(e) },
    llm: (a) => llm.employee(a), tools: null,
  });

  check('the command REALLY executed (COMMAND_COMPLETED event)', sessionEvents.some((e) => e.type === 'COMMAND_COMPLETED'));

  const world = loadWorldState(task.workspaceId);
  const snap = world.snapshot();
  check('world recorded the real process under the MISSION id', snap.processes.some((p) => p.command === 'node calc.js' && p.exitCode === 0));
  check('world observed the real workspace files (calc.js + result.txt)', snap.files.some((f) => f.path === 'calc.js') && snap.files.some((f) => f.path === 'result.txt'));
  check('world summary names the real command + files', world.summaryBlock().includes('node calc.js') && world.summaryBlock().includes('result.txt'));

  // cleanup the real workspace artifacts this test created
  try { fs.rmSync(taskCommandDir(task.workspaceId), { recursive: true, force: true }); } catch { /* best effort */ }
}

/* ═════════════════════════════ result ═══════════════════════════════════ */

console.log(`${NL}============================================================`);
console.log(`B215: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
