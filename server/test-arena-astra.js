/**
 * ARENA ASTRA REBUILD — tests for the new executive layer.
 * Deterministic. No network. No model calls. Run: node test-arena-astra.js
 */
import assert from 'node:assert';

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`); };

// ── Observer ─────────────────────────────────────────────────────────
{
  const { emit, recent, stats, subscribe, _clear } = await import('./src/services/Observer.js');
  _clear();
  assert.strictEqual(emit('not a type', {}), null);
  const e1 = emit('mission.created', { missionId: 'm1', summary: 'Build X' });
  assert.ok(e1 && e1.id && e1.t);
  emit('model.completed', { summary: 'groq answered' });
  assert.strictEqual(recent({ limit: 10 }).length, 2);
  assert.strictEqual(recent({ limit: 10 })[0].type, 'model.completed'); // newest first
  assert.strictEqual(recent({ typePrefix: 'mission.' }).length, 1);
  assert.strictEqual(recent({ missionId: 'm1' }).length, 1);
  let seen = 0;
  const unsub = subscribe(() => { seen += 1; });
  emit('task.started', {});
  assert.strictEqual(seen, 1);
  unsub();
  emit('task.started', {});
  assert.strictEqual(seen, 1);
  const st = stats();
  assert.ok(st.buffered >= 4 && st.byNamespace.mission >= 1);
  // subscriber exceptions never break the bus
  subscribe(() => { throw new Error('boom'); });
  assert.ok(emit('task.completed', {}));
  ok('Observer: typed bus, filters, stats, safe subscribers');
  _clear();
}

// ── IntentEngine ─────────────────────────────────────────────────────
{
  const { classify, capabilitiesFor } = await import('./src/services/IntentEngine.js');
  assert.strictEqual(classify('hello').route, 'fast');
  assert.strictEqual(classify('who built you').sub, 'identity');
  assert.strictEqual(classify('build me a quiz app').intent, 'coding');
  assert.strictEqual(classify('fix this traceback: NameError').intent, 'debugging');
  assert.strictEqual(classify('research quantum batteries').intent, 'research');
  assert.strictEqual(classify('open https://example.com and read it').intent, 'browser_op');
  assert.strictEqual(classify('read the file config.yaml').intent, 'file_op');
  assert.strictEqual(classify('analyze this dataset and chart it').intent, 'data');
  assert.strictEqual(classify('give me a stock market outlook').intent, 'market');
  assert.strictEqual(classify('every morning at 8am give me AI news').intent, 'schedule');
  assert.strictEqual(classify('remember this project').intent, 'memory');
  const lean = classify('What is the capital of Kenya?');
  assert.strictEqual(lean.route, 'lean');
  assert.strictEqual(lean.leanOk, true);
  // long / work-flavored questions never go lean
  assert.notStrictEqual(classify('What is the capital of Kenya? Also build me a map app for it.').route, 'lean');
  // active mission owns the turn
  assert.strictEqual(classify('actually use Python instead', { activeMission: true, missionId: 'm9' }).route, 'mission');
  assert.deepStrictEqual(capabilitiesFor({ intent: 'research', capabilities: [] }).slice(0, 1), ['web_search']);
  ok('IntentEngine: deterministic routing, lean gate, mission ownership');
}

// ── OllamaProvider (config only — no network in tests) ───────────────
{
  const { ollamaConfig, OllamaProvider } = await import('./src/providers/runtime/OllamaProvider.js');
  const prev = { ...process.env };
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434/';
  process.env.MODEL_NAME = 'qwen3:8b';
  const cfg = ollamaConfig();
  assert.strictEqual(cfg.preferred, true);
  assert.strictEqual(cfg.baseUrl, 'http://127.0.0.1:11434');
  assert.strictEqual(cfg.model, 'qwen3:8b');
  assert.strictEqual(OllamaProvider.id, 'ollama');
  process.env.MODEL_PROVIDER = prev.MODEL_PROVIDER || '';
  ok('OllamaProvider: first-class local config');
}

// ── ReasoningEngine (fake providers — no network) ────────────────────
{
  const { ReasoningEngine } = await import('./src/services/ReasoningEngine.js');
  ReasoningEngine.registerProvider({ id: 'fake-good', kind: 'test', generate: async () => ({ text: 'hello from fake', model: 'fake-1' }) });
  ReasoningEngine.registerProvider({ id: 'fake-bad', kind: 'test', generate: async () => { throw new Error('down'); } });
  const r1 = await ReasoningEngine.reason([{ role: 'user', content: 'hi' }], { prefer: 'fake-good', timeoutMs: 5000 });
  assert.strictEqual(r1.text, 'hello from fake');
  assert.strictEqual(r1.provider, 'fake-good');
  // ladder walk: bad first is skipped when preferred-good exists later? prefer forces order [prefer, ...rest]
  const r2 = await ReasoningEngine.reason([{ role: 'user', content: 'hi' }], { prefer: 'fake-bad', timeoutMs: 5000 });
  assert.strictEqual(r2.provider, 'fake-good'); // fell through honestly
  assert.ok(r2.attempts >= 2);
  const h = await ReasoningEngine.health();
  assert.ok(Array.isArray(h.ladder) && h.ladder.includes('fake-good'));
  assert.throws(() => ReasoningEngine.registerProvider({}), /needs/);
  ok('ReasoningEngine: ladder walk, fallback, health');
}

// ── ContextEngine ────────────────────────────────────────────────────
{
  const { assemble, checkpoint } = await import('./src/services/ContextEngine.js');
  const { messages, usage, trimmed } = assemble({
    instruction: 'Summarize the mission.',
    task: { title: 'T1', brief: 'Do the thing', status: 'RUNNING' },
    mission: { title: 'M1', goal: 'Win' },
    memories: ['Lewis prefers Python for scripts', 'Render region is oregon'],
    previousResults: Array.from({ length: 10 }, (_, i) => `result ${i}: ${'x'.repeat(500)}`),
    tools: ['files', 'git', 'browser'],
    constraints: ['no destructive ops'],
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello Boss' }],
  });
  assert.ok(messages.length >= 2);
  assert.strictEqual(messages[messages.length - 1].content, 'Summarize the mission.'); // instruction last
  assert.ok(usage.chars <= 12000);
  assert.ok(trimmed.length >= 0);
  // hard budget: never exceed maxChars even with huge input
  const big = assemble({ instruction: 'x', memories: Array.from({ length: 50 }, () => 'y'.repeat(1000)) }, { budget: { maxChars: 3000 } });
  const total = big.messages.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 3000, `budget respected (${total})`);
  const cp = checkpoint(['a\nb', 'c'], { maxChars: 200 });
  assert.ok(cp.includes('Checkpoint'));
  ok('ContextEngine: task-scoped assembly, budgets, checkpoints');
}

// ── Scheduler (fake graph — no I/O) ──────────────────────────────────
{
  const { tick, pause, resume, cancel, schedulerStatus, _reset } = await import('./src/services/Scheduler.js');
  _reset();
  const done = [];
  const fakeGraph = {
    missionId: 'sched-test',
    readyItems: () => [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
    completeItem: (id) => done.push(id),
    failItem: () => {},
  };
  const ran = [];
  const r = await tick(fakeGraph, { concurrency: 2, executeItem: async (it) => { ran.push(it.id); return `ok-${it.id}`; } });
  assert.deepStrictEqual(r.dispatched.sort(), ['a', 'b']); // bounded to 2
  await new Promise((res) => setTimeout(res, 100));
  assert.deepStrictEqual(done.sort(), ['a', 'b']);
  pause('sched-test');
  const r2 = await tick(fakeGraph, { executeItem: async () => {} });
  assert.strictEqual(r2.paused, true);
  assert.deepStrictEqual(r2.dispatched, []);
  resume('sched-test');
  const st = schedulerStatus('sched-test');
  assert.strictEqual(st.paused, false);
  cancel('sched-test');
  assert.strictEqual(schedulerStatus('sched-test').paused, true);
  await assert.rejects(() => tick(null, {}), /needs/);
  ok('Scheduler: bounded dispatch, pause/resume/cancel, completion hooks');
  _reset();
}

// ── Recovery ─────────────────────────────────────────────────────────
{
  const { attempt, diagnose, recoverWorkItem } = await import('./src/services/Recovery.js');
  assert.strictEqual(diagnose(new Error('ETIMEDOUT')).retry, true);
  assert.strictEqual(diagnose(new Error('ENOENT no such file')).retry, false);
  assert.strictEqual(diagnose(new Error('403 forbidden')).retry, false);
  let n = 0;
  const r1 = await attempt(async () => { n += 1; if (n < 3) throw new Error('503 overloaded'); return 'won'; }, { baseBackoffMs: 5, maxBackoffMs: 10 });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.value, 'won');
  assert.strictEqual(r1.attempts, 3);
  const r2 = await attempt(async () => { throw new Error('EACCES denied'); }, { baseBackoffMs: 5 });
  assert.strictEqual(r2.ok, false); // no endless retry on permission errors
  // work-item decision
  const calls = [];
  const g = { missionId: 'm', items: [{ id: 'w1', retryCount: 0 }], retry: (id) => calls.push(id) };
  const d1 = await recoverWorkItem(g, 'w1', new Error('timeout'));
  assert.strictEqual(d1.action, 'requeued');
  const d2 = await recoverWorkItem(g, 'w1', new Error('EACCES denied'));
  assert.strictEqual(d2.action, 'replan');
  ok('Recovery: diagnose → retry → replan ladder');
}

// ── SelfImprovement ──────────────────────────────────────────────────
{
  const { propose, advance, approve, reject, promote, scanAnomalies, listProposals, _reset } = await import('./src/services/SelfImprovement.js');
  _reset();
  const p = propose({ title: 'Cache provider health for 60s', anomaly: 'repeated health probes' });
  assert.strictEqual(p.stage, 'telemetry');
  assert.throws(() => propose({ title: '' }), /title/);
  advance(p.id, 'confirmed in telemetry');
  assert.strictEqual(listProposals()[0].stage, 'anomaly');
  // cannot promote early
  await assert.rejects(() => promote(p.id, async () => {}), /validation/);
  // walk to validation, still gated on approval
  for (const s of ['diagnosis', 'reproduction', 'research', 'experiment', 'benchmark', 'sandbox', 'regression', 'validation']) advance(p.id, `reached ${s}`);
  await assert.rejects(() => promote(p.id, async () => {}), /approval/);
  approve(p.id, 'Lewis');
  const out = await promote(p.id, async () => 'patch-written-for-review');
  assert.strictEqual(out.proposal.status, 'promoted');
  assert.strictEqual(out.result, 'patch-written-for-review');
  const p2 = propose({ title: 'nope' });
  reject(p2.id, 'not worth it');
  assert.strictEqual(listProposals().find((x) => x.id === p2.id).status, 'rejected');
  const anoms = scanAnomalies([{ type: 'tool.failed' }, { type: 'tool.failed' }, { type: 'tool.failed' }]);
  assert.ok(anoms.some((a) => a.kind === 'repeated-failure'));
  ok('SelfImprovement: staged pipeline, human approval gate, anomaly scan');
  _reset();
}

// ── JexiMarketProvider (unconfigured honesty — no network) ───────────
{
  const prev = { ...process.env };
  delete process.env.JEXI_MARKET_URL;
  delete process.env.JEXI_MARKET_API_KEY;
  const { marketStatus, callMarket } = await import('./src/services/JexiMarketProvider.js');
  assert.strictEqual(marketStatus().configured, false);
  const r = await callMarket('quote', { symbols: ['AAPL'] });
  assert.strictEqual(r.connected, false);
  assert.ok(/not connected/i.test(r.summary));
  process.env.JEXI_MARKET_URL = prev.JEXI_MARKET_URL || '';
  process.env.JEXI_MARKET_API_KEY = prev.JEXI_MARKET_API_KEY || '';
  ok('JexiMarketProvider: honest unconfigured state, no fake success');
}

// ── UserProfile (private by default) ─────────────────────────────────
{
  const { loadProfile, publicPersona, behaviorBrief } = await import('./src/services/UserProfile.js');
  const p = loadProfile();
  assert.strictEqual(p.preferredName, 'Lewis');
  assert.ok((p.projects?.main || '').includes('JEXI OS'));
  const pub = publicPersona();
  assert.deepStrictEqual(Object.keys(pub).sort(), ['creatorCredit', 'identity', 'name']);
  assert.ok(!JSON.stringify(pub).includes('Kibabii')); // private stays private
  assert.ok(behaviorBrief().includes('Boss'));
  ok('UserProfile: persistent owner profile, public-safe persona');
}

// ── MemoryVault (over the real decision store — local file) ──────────
{
  const { remember, recall, vaultStatus } = await import('./src/services/MemoryVault.js');
  assert.strictEqual(await remember({ category: 'facts', content: 'x' }), null); // too thin
  const kept = await remember({ category: 'preferences', content: 'Lewis prefers practical engineering examples over theory.', source: 'test' });
  assert.ok(kept && kept.category === 'preferences');
  const found = await recall({ query: 'practical engineering', limit: 5 });
  assert.ok(Array.isArray(found));
  const st = await vaultStatus();
  assert.strictEqual(st.ok, true);
  assert.ok(st.total >= 1);
  ok('MemoryVault: quality floor, recall, lifecycle status');
}

console.log(`\nARENA-ASTRA: ${passed} suites passed, 0 failures.`);
