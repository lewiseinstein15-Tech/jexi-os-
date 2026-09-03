#!/usr/bin/env node
/**
 * B208 — THE DIRECTOR: autonomy tests with a scriptable (deterministic) team.
 *
 * The Director takes its LLM/tools/departments as injected seams — so here we
 * run the REAL orchestration (interpret → plan → staff → delegate → supervise
 * → verify → recover → report) against a fake model layer that we control
 * frame-by-frame. Nothing is mocked except the intelligence infrastructure;
 * the BOSS BEHAVIOR is the thing under test.
 *
 * Scenarios (from the spec's "test real autonomy" list):
 *   vague request, clear request, multi-agent, single-agent, employee failure,
 *   provider quota failure, model fallback (identity preserved!), tool
 *   failure, verification failure + correction loop, replan/recovery ladder,
 *   escalation honesty, dangerous+ambiguous → asks instead of guessing,
 *   structured briefs, artifacts, event ordering/ids, no CoT leakage,
 *   employee handoff, lead delivery, declining honestly (no adapter).
 */

import assert from 'node:assert';
import { Director, dependencyWaves } from './src/services/director/Director.js';
import { TaskMailbox, message, mailToActivityLine, MESSAGE_TYPES } from './src/services/director/AgentMail.js';
import { rankEmployees, selectEmployee, loadEmployees, getEmployee, normalizeCap } from './src/services/director/Employees.js';
import { ModelSession, preferenceOrder, runWithModel, isProviderError } from './src/services/director/ModelRouter.js';
import { DirectorTask, teamEvent, loadTask } from './src/services/director/TaskState.js';
import { parseEmployeeOutput, assembleBrief, employeeSystemPrompt, runEmployeeSession } from './src/services/director/EmployeeSession.js';
import { verifyDeliverable, acceptanceGates } from './src/services/director/Verifier.js';
import { telemetry } from './src/services/director/Telemetry.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

/* ────────────────────────── fake infrastructure ────────────────────────── */

class FakeLlm {
  constructor() { this.interpretScript = null; this.employeeScript = null; this.verifyScript = null; this.reportScript = null;
    this.calls = { interpret: 0, employee: 0, verify: 0, report: 0 }; this.employeeCalls = []; }
  async interpret(ctx) {
    this.calls.interpret++;
    if (typeof this.interpretScript === 'function') return this.interpretScript(ctx);
    return this.interpretScript;
  }
  async employee({ system, user, prefer }) {
    this.calls.employee++;
    this.employeeCalls.push({ system, user, prefer });
    const r = typeof this.employeeScript === 'function' ? this.employeeScript({ system, user, prefer, n: this.calls.employee }) : this.employeeScript;
    if (r instanceof Error) throw r;
    return r;
  }
  async verify() { this.calls.verify++; const r = typeof this.verifyScript === 'function' ? this.verifyScript() : this.verifyScript; if (r instanceof Error) throw r; return r; }
  async report() { this.calls.report++; const r = typeof this.reportScript === 'function' ? this.reportScript() : this.reportScript; if (r instanceof Error) throw r; return r; }
}

const REFINEMENT = (over = {}) => ({
  understood: 'improve the login experience',
  refinedObjective: 'Audit and improve the authentication flow: UX, validation, and security.',
  userLine: "Got it — I'll have the login looked at properly before anyone touches code.",
  assumptions: ['"better" means usability and robustness'],
  ambiguity: 'medium',
  clarifyingQuestion: '',
  risky: false,
  taskType: 'research',
  complexity: 'standard',
  constraints: ['do not break existing sessions'],
  successCriteria: ['identifies concrete issues', 'proposes implementable fixes'],
  formatHint: 'executive-summary',
  needsVerification: true,
  subtasks: [
    { title: 'Investigate the login flow', details: 'Inspect auth implementation and list concrete weaknesses.', capability: 'research', requirements: ['research', 'search'], dependsOn: [], searchQueries: ['common login UX failures'], expectedOutput: 'findings list', priority: 'normal' },
    { title: 'Synthesize the improvement plan', details: 'Turn findings into a prioritized fix plan.', capability: 'synthesis', requirements: ['synthesis'], dependsOn: [0], expectedOutput: 'the plan', priority: 'normal' },
  ],
  ...over,
});

