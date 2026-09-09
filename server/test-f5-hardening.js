/**
 * Final F5 — hardening found by the first real ollama missions.
 * Proves: (1) provider provenance — runWithModel credits the provider that
 * REALLY generated (via noteProvider), not the lane preference; (2) the
 * template-echo gate — a deliverable echoing brief scaffolding fails
 * deterministically even when the rubric judge says pass.
 */
import { runWithModel } from './src/services/director/ModelRouter.js';
import { echoesBriefScaffolding, verifyDeliverable } from './src/services/director/Verifier.js';
import { recordProviderCallFailure, maxCooldownRemainingMs, __resetProviderHealth } from './src/services/ProviderHealth.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };
const emp = { agentId: 'e1', displayName: 'Forge' };

console.log('\n== 1. Provider provenance ==');
{
  const seen = [];
  const r = await runWithModel(emp, 'code', ({ prefer, noteProvider }) => {
    noteProvider('ollama'); // the LLM client really generated on ollama…
    return Promise.resolve('work done');
  }, { onEvent: (e) => seen.push(e) });
  ok(r === 'work done', 'work result passes through');
  const done = seen.find((e) => e.type === 'MODEL_REQUEST_COMPLETED');
  ok(done && done.data && done.data.provider === 'ollama', 'COMPLETED event credits ollama (actual), not the groq preference');
  ok(done && done.data && done.data.preferred === 'groq', 'preference still recorded as preferred');
}
{
  // no noteProvider call → honest fallback to the preference (old behavior)
  const seen = [];
  await runWithModel(emp, 'code', () => Promise.resolve('x'), { onEvent: (e) => seen.push(e) });
  const done = seen.find((e) => e.type === 'MODEL_REQUEST_COMPLETED');
  ok(done && done.data.provider === 'groq', 'without a report, records the preference (documented fallback)');
}

console.log('\n== 2. Template-echo gate ==');
const ECHO = 'The actual work product — complete and directly usable. If it is a file, deliver it as a fenced code block with the filename in the info string. This section is what the team ships.';
ok(echoesBriefScaffolding(ECHO) === true, 'mission-1 echo shape detected');
ok(echoesBriefScaffolding('11/12 — working: 2/3 = 8/12, 8/12 + 3/12 = 11/12.') === false, 'real answer is not echo');
ok(echoesBriefScaffolding('The actual work product is attached below as app.js with tests.') === false, 'single-phrase overlap does not trip (threshold is 2)');
{
  // end to end: rubric judge says pass, echo gate still fails the verdict
  const v = await verifyDeliverable({
    task: { id: 't1', objective: 'Compute 2/3 + 1/4 with working.', events: [] },
    deliverable: ECHO,
    criteria: ['shows working', 'final fraction correct'],
    verifierEmployee: { agentId: 'vera', displayName: 'Vera', role: 'verifier', personality: 'strict' },
    llm: async () => JSON.stringify({ pass: true, score: 1, problems: [], rationale: 'looks fine' }),
    mailbox: { post: () => {} },
  });
  ok(v.verdict === 'fail', 'echo deliverable fails despite rubric pass');
  ok(v.problems.some((p) => /template echo/i.test(p)), 'problem names template echo');
}

console.log('\n== 3. Failure-denial gate ==');
{
  const mkTask = (types) => ({ id: 't1', objective: 'do math with code', events: types.map((t) => ({ type: t })) });
  const passJudge = async () => JSON.stringify({ pass: true, score: 1, problems: [], rationale: 'fine' });
  const base = { criteria: ['answer correct'], verifierEmployee: { agentId: 'vera', displayName: 'Vera', role: 'verifier', personality: 'strict' }, llm: passJudge, mailbox: { post: () => {} } };
  const v1 = await verifyDeliverable({ ...base, task: mkTask(['COMMAND_FAILED']), deliverable: 'Result: 5/12. Verified that the code was executed successfully and returned the correct result.' });
  ok(v1.verdict === 'fail', 'success-claim over exit-1-only record fails');
  const v2 = await verifyDeliverable({ ...base, task: mkTask(['COMMAND_FAILED', 'COMMAND_COMPLETED']), deliverable: 'Result: 11/12. The script ran successfully after a fix.' });
  ok(v2.verdict === 'pass', 'success-claim with a real success in the record passes the gate');
  const v3 = await verifyDeliverable({ ...base, task: mkTask(['COMMAND_FAILED']), deliverable: 'Result: 11/12 by hand working. The script failed (missing file) so this is unverified by execution.' });
  ok(v3.verdict === 'pass', 'honest failure report passes the gate');
}

