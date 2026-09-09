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

console.log(`\nF5 hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