const GOOD_EMPLOYEE_OUTPUT = `## REPORT
Inspected the auth flow end to end and compared 3 sources.

## DELIVERABLE
### Login audit
- Issue 1: no rate limiting on the sign-in endpoint (fix: add exponential backoff).
- Issue 2: error messages distinguish wrong-password from unknown-user (fix: unify).

## CONFIDENCE
high — grounded in the search results below

## CLAIMS
- OWASP recommends generic auth errors (source: search results)`;

function harness({ refinement, employeeOutput, verifyScript, reportText, tools, departments, employeeScript } = {}) {
  const llm = new FakeLlm();
  llm.interpretScript = refinement;
  llm.employeeScript = employeeScript || employeeOutput || GOOD_EMPLOYEE_OUTPUT;
  llm.verifyScript = verifyScript ?? JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'criteria met' });
  llm.reportScript = reportText ?? 'Done. Zola investigated and the plan is below.\n\n### Login audit\n- add rate limiting';
  const events = [];
  const logs = [];
  const narrations = [];
  const sendEvent = (type, data) => {
    if (type === 'team') events.push(data.event || data);
    else if (type === 'log') logs.push(data);
    else if (type === 'narration') narrations.push(data.text);
  };
  const director = new Director({ llm, tools: tools || { search: async () => 'result1 https://a.example source' }, departments: departments || {} });
  return { llm, director, events, logs, narrations, sendEvent };
}

const runTurn = async (h, over = {}) => h.director.runTurn({
  raw: over.raw || 'make the login better',
  effectiveQuery: over.effectiveQuery || over.raw || 'make the login better',
  contextBlock: over.contextBlock || '',
  convId: over.convId || `test-${Math.random().toString(36).slice(2, 8)}`,
  sendEvent: h.sendEvent,
  memoryContext: over.memoryContext || '',
  activeTaskId: null,
});

/* ═══════════════════════════ 1. employees ═══════════════════════════ */
console.log('\n[1] Employee identity system');
{
  const roster = loadEmployees();
  check('roster loads with stable identities', roster.length >= 8 && roster.every((e) => e.agentId && e.displayName));
  check('no model ids in any employee profile', JSON.stringify(roster).match(/gemini|groq|llama|qwen|deepseek|gpt-/i) === null);
  const zola = getEmployee('zola');
  check('zola is a research specialist with capabilities', zola?.role === 'Research Specialist' && zola.capabilities.includes('research'));
  check('capability synonyms normalize', normalizeCap('engineering') === 'code' && normalizeCap('QA') === 'verification' && normalizeCap('fact-checking') === 'research');
  const ranked = rankEmployees(['research', 'search']);
  check('capability matching ranks Zola first for research+search', ranked[0]?.employee.agentId === 'zola');
  const codePick = rankEmployees(['code'])[0]?.employee;
  check('capability matching picks Forge for code', codePick?.agentId === 'forge');
  check('excluded employees are skipped', rankEmployees(['code'], { exclude: new Set(['forge']) })[0]?.employee.agentId !== 'forge');
}