console.log('\n== 4. Cooldown-aware recovery ==');
{
  // hermetic: the health record persists to ./data — stash it for the test
  const fs = await import('node:fs');
  const hf = './data/provider-health.json';
  const stash = fs.existsSync(hf) ? fs.readFileSync(hf) : null;
  try {
    if (fs.existsSync(hf)) fs.rmSync(hf);
    __resetProviderHealth();
    ok(maxCooldownRemainingMs() === 0, 'no cooldown outstanding on clean state');
    const t0 = Date.now();
    recordProviderCallFailure('ollama-probe', new Error('This operation was aborted'), { at: t0 });
    const rem = maxCooldownRemainingMs(t0 + 1000);
    ok(rem > 0 && rem <= 30000, `fresh failure reports remaining cooldown (${rem}ms)`);
    ok(maxCooldownRemainingMs(t0 + 10 * 60_000 + 1000) === 0, 'cooldown expires (cap is 10 min)');
  } finally {
    __resetProviderHealth();
    if (stash) { fs.mkdirSync('./data', { recursive: true }); fs.writeFileSync(hf, stash); }
    else if (fs.existsSync(hf)) fs.rmSync(hf);
  }
}

console.log('\n== 5. Progress-aware stream budget ==');
{
  const http = await import('node:http');
  const { __streamOpenAICompletion } = await import('./src/services/LLMClient.js');
  const chunk = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
  // stub SSE server with scripted per-path behavior
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url.startsWith('/slow')) { // chunk every 50ms x10 (0.5s total, idle budget 500ms)
      let i = 0;
      const iv = setInterval(() => { i += 1; res.write(chunk('w')); if (i >= 10) { clearInterval(iv); res.write('data: [DONE]\n\n'); res.end(); } }, 50);
    } else if (req.url.startsWith('/stall')) { // one chunk then silence
      res.write(chunk('w')); // never ends — the idle timer must kill it
    } else { // /endless — chunks forever; the cap must kill it
      const iv = setInterval(() => { try { res.write(chunk('w')); } catch { clearInterval(iv); } }, 50);
      req.on('close', () => clearInterval(iv));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const slow = await __streamOpenAICompletion({ baseUrl: `${base}/slow`, key: 'k', model: 'm', messages: [], idleMs: 300, maxMs: 5000 });
    ok(slow.text === 'w'.repeat(10), 'slow-but-steady stream completes past the idle budget');
    let stalled = false;
    try { await __streamOpenAICompletion({ baseUrl: `${base}/stall`, key: 'k', model: 'm', messages: [], idleMs: 300, maxMs: 5000 }); } catch { stalled = true; }
    ok(stalled, 'stalled stream aborts on idle timeout');
    const t0 = Date.now();
    let capped = false;
    try { await __streamOpenAICompletion({ baseUrl: `${base}/endless`, key: 'k', model: 'm', messages: [], idleMs: 2000, maxMs: 800 }); } catch { capped = true; }
    ok(capped && Date.now() - t0 < 3000, 'endless stream aborts at the overall cap despite progress');
  } finally { server.close(); }
}

