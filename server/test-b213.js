#!/usr/bin/env node
/**
 * B213 — METHOD PROVENANCE: employees must not claim methods they never ran.
 *
 * Found by the first live production missions (B212 E2E): replan/verification
 * items described methods that never executed ("headless_browser",
 * "real_browser") — Vera caught the incoherence, but a verifier that only
 * sees the deliverable can be misled by internally-consistent fabricated
 * evidence. B213 closes that:
 *
 * 1. GATE 1.6 (deterministic): browser-method claims require real
 *    COMPUTER_ACT/COMPUTER_OBSERVE events in the task record. The model
 *    cannot override it.
 * 2. GROUNDED RUBRIC: the verification prompt now carries WHAT ACTUALLY
 *    EXECUTED, so claims are checked against evidence, not just coherence.
 * 3. EMPLOYEE RULE: the brief tells employees to report only methods they
 *    actually executed.
 */

process.env.DATA_DIR = './data/test-b213';

const { verifyDeliverable, claimsBrowserMethod, executionEvidence } = await import('./src/services/director/Verifier.js');
const { DirectorTask } = await import('./src/services/director/TaskState.js');
const { TaskMailbox } = await import('./src/services/director/AgentMail.js');
const { getEmployee } = await import('./src/services/director/Employees.js');
const { assembleBrief } = await import('./src/services/director/EmployeeSession.js');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('\n== 1. claimsBrowserMethod: positive claims vs honest negations ==');
{
  const claims = [
    ['"method": "headless_browser", "page_title": "Example Domain"', 'json method field'],
    ['"method": "real_browser", "sanitized_links": ["More information..."]', 'json real_browser'],
    ['I opened the page in the browser and captured the title.', 'opened in the browser'],
    ['We used a headless browser to render the DOM and extract the link text.', 'headless browser render'],
    ['Used playwright to screenshot the page for verification.', 'playwright'],
    ['The page was loaded via a browser session and the title read from it.', 'browser session'],
    ['observed it with a real browser', 'real browser observation'],
  ];
  for (const [text, why] of claims) check(`claims: ${why}`, claimsBrowserMethod(text) === true);

  const honest = [
    ['browser: unavailable in this environment — used a server-side fetch instead', 'unavailable + fetch fallback'],
    ['No real browser is available here, so the HTML was fetched server-side.', 'no real browser'],
    ['Without a browser we could not screenshot; the fetch is honest fallback.', 'without a browser'],
    ['Browser control disabled on this host (JEXI_NO_BROWSER=1).', 'the blocked message itself'],
    ['The browser was blocked, so no browsing happened — reporting from the fetch.', 'blocked, no browsing'],
    ['We fetched the HTML with node and parsed the <title> and <a> text.', 'plain fetch, no browser word'],
    ['', 'empty text'],
  ];
  for (const [text, why] of honest) check(`honest: ${why}`, claimsBrowserMethod(text) === false, JSON.stringify(text).slice(0, 60));
}

console.log('\n== 2. Gate 1.6: fabricated browser methods FAIL deterministically ==');
{
  // The exact fabrication shape from the live prod run (replan items).
  const fabricated = `## Headless Browser Execution with DOM Validation
\`\`\`javascript
{ "method": "headless_browser", "page_title": "Example Domain", "first_visible_link_text": "This site is for test purposes only." }
\`\`\`
The headless browser loaded the page and the DOM was validated directly.`;

  const task = new DirectorTask({ conversationId: 'b213-1', rawQuery: 'q', objective: 'report the title and link text of example.com', successCriteria: ['exact title', 'exact link text'] });
  task.events.push({ id: 'e1', type: 'OBJECTIVE_RECEIVED' }); // events exist — but NO browser events
  const v = await verifyDeliverable({
    task, deliverable: fabricated, criteria: ['exact title', 'exact link text'],
    verifierEmployee: getEmployee('vera'),
    llm: async () => JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'looks fine' }),
    mailbox: new TaskMailbox('b213-1'), hooks: {},
  });
  check('fabricated headless-browser method FAILS (even though the model said pass)', v.verdict === 'fail' && v.problems.some((p) => /fabricated method/i.test(p)));
  check('the problem names the truth: NO browser action ever executed', v.problems.some((p) => /no browser action ever executed/i.test(p)));

  // Same claim WITH real browser evidence → the method claim is corroborated
  // (the gate stays silent; other criteria decide).
  const task2 = new DirectorTask({ conversationId: 'b213-2', rawQuery: 'q', objective: 'report the title and link text of example.com', successCriteria: ['exact title'] });
  task2.events.push(
    { id: 'e1', type: 'COMPUTER_ACT', summary: 'Atlas → open https://example.com', data: { action: 'goto', url: 'https://example.com' } },
    { id: 'e2', type: 'COMPUTER_OBSERVE', summary: 'Observed the page: 1 interactive element(s), 220 chars of text.', data: { title: 'Example Domain', elementCount: 1, textChars: 220 } },
  );
  const v2 = await verifyDeliverable({
    task: task2, deliverable: `## Report
I opened the page in the browser and read the title "Example Domain" and the link text "More information...". The browser observation confirms both values.`, criteria: ['exact title'],
    verifierEmployee: getEmployee('vera'),
    llm: async () => JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'corroborated' }),
    mailbox: new TaskMailbox('b213-2'), hooks: {},
  });
  check('corroborated browser claim (real COMPUTER_ACT/OBSERVE) passes the gate', !v2.problems.some((p) => /fabricated method/i.test(p)));

  // Honest fallback reporting must NOT be punished.
  const task3 = new DirectorTask({ conversationId: 'b213-3', rawQuery: 'q', objective: 'report the title and link text of example.com', successCriteria: ['exact title'] });
  task3.events.push({ id: 'e1', type: 'COMPUTER_BLOCKED', summary: 'Browser action blocked: Browser control disabled on this host (JEXI_NO_BROWSER=1).', data: { provider: 'remote' } });
  const v3 = await verifyDeliverable({
    task: task3, deliverable: `## Report
The browser was blocked on this host, so no browsing happened. We fetched the HTML server-side instead: title "Example Domain", link text "More information...". Source: server-side fetch.`, criteria: ['exact title'],
    verifierEmployee: getEmployee('vera'),
    llm: async () => JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'honest fallback' }),
    mailbox: new TaskMailbox('b213-3'), hooks: {},
  });
  check('honest "browser blocked, fetched instead" report is NOT flagged', !v3.problems.some((p) => /fabricated method/i.test(p)));
}