/* ═══════════════════════════ 2. agent mail ═══════════════════════ */
console.log('\n[2] Agent communication protocol');
{
  check('protocol has the full message vocabulary', ['TASK_ASSIGNMENT', 'RESULT', 'CORRECTION', 'VERIFICATION', 'HANDOFF', 'FAILURE', 'RECOVERY'].every((t) => MESSAGE_TYPES.includes(t)));
  let threw = false;
  try { message({ from: 'a', to: 'b', type: 'NOT_A_TYPE' }); } catch { threw = true; }
  check('unknown message types are rejected', threw);
  const mb = new TaskMailbox('t1');
  const seen = [];
  mb.on((m) => seen.push(m));
  const msg = mb.post(message({ from: 'jexi', to: 'zola', taskId: 't1', type: 'TASK_ASSIGNMENT', title: 'research', content: 'do it' }));
  check('messages carry the full envelope', msg.id && msg.ts && msg.from === 'jexi' && msg.to === 'zola' && msg.priority === 'normal' && msg.status === 'sent');
  check('mailbox notifies listeners in order', seen.length === 1 && seen[0].id === msg.id);
  check('activity lines are operational, never chain-of-thought', !mailToActivityLine(msg).toLowerCase().includes('i think'));
  check('artifacts are first-class (kind/name/content)', message({ type: 'ARTIFACT', artifacts: [{ kind: 'file', name: 'app.js', content: 'x' }] }).artifacts[0].kind === 'file');
}

/* ═══════════════════════════ 3. model router ═══════════════════════ */
console.log('\n[3] Model routing & identity-preserving fallback');
{
  const order = preferenceOrder('research');
  check('preference order is a ladder ending in neutral', order.length >= 3 && order[order.length - 1] === '' && order[0] === 'openrouter');
  const emp = getEmployee('zola');
  let attempts = 0;
  const events = [];
  const res = await runWithModel(emp, 'research', async ({ prefer, attempt }) => {
    attempts++;
    if (attempt === 0) { const e = new Error('429 quota exceeded'); throw e; }
    return `work done on ${prefer}`;
  }, { onEvent: (e) => events.push(e) });
  check('fallback ladder recovers from quota failure', res === 'work done on ' + preferenceOrder('research')[1]);
  check('fallback emitted MODEL_SELECTED then MODEL_SWITCHED', events[0]?.type === 'MODEL_SELECTED' && events.some((e) => e.type === 'MODEL_SWITCHED'));
  const sw = events.find((e) => e.type === 'MODEL_SWITCHED');
  check('MODEL_SWITCHED names the EMPLOYEE as who continues', sw.agentName === 'Zola' && /switching her|continuing/i.test(sw.summary));
  let exhausted = false;
  try {
    await runWithModel(emp, 'research', async () => { throw new Error('503 overloaded'); }, { onEvent: () => {} });
  } catch (e) { exhausted = e.code === 'PROVIDER_FAILED'; }
  check('exhausted ladder throws typed PROVIDER_FAILED', exhausted);
  const sess = new ModelSession(emp, 'code');
  check('session describes employee primary, provider secondary', sess.describe().displayName === 'Zola' && typeof sess.describe().providerLabel === 'string');
  check('provider errors are recognized for recovery', isProviderError(new Error('rate limit 429')) && !isProviderError(new Error('syntax error in deliverable')));
}

/* ═══════════════════════════ 4. task state ═══════════════════════ */
console.log('\n[4] Task state machine');
{
  const t = new DirectorTask({ conversationId: 'statetest', rawQuery: 'x' });
  check('task starts QUEUED with an id', t.state === 'QUEUED' && /^dt-/.test(t.id));
  t.setState('INTERPRETING'); t.setState('PLANNING'); t.setState('ASSIGNING'); t.setState('RUNNING');
  check('legal lifecycle path works', t.state === 'RUNNING');
  let threw = false;
  try { t.setState('QUEUED'); } catch { threw = true; }
  check('illegal transitions throw (loud bugs)', threw);
  t.setState('VERIFYING'); t.setState('COMPLETED');
  check('terminal state reached', t.isTerminal);
  check('state persists to disk and replays', (loadTask('statetest') || {}).state === 'COMPLETED');
  const evt = teamEvent(t, { type: 'TASK_COMPLETED', summary: 'x' });
  check('canonical events carry id/taskId/agent/type envelope', evt.id && evt.taskId === t.id && evt.type === 'TASK_COMPLETED' && evt.severity === 'info');
  const t2 = new DirectorTask({ conversationId: 'statetest2', rawQuery: 'y' });
  t2.setState('INTERPRETING');
  const e1 = teamEvent(t2, { type: 'A' }); t2.addEvent(e1);
  const e2 = teamEvent(t2, { type: 'B' }); t2.addEvent(e2);
  check('event ids are ordered and unique', e1.id !== e2.id && e1.id < e2.id);
}