console.log('\n== 6. Local-rung time budget ==');
{
  const http = await import('node:http');
  const { generateContent } = await import('./src/services/LLMClient.js');
  // stub ollama: answers after 600ms with a valid chat.completion payload
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'stub answer' } }] }));
    }, 600);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${server.address().port}`;
  try {
    let threw = false;
    try { await generateContent('hi', 'sys', null, { provider: 'ollama', timeoutMs: 200 }); } catch { threw = true; }
    ok(threw, 'tiny budget aborts the local rung (override honored)');
    const text = await generateContent('hi', 'sys', null, { provider: 'ollama', timeoutMs: 3000 });
    ok(text === 'stub answer', 'adequate budget lets the slow local rung answer');
  } finally { process.env.OLLAMA_HOST = prev; server.close(); }
}

console.log('\n== 7. Bounded turns (maxTokens) ==');
{
  const http = await import('node:http');
  const { generateContent } = await import('./src/services/LLMClient.js');
  let seenBody = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { seenBody = JSON.parse(raw); } catch { seenBody = null; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${server.address().port}`;
  try {
    await generateContent('hi', 'sys', null, { provider: 'ollama', onToken: () => {}, maxTokens: 1500 });
    ok(seenBody && seenBody.max_tokens === 1500 && seenBody.stream === true, 'stream leg forwards max_tokens');
    await generateContent('hi', 'sys', null, { provider: 'ollama', onToken: () => {} });
    ok(seenBody && !('max_tokens' in seenBody), 'no cap sent when unset (back-compat)');
  } finally { process.env.OLLAMA_HOST = prev; server.close(); }
}

console.log('\n== 8. Abort propagation (no orphaned legs) ==');
{
  const http = await import('node:http');
  const { __streamOpenAICompletion, generateContent } = await import('./src/services/LLMClient.js');
  const chunk = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url.startsWith('/slow200')) {
      setTimeout(() => { res.end(`${chunk('done')}\ndata: [DONE]\n\n`); }, 200);
    } else { // /endless
      const iv = setInterval(() => { try { res.write(chunk('w')); } catch { clearInterval(iv); } }, 50);
      req.on('close', () => clearInterval(iv));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // pre-aborted signal rejects without waiting for the leg
    const dead = new AbortController(); dead.abort();
    const t0 = Date.now();
    let threw = false;
    try { await __streamOpenAICompletion({ baseUrl: `${base}/slow200`, key: 'k', model: 'm', messages: [], signal: dead.signal }); } catch { threw = true; }
    ok(threw && Date.now() - t0 < 200, 'pre-aborted signal rejects immediately');
    // mid-stream abort kills the leg
    const mid = new AbortController();
    setTimeout(() => mid.abort(), 300);
    const t1 = Date.now();
    let threwMid = false;
    try { await __streamOpenAICompletion({ baseUrl: `${base}/endless`, key: 'k', model: 'm', messages: [], idleMs: 5000, maxMs: 30000, signal: mid.signal }); } catch { threwMid = true; }
    ok(threwMid && Date.now() - t1 < 2000, 'mid-stream abort kills the leg promptly');
    // generateContent honors a dead signal end to end (the adapter path)
    const prev = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = base;
    try {
      let threwGc = false;
      try { await generateContent('hi', 'sys', null, { provider: 'ollama', onToken: () => {}, signal: dead.signal }); } catch { threwGc = true; }
      ok(threwGc, 'generateContent honors an aborted signal');
    } finally { process.env.OLLAMA_HOST = prev; }
  } finally { server.close(); }
}

console.log('\n== 9. Planner-shape coercion ==');
{
  const { asStringArray } = await import('./src/services/director/MissionRunner.js');
  ok(JSON.stringify(asStringArray(['a', 'b', 3], 10)) === '["a","b","3"]', 'arrays pass through as strings');
  ok(JSON.stringify(asStringArray('just do it', 10)) === '["just do it"]', 'bare string wraps (the observed crash shape)');
  ok(JSON.stringify(asStringArray(null, 10)) === '[]' && JSON.stringify(asStringArray({ x: 1 }, 10)) === '[]', 'null/object coerce to empty, never throw');
  ok(asStringArray(['a', 'b', 'c'], 2).length === 2, 'cap honored');
}