console.log('\n== 3. Grounded rubric: Vera sees WHAT ACTUALLY EXECUTED ==');
{
  let seenPrompt = '';
  const task = new DirectorTask({ conversationId: 'b213-4', rawQuery: 'q', objective: 'report the title and link text of example.com', successCriteria: ['exact title'] });
  task.events.push(
    { id: 'e1', type: 'COMPUTER_BLOCKED', summary: 'Browser action blocked: Browser control disabled on this host (JEXI_NO_BROWSER=1) — computer use is honestly unavailable, never faked.', data: {} },
    { id: 'e2', type: 'COMMAND_COMPLETED', summary: '`node fetch.js` → exit 0 in 412ms.', data: { command: 'node fetch.js', exitCode: 0, ms: 412 } },
    { id: 'e3', type: 'FILE_CREATED', summary: 'Created fetch.js (140 bytes).', data: { name: 'fetch.js' } },
  );
  await verifyDeliverable({
    task, deliverable: 'A deliverable long enough to pass the length gate and claiming the work was done via a server-side fetch, honestly reporting the browser was unavailable.', criteria: ['exact title'],
    verifierEmployee: getEmployee('vera'),
    llm: async (a) => { seenPrompt = `${a.system}\n${a.user}`; return JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'grounded' }); },
    mailbox: new TaskMailbox('b213-4'), hooks: {},
  });
  check('the rubric prompt carries the evidence section', /WHAT ACTUALLY EXECUTED/i.test(seenPrompt));
  check('the evidence states the browser was BLOCKED with the true reason', /browser: BLOCKED/i.test(seenPrompt) && /JEXI_NO_BROWSER/i.test(seenPrompt));
  check('the evidence lists the real command that ran', /node fetch\.js/.test(seenPrompt));
  check('the prompt instructs: contradictions with evidence are fabrication', /contradicts the execution evidence is fabrication/i.test(seenPrompt));
}

console.log('\n== 4. executionEvidence: honest summary shapes ==');
{
  const ev = executionEvidence([]);
  check('no events → browser never invoked, zero commands', /browser: never invoked/.test(ev) && /commands\/tests executed: 0 — NONE/.test(ev));
  const ev2 = executionEvidence([
    { type: 'COMPUTER_ACT', summary: 'Atlas → open https://example.com', data: { action: 'goto' } },
    { type: 'COMPUTER_OBSERVE', summary: 'Observed the page: 1 element(s), 220 chars of text.', data: {} },
    { type: 'COMMAND_COMPLETED', summary: '`node app.js` → exit 0 in 120ms.', data: {} },
    { type: 'TEST_COMPLETED', summary: '`node --test` → exit 0 in 300ms.', data: {} },
    { type: 'FILE_UPDATED', summary: 'Updated app.js (220 bytes).', data: {} },
    { type: 'SEARCH_COMPLETED', summary: 'Search finished: example.com.' },
    { type: 'MODEL_REQUEST_COMPLETED', summary: '' },
  ]);
  check('browser actions counted from real events', /browser actions executed: 2/.test(ev2) && /open https:\/\/example\.com/.test(ev2));
  check('commands/tests counted with the last one named', /commands\/tests executed: 2/.test(ev2) && /node --test/.test(ev2));
  check('files + searches + model calls summarized', /files written: 1/.test(ev2) && /searches: 1/.test(ev2) && /model calls: 1/.test(ev2));
}

console.log('\n== 5. The employee brief carries the provenance rule ==');
{
  const employee = getEmployee('atlas');
  const brief = assembleBrief({
    task: { id: 't1', objective: 'open the page', constraints: [] },
    subtask: { id: 'st1', title: 'drive the page', capability: 'computer' },
    employee, dependencies: [],
  });
  const allConstraints = [...(brief.constraints || [])].join(' | ');
  check('brief: report only methods actually executed', /Report only methods you actually executed/i.test(allConstraints));
  check('brief: blocked/unavailable must be said explicitly', /If a tool was blocked or unavailable, say exactly that/i.test(allConstraints));
}

console.log('\n============================================================');
console.log(`B213: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