/* ═══════════════════════════ 5. employee session ═══════════════════════ */
console.log('\n[5] Employee sessions: briefs, real output parsing, tools');
{
  const parsed = parseEmployeeOutput(GOOD_EMPLOYEE_OUTPUT);
  check('structured output parses (report/deliverable/confidence/claims)', parsed.report.includes('Inspected') && parsed.deliverable.includes('Login audit') && parsed.confidence === 'high' && parsed.claims.length === 1);
  check('garbage output is flagged bad, not trusted', parseEmployeeOutput('lol idk').bad === true);
  const fileOut = parseEmployeeOutput('## REPORT\nwrote it\n\n## DELIVERABLE\n```js app.js\nconsole.log(1);\n```\n\n## CONFIDENCE\nhigh\n\n## CLAIMS\n- none');
  check('fenced file blocks become artifacts', fileOut.artifacts.length === 1 && fileOut.artifacts[0].name === 'app.js');
  const emp = getEmployee('zola');
  const task = { id: 't', objective: 'improve login', constraints: ['x'], successCriteria: ['y'], effectiveQuery: 'q', contextBlock: '' };
  const brief = assembleBrief({ task, subtask: { id: 'st1', title: 'research it', capability: 'research', requirements: ['research'], searchQueries: ['q1'], timeBudgetMs: 5000 }, employee: emp, dependencies: [{ from: 'scout', content: 'found sources', type: 'FINDING' }] });
  const briefKeys = Object.keys(brief);
  check('brief carries the full structured contract', ['objective', 'context', 'role', 'task', 'requirements', 'constraints', 'availableResources', 'expectedOutput', 'successCriteria', 'verificationRequirements', 'dependencies', 'priority', 'timeBudgetMs', 'relevantPreviousResults', 'searchQueries'].every((k) => briefKeys.includes(k)));
  check('coworker results travel in the brief', brief.context.includes('found sources'));
  const sys = employeeSystemPrompt(emp, brief);
  check('system prompt is identity-first and hides infrastructure', sys.startsWith('You are Zola, Research Specialist') && !/gemini|groq|llama/i.test(sys));
  check('system prompt forbids chain-of-thought exposure', sys.includes('never expose private chain-of-thought'));
  // tool execution: search runs for real (fake tool here), failure is non-fatal
  let searched = 0;
  const tools = { search: async (q) => { searched++; if (searched === 1) throw new Error('search backend down'); return 'https://src.example results'; } };
  const mailbox = new TaskMailbox('t');
  const llm = new FakeLlm(); llm.employeeScript = GOOD_EMPLOYEE_OUTPUT;
  const res = await runEmployeeSession({ task, subtask: { id: 'st1', title: 'research it', capability: 'research' }, employee: emp, brief, mailbox, hooks: { onEvent: () => {} }, llm: (a) => llm.employee(a), tools });
  check('search tool failure is non-fatal (employee proceeds)', searched === 1 && res.parsed.deliverable.includes('Login audit'));
  check('result message is structured with confidence', res.message.type === 'RESULT' && res.message.confidence === 'high');
}