console.log('\n== 10. Caller-abort fail-fast (no health penalty) ==');
{
  const http = await import('node:http');
  const { generateContent } = await import('./src/services/LLMClient.js');
  const { providerHealthSnapshot } = await import('./src/services/ProviderHealth.js');
  const chunk = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
  const server = http.createServer((req, res) => {
    if (req.url.includes('chat/completions') && req.headers['content-type']?.includes('json')) {
      // non-stream walk leg answers slow-but-valid JSON
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        if (body.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`${chunk('ok')}\ndata: [DONE]\n\n`); }
        else setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); }, 400);
      });
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${server.address().port}`;
  const dead = new AbortController(); dead.abort();
  const before = JSON.stringify((providerHealthSnapshot().find((r) => r.provider === 'ollama') || {}));
  try {
    let streamErr = '';
    try { await generateContent('hi', 'sys', null, { provider: 'ollama', onToken: () => {}, signal: dead.signal }); } catch (e) { streamErr = String(e && e.message || e); }
    ok(/abort/i.test(streamErr) && !/No AI provider answered/.test(streamErr), `stream path fails fast with the abort (${streamErr.slice(0, 60)})`);
    let walkErr = '';
    try { await generateContent('hi', 'sys', null, { provider: 'ollama', signal: dead.signal }); } catch (e) { walkErr = String(e && e.message || e); }
    ok(/abort/i.test(walkErr) && !/No AI provider answered/.test(walkErr), `walk path fails fast with the abort (${walkErr.slice(0, 60)})`);
    const after = JSON.stringify((providerHealthSnapshot().find((r) => r.provider === 'ollama') || {}));
    ok(before === after, 'caller aborts leave provider health untouched');
  } finally { process.env.OLLAMA_HOST = prev; server.close(); }
}

console.log('\n== 11. Unstructured-output salvage ==');
{
  const { runEmployeeSession, assembleBrief } = await import('./src/services/director/EmployeeSession.js');
  const { getEmployee } = await import('./src/services/director/Employees.js');
  const { TaskMailbox } = await import('./src/services/director/AgentMail.js');
  const emp = getEmployee('zola');
  const mk = (script) => {
    const task = { id: 't-salvage', objective: 'say the thing', successCriteria: ['says it'] };
    const subtask = { id: 'st1', title: 'say the thing', capability: 'research', timeBudgetMs: 5000 };
    const brief = assembleBrief({ task, subtask, employee: emp, dependencies: [] });
    const events = [];
    return {
      events,
      run: () => runEmployeeSession({
        task, subtask, employee: emp, brief, mailbox: new TaskMailbox(task.id),
        hooks: { onEvent: (e) => events.push(e) }, llm: async () => script, tools: null,
      }),
    };
  };
  const free = mk('The backup drive is called BLUEVAULT and it holds nightly snapshots of the workspace.');
  const res = await free.run();
  ok(res && res.parsed && res.parsed.unstructured === true && res.parsed.deliverable.includes('BLUEVAULT'), 'free-form answer salvaged as low-confidence deliverable');
  ok(res.parsed.confidence === 'low', 'salvaged confidence capped at low');
  ok(free.events.some((e) => e.type === 'OUTPUT_SALVAGED'), 'salvage emits OUTPUT_SALVAGED (visible, not silent)');
  let threwEmpty = false;
  try { await mk('   ').run(); } catch (e) { threwEmpty = e && e.code === 'BAD_OUTPUT'; }
  ok(threwEmpty, 'empty output still throws BAD_OUTPUT');
  let threwRefusal = false;
  try { await mk('As an AI I cannot help with that request at all, sorry.').run(); } catch (e) { threwRefusal = e && e.code === 'BAD_OUTPUT'; }
  ok(threwRefusal, 'refusal is not salvaged (still BAD_OUTPUT)');
}

console.log(`\nF5 hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