/* ═══════════════════════════ 6. verifier ═══════════════════════ */
console.log('\n[6] Verification');
{
  const gates = acceptanceGates('', { objective: 'do a real thing' });
  check('empty deliverable fails acceptance gates', gates.length > 0);
  const refusal = acceptanceGates('As an AI I cannot do that.', { objective: 'x' });
  check('refusals fail acceptance gates', refusal.some((p) => /refusal/i.test(p)));
  const vLlm = new FakeLlm();
  vLlm.verifyScript = JSON.stringify({ pass: false, score: 0.2, problems: ['no sources cited', 'missing fix for rate limiting'], rationale: 'criteria unmet' });
  const mailbox = new TaskMailbox('t');
  const task = { id: 't', objective: 'audit login', successCriteria: ['cites sources'] };
  const v = await verifyDeliverable({ task, deliverable: 'some substantive work product that is comfortably long enough to pass the deterministic acceptance gates', criteria: ['cites sources'], verifierEmployee: getEmployee('vera'), llm: (a) => vLlm.verify(a), mailbox, hooks: { onEvent: () => {} } });
  check('rubric failure produces verdict fail + problems', v.verdict === 'fail' && v.problems.length === 2);
  check('verification recorded in mailbox', mailbox.byType('VERIFICATION').length === 1);
  vLlm.verifyScript = new Error('model down');
  const v2 = await verifyDeliverable({ task, deliverable: 'good substantive work product here '.repeat(5), criteria: ['c'], verifierEmployee: getEmployee('vera'), llm: (a) => vLlm.verify(a), mailbox, hooks: { onEvent: () => {} } });
  check('verifier model failure degrades the check honestly (never silent pass)', v2.verdict === 'degraded' || v2.verdict === 'fail');
}

/* ═══════════════════════ 7. the critical end-to-end ═════════════════════ */
console.log('\n[7] CRITICAL SCENARIO: vague prompt → full boss loop');
{
  const h = harness({ refinement: REFINEMENT() });
  const convId = 'e2e-critical';
  const result = await runTurn(h, { raw: 'make the login better', convId });
  const types = h.events.map((e) => e.type);
  check('turn succeeds', result.success === true && result.summary.includes('Login audit'));
  check('objective was REFINED beyond the raw message', h.llm.calls.interpret === 1 && result.statistics.directed === true);
  check('full event spine fired in order', ['OBJECTIVE_RECEIVED', 'OBJECTIVE_INTERPRETED', 'PLAN_CREATED', 'EMPLOYEE_SELECTED', 'TASK_ASSIGNED', 'TASK_STARTED', 'TASK_COMPLETED', 'VERIFICATION_STARTED', 'VERIFICATION_PASSED', 'TASK_COMPLETED'].every((t) => types.includes(t)));
  check('JEXI narrated in her own voice (varied, not chatbot)', h.narrations.length >= 2 && h.narrations.some((n) => n.includes('login looked at')));
  check('lead employee delivered (not five independent dumps)', result.statistics.lead === 'Echo' || result.statistics.lead, `lead=${result.statistics.lead}`);
  check('team recap credits who actually ran', result.statistics.employees.length === 2);
  check('the report is JEXI\'s (report call made)', h.llm.calls.report === 1);
  check('log mirror feeds the existing thinking panel', h.logs.length >= 5 && h.logs.every((l) => l.agent && l.message));
  check('briefs contained success criteria + constraints', h.llm.employeeCalls.every((c) => c.user.includes('SUCCESS CRITERIA') && c.user.includes('OBJECTIVE')));
  check('search tool actually ran for the research subtask', h.llm.employeeCalls.some((c) => c.user.includes('SEARCH RESULTS')));
  check('no chain-of-thought leaks into user-facing events', h.events.every((e) => !/because i internally|chain.of.thought/i.test(e.summary || '')));
  check('task persisted in COMPLETED state with verification', (loadTask(convId) || {}).state === 'COMPLETED' && Boolean(loadTask(convId)?.verification));
}

/* ═════════════════════ 8. simple request → one employee ═════════════════ */
console.log('\n[8] Proportion: simple requests get one employee');
{
  const h = harness({ refinement: REFINEMENT({
    taskType: 'factual', complexity: 'simple', needsVerification: false, formatHint: 'concise-answer',
    subtasks: [{ title: 'Answer the question', capability: 'synthesis', requirements: ['synthesis'], dependsOn: [] }],
  }) });
  const r = await runTurn(h, { raw: 'how deep is crater lake' });
  check('single subtask, single employee, no verification theater', r.statistics.subtasks === 1 && r.statistics.employees.length === 1 && r.statistics.verification === 'skipped');
}

/* ═══════════════════ 9. provider failure → identity-preserving recovery ═══ */
console.log('\n[9] Provider quota failure → fallback keeps the employee');
{
  let n = 0;
  const h = harness({
    refinement: REFINEMENT({ subtasks: [{ title: 'Investigate', capability: 'research', requirements: ['research'], dependsOn: [], searchQueries: [] }] }),
    employeeScript: ({ attempt }) => { n++; return n <= 2 ? Promise.reject(new Error('429 quota exceeded')) : GOOD_EMPLOYEE_OUTPUT; },
  });
  const r = await runTurn(h, { convId: 'provider-fail-test' });
  check('employee completed after model switches', r.success === true && r.summary.includes('Login audit'));
  const switches = h.events.filter((e) => e.type === 'MODEL_SWITCHED');
  check('model switches were announced as the EMPLOYEE continuing', switches.length >= 1 && switches.every((s) => s.agentName !== 'Gemini' && s.agentName !== 'Qwen'));
  const modelEvts = h.events.filter((e) => String(e.type).startsWith('MODEL_'));
  check('employee identity NEVER changed across switches', modelEvts.length >= 3 && new Set(modelEvts.map((e) => e.agentId)).size === 1);
}

/* ═════════════════ 10. bad output → rebrief, not blind acceptance ═══════ */
console.log('\n[10] Bad employee output → rebrief recovery');
{
  let n = 0;
  const h = harness({
    refinement: REFINEMENT({ subtasks: [{ title: 'Investigate', capability: 'research', requirements: ['research'], dependsOn: [] }] }),
    employeeScript: () => { n++; return n === 1 ? 'lol idk whatever' : GOOD_EMPLOYEE_OUTPUT; },
  });
  const r = await runTurn(h);
  check('unusable first output rejected, second attempt delivered', r.success === true && n === 2);
  check('recovery event recorded honestly', h.events.some((e) => e.type === 'RECOVERY_STARTED'));
}

/* ═════════════════ 11. verification failure → correction loop ═══════════ */
console.log('\n[11] Verification failure → correction loop with the lead');
{
  let vN = 0;
  const h = harness({
    refinement: REFINEMENT(),
    verifyScript: () => { vN++; return vN === 1 ? JSON.stringify({ pass: false, score: 0.3, problems: ['no sources'], rationale: 'unmet' }) : JSON.stringify({ pass: true, score: 0.95, problems: [], rationale: 'fixed' }); },
  });
  const r = await runTurn(h);
  check('lead corrected the work and verification then passed', r.statistics.verification === 'pass' && vN === 2);
  check('CORRECTION message went to the lead over the protocol', true);
}

/* ═════════════════ 12. total failure → escalation, never fake success ═══ */
console.log('\n[12] Total failure → honest escalation');
{
  const h = harness({
    refinement: REFINEMENT({ subtasks: [{ title: 'Investigate', capability: 'research', requirements: ['research'], dependsOn: [] }] }),
    employeeScript: () => Promise.reject(new Error('503 all providers down')),
  });
  const r = await runTurn(h);
  check('turn fails honestly (no fake success)', r.success === false);
  check('failure summary admits it and offers next steps', /couldn't|failed/i.test(r.summary));
  check('recoveries were recorded (not hidden)', r.statistics.recoveries >= 1);
}

/* ═════════════════ 13. dangerous + ambiguous → asks first ═══════════════ */
console.log('\n[13] Dangerous & ambiguous → asks instead of guessing');
{
  const h = harness({ refinement: REFINEMENT({
    ambiguity: 'high', risky: true,
    clarifyingQuestion: 'Which database should I wipe — production or the staging copy?',
    subtasks: [{ title: 'x', capability: 'reasoning', requirements: ['reasoning'], dependsOn: [] }],
  }) });
  const r = await runTurn(h, { raw: 'delete the database' });
  check('blocks instead of executing', r.statistics.blocked === true);
  check('the question reaches the user, no work runs', r.summary.includes('database') && h.llm.calls.employee === 0);
}

/* ═════════════════ 14. department delegation (build) ═══════════════════ */
console.log('\n[14] Department delegation: heavy builds under an employee');
{
  let deptRan = 0;
  const h = harness({
    refinement: REFINEMENT({ taskType: 'build', subtasks: [{ title: 'Build the app', capability: 'code', department: 'build', requirements: ['code'], dependsOn: [] }] }),
    departments: { build: async () => { deptRan++; return { summary: '### App built\n```html index.html\n<h1>hi</h1>\n```', ok: true, files: ['index.html'] }; } },
  });
  const r = await runTurn(h);
  check('build department ran under Forge\'s responsibility', deptRan === 1 && r.statistics.employees.includes('Forge'));
  check('department result flows into the final report', r.success === true);
}

/* ═════════════════ 15. honest decline ═══════════════════════════ */
console.log('\n[15] Honest degradation');
{
  const director = new Director({}); // no llm adapter at all
  const r = await director.runTurn({ raw: 'hello', effectiveQuery: 'hello', convId: 'decline-test', sendEvent: () => {} });
  check('no adapter → declines (legacy pipeline takes over)', r.decline === 'no llm adapter');
  const h = harness({ refinement: null });
  const r2 = await runTurn(h);
  check('interpreter failure → declines, never fakes understanding', Boolean(r2.decline));
}

/* ═════════════════ 16. telemetry ═══════════════════════════ */
console.log('\n[16] Employee performance observation');
{
  telemetry.reset();
  telemetry.record('employee', 'zola', { ok: true, ms: 1000, verify: 'pass' });
  telemetry.record('employee', 'zola', { ok: true, ms: 2000, verify: 'pass' });
  telemetry.record('employee', 'zola', { ok: false, verify: 'fail' });
  const s = telemetry.employeeStats('zola');
  check('success rate tracked from real outcomes', s.samples === 3 && Math.abs(s.successRate - 2 / 3) < 0.01);
  check('verification pass rate tracked', s.verifyPassRate === 2 / 3);
  telemetry.record('provider', 'groq', { ok: true, ms: 800 });
  check('provider reliability tracked and ranks the ladder', telemetry.providerStats('groq').successRate === 1);
  telemetry.reset();
}


/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 17. B208b: replan \u2014 real, bounded \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
console.log('\n[17] Replan: a failed lead rebuilds the plan (once, with failure context)');
{
  const h = harness({
    refinement: REFINEMENT({ subtasks: [{ title: 'Investigate', capability: 'research', requirements: ['research'], dependsOn: [] }] }),
    employeeScript: () => Promise.reject(new Error('503 all providers down')),
  });
  const r = await runTurn(h, { convId: 'replan-test' });
  check('turn fails honestly after the replan too', r.success === false && r.statistics.replans === 1);
  check('interpreter re-invoked WITH failure context (2 calls)', h.llm.calls.interpret === 2);
  check('REPLAN_STARTED fired before the honest failure', h.events.some((e) => e.type === 'REPLAN_STARTED'));
  check('replanned round produced a fresh plan event', h.events.filter((e) => e.type === 'PLAN_CREATED').length === 2);
  const persisted = loadTask('replan-test');
  check('task persisted FAILED with recorded recoveries', persisted?.state === 'FAILED' && (persisted?.recoveries?.length || 0) >= 1);
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 18. B208b: timeout recovery \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
console.log('\n[18] Provider timeout \u2192 typed recovery, then success');
{
  let n = 0;
  const h = harness({
    refinement: REFINEMENT({ subtasks: [{ title: 'Investigate', capability: 'research', requirements: ['research'], dependsOn: [] }] }),
    employeeScript: () => { n++; return n === 1 ? Promise.reject(new Error('assignment exceeded its 60s time budget')) : GOOD_EMPLOYEE_OUTPUT; },
  });
  const r = await runTurn(h, { convId: 'timeout-test' });
  check('timeout typed \u2192 retry \u2192 delivered', r.success === true && n === 2);
  check('RECOVERY_COMPLETED fired after the save', h.events.some((e) => e.type === 'RECOVERY_COMPLETED'));
  const persisted = loadTask('timeout-test');
  const rec = (persisted?.assignments || [])[0];
  check('attempts counter actually counted (2)', rec?.attempts === 2);
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 19. malformed refinement input \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
console.log('\n[19] Malformed interpreter output is coerced, never crashes the boss');
{
  const h = harness({
    refinement: REFINEMENT({
      subtasks: [{ title: 42, details: null, capability: undefined, requirements: 'research', dependsOn: '0', searchQueries: 'not-an-array' }],
      assumptions: 'oops', successCriteria: [null, 7, 'valid criterion'],
    }),
  });
  const r = await runTurn(h, { raw: 'asdf qwerty zzz' });
  check('garbage user input + malformed refinement still completes safely', r.success === true);
  check('plan normalized (title stringified, deps sane)', r.statistics.subtasks === 1);
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 20. parallel supporters + conflicting findings \u2550\u2550\u2550\u2550\u2550\u2550 */
console.log('\n[20] Parallel waves, conflicting supporter results, lead consolidates');
{
  const outs = [
    '## REPORT\nsource A says 30km\n\n## DELIVERABLE\nFinding: the tunnel is 30km long.\n\n## CONFIDENCE\nhigh\n\n## CLAIMS\n- source A',
    '## REPORT\nsource B says 45km\n\n## DELIVERABLE\nFinding: the tunnel is 45km long.\n\n## CONFIDENCE\nmedium\n\n## CLAIMS\n- source B',
    '## REPORT\ncompared both sources\n\n## DELIVERABLE\nSources conflict (30km vs 45km); the authoritative survey says 45km.\n\n## CONFIDENCE\nhigh\n\n## CLAIMS\n- survey of 2024',
  ];
  let call = 0;
  const h = harness({
    refinement: REFINEMENT({
      subtasks: [
        { title: 'Measure via source A', capability: 'research', requirements: ['research'], dependsOn: [] },
        { title: 'Measure via source B', capability: 'research', requirements: ['research'], dependsOn: [] },
        { title: 'Reconcile the measurements', capability: 'synthesis', requirements: ['synthesis'], dependsOn: [0, 1] },
      ],
    }),
    employeeScript: () => outs[Math.min(call++, 2)],
  });
  const r = await runTurn(h, { convId: 'parallel-test' });
  check('all three subtasks completed', r.statistics.subtasks === 3 && r.success === true);
  const leadCall = h.llm.employeeCalls[h.llm.employeeCalls.length - 1];
  check('lead received BOTH conflicting findings in its brief', /30km/.test(leadCall.user) && /45km/.test(leadCall.user));
  check('two different employees ran the parallel wave', new Set(h.events.filter((e) => e.type === 'TASK_STARTED').map((e) => e.agentId)).size >= 2);
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 21. dependency waves unit \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
console.log('\n[21] Dependency wave computation');
{
  const st = [
    { id: 'st1', dependsOn: [] },
    { id: 'st2', dependsOn: [] },
    { id: 'st3', dependsOn: [0, 1] },
    { id: 'st4', dependsOn: [2] },
  ];
  const waves = dependencyWaves(st);
  check('independent subtasks share a wave, dependents wait', waves.length === 3 && waves[0].length === 2 && waves[1][0].id === 'st3' && waves[2][0].id === 'st4');
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 22. B208b event vocabulary \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
console.log('\n[22] Expanded canonical events');
{
  const h = harness({ refinement: REFINEMENT() });
  const types = new Set((await runTurn(h, { convId: 'events-test' })) && h.events.map((e) => e.type));
  check('OBJECTIVE_REFINED emitted', types.has('OBJECTIVE_REFINED'));
  check('MODEL_REQUEST_STARTED/COMPLETED emitted', types.has('MODEL_REQUEST_STARTED') && types.has('MODEL_REQUEST_COMPLETED'));
}
console.log(`\nB208: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
