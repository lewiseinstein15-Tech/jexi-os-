/**
 * ULTIMATE ARCHITECTURE UPGRADE — TaskGraph / ExecutionBackend /
 * ExternalProviders / ArchitectureViews contracts (§12–§20, §38, §41).
 * Deterministic, keyless: workers are injected fakes (no LLM involved).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-architecture';

const tg = await import('../../src/services/TaskGraph.js');
const { createRun, addTask, executeRun, cancelRun, listRuns, getRun, taskGraphStats, clearRuns, TASK_STATES } = tg;
const eb = await import('../../src/services/ExecutionBackend.js');
const { JexiNativeBackend, registerBackend, getBackend, listBackends } = eb;
const xp = await import('../../src/services/ExternalProviders.js');
const { registerProvider, callProvider, listProviders, externalProviderStats, registerDefaults } = xp;
const av = await import('../../src/services/ArchitectureViews.js');

clearRuns();

/* ═══ §12–§13: graph shape + persistence ═══════════════════════════════════ */

test('a run is created with the full task-graph shape and persists', () => {
  const run = createRun({ query: 'plan a tea report', intent: 'research' });
  assert.match(run.id, /^run-/);
  assert.equal(run.status, 'planning');
  const t1 = addTask(run.id, { title: 'gather data', agent: 'researcher', tools: ['web-search'], capabilities: ['web_search'] });
  const t2 = addTask(run.id, { title: 'write report', agent: 'writer', dependsOn: [t1.id] });
  assert.equal(t1.status, 'CREATED');
  assert.deepEqual(t2.dependsOn, [t1.id]);
  const again = getRun(run.id);
  assert.equal(again.tasks.length, 2);
  assert.ok(again.timeline.some((e) => e.type === 'run_created'));
  assert.ok(again.timeline.some((e) => e.type === 'task_created'));
});

/* ═══ §16–§17: lifecycle + dependency-aware parallel execution ═════════════ */

test('independent tasks run in PARALLEL, dependents run after (lifecycle recorded)', async () => {
  clearRuns();
  const run = createRun({ query: 'parallel demo' });
  const order = [];
  const a = addTask(run.id, { title: 'A', agent: 'researcher' });
  const b = addTask(run.id, { title: 'B', agent: 'researcher' });
  const c = addTask(run.id, { title: 'C (needs A+B)', dependsOn: [a.id, b.id] });
  let overlap = 0;
  const worker = async (task) => {
    if (task.id !== c.id) {
      order.push(`start:${task.id}`);
      overlap += 1;
      if (overlap === 2) order.push('PARALLEL');
      await new Promise((r) => setTimeout(r, 80));
      order.push(`end:${task.id}`);
      return { result: `${task.id}-done` };
    }
    order.push(`start:${task.id}`);
    assert.ok(order.includes('end:' + a.id) && order.includes('end:' + b.id), 'C must start after BOTH deps end');
    return { result: 'c-done' };
  };
  const done = await executeRun(run.id, { worker });
  assert.equal(done.status, 'completed');
  assert.ok(order.includes('PARALLEL'), 'A and B overlapped');
  for (const t of done.tasks) assert.equal(t.status, 'COMPLETED');
  assert.equal(done.tasks.find((t) => t.id === c.id).result, 'c-done');
  const full = getRun(run.id);
  for (const type of ['run_created', 'run_started', 'task_starting', 'task_completed', 'run_ended']) {
    assert.ok(full.timeline.some((e) => e.type === type), `timeline missing ${type}`);
  }
});

test('all eleven worker lifecycle states are defined', () => {
  assert.equal(TASK_STATES.length, 11);
  assert.deepEqual(
    TASK_STATES,
    ['CREATED', 'QUEUED', 'STARTING', 'READY', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'BLOCKED'],
  );
});

/* ═══ §18: failure recovery — retries, timeout, cascade, cancel ════════════ */

test('a failing task retries with backoff then FAILS, and dependents are BLOCKED', async () => {
  clearRuns();
  const run = createRun({ query: 'failure demo' });
  const flaky = addTask(run.id, { title: 'always fails', agent: 'researcher', maxRetries: 2, timeoutMs: 5_000 });
  const child = addTask(run.id, { title: 'depends on failure', dependsOn: [flaky.id] });
  let attempts = 0;
  const worker = async (task) => {
    if (task.id === flaky.id) { attempts += 1; throw new Error('boom'); }
    return { result: 'never' };
  };
  const done = await executeRun(run.id, { worker });
  assert.equal(attempts, 3, '1 initial + 2 retries');
  assert.equal(done.tasks.find((t) => t.id === flaky.id).status, 'FAILED');
  assert.equal(done.tasks.find((t) => t.id === child.id).status, 'BLOCKED');
  assert.equal(done.status, 'failed');
  const tl = getRun(run.id).timeline;
  assert.equal(tl.filter((e) => e.type === 'task_retry').length, 2);
  assert.ok(tl.some((e) => e.type === 'task_failed'));
  assert.ok(tl.some((e) => e.type === 'task_blocked'));
});

test('a hung task is TIMEOUT-killed at its per-task limit', async () => {
  clearRuns();
  const run = createRun({ query: 'timeout demo' });
  addTask(run.id, { title: 'hangs forever', timeoutMs: 150, maxRetries: 0 });
  const done = await executeRun(run.id, { worker: () => new Promise(() => {}) });
  assert.equal(done.tasks[0].status, 'TIMEOUT');
  assert.equal(done.status, 'failed');
  assert.ok(/timeout/i.test(done.tasks[0].error));
});

test('a task that recovers on retry COMPLETES (transient failure)', async () => {
  clearRuns();
  const run = createRun({ query: 'retry demo' });
  const t = addTask(run.id, { title: 'flaky then fine', maxRetries: 2 });
  let calls = 0;
  const done = await executeRun(run.id, {
    worker: async (task) => {
      calls += 1;
      if (calls === 1) throw new Error('transient network blip');
      return { result: 'recovered' };
    },
  });
  assert.equal(done.tasks[0].status, 'COMPLETED');
  assert.equal(done.tasks[0].result, 'recovered');
  assert.equal(calls, 2);
});

test('cancelling a run marks in-flight + pending tasks CANCELLED', async () => {
  clearRuns();
  const run = createRun({ query: 'cancel demo' });
  addTask(run.id, { title: 'slow', timeoutMs: 10_000 });
  addTask(run.id, { title: 'queued behind', dependsOn: [`${run.id}-t1`] });
  const p = executeRun(run.id, { worker: () => new Promise((r) => setTimeout(() => r({ result: 'late' }), 500)) });
  setTimeout(() => cancelRun(run.id), 60);
  const done = await p;
  assert.equal(done.status, 'cancelled');
  assert.ok(done.tasks.every((t) => t.status === 'CANCELLED'));
});

test('a WAITING worker pauses the task without failing the run', async () => {
  clearRuns();
  const run = createRun({ query: 'waiting demo' });
  addTask(run.id, { title: 'needs user input' });
  const done = await executeRun(run.id, { worker: async () => ({ status: 'waiting', payload: { question: 'which city?' } }) });
  assert.equal(done.tasks[0].status, 'WAITING');
  assert.deepEqual(done.tasks[0].result, { question: 'which city?' });
});

/* ═══ §38: ExecutionBackend abstraction ════════════════════════════════════ */

test('the native backend is registered, available and listed first', () => {
  const list = listBackends();
  assert.ok(list.some((b) => b.id === 'jexi-native' && b.available === true));
  const b = getBackend('jexi-native');
  assert.equal(b, JexiNativeBackend);
});

test('an unregistered backend id is refused honestly (DESIGNED ≠ BUILT)', () => {
  assert.throws(() => getBackend('orca'), /not registered/);
});

test('custom backends can be registered and used by the graph', async () => {
  clearRuns();
  registerBackend({ id: 'test-fake', label: 'fake', available: () => true, async execute(task) { return { result: `via-backend:${task.id}` }; } });
  const run = createRun({ query: 'backend demo', backend: 'test-fake' });
  addTask(run.id, { title: 'one task' });
  const done = await executeRun(run.id);
  assert.equal(done.tasks[0].result, 'via-backend:' + done.tasks[0].id);
  registerBackend({ id: 'jexi-native', label: 'JEXI Native (WorkerRouter + LLM providers)', available: () => true, async execute() { return { result: null }; } }); // restore default
});

/* ═══ §41: External Capability Providers (one-way, honest) ═════════════════ */

test('the JEXI Market slot exists as a NOT-CONNECTED placeholder (separation rule)', () => {
  const providers = listProviders();
  const market = providers.find((p) => p.id === 'jexi-market');
  assert.ok(market, 'market slot registered by default');
  assert.equal(market.configured, false);
  assert.equal(market.connection, 'not-connected');
  assert.deepEqual(market.capabilities, ['market-research', 'fundamental-analysis', 'technical-analysis', 'macro-analysis', 'risk-assessment', 'paper-trading', 'backtesting']);
});

test('calling the unconfigured Market provider returns an honest unavailable answer', async () => {
  const r = await callProvider('jexi-market', { request: 'analyze NSE' });
  assert.equal(r.ok, false);
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /not connected/i);
});

test('an unknown provider is refused and stats stay honest', async () => {
  const r = await callProvider('nope', {});
  assert.equal(r.ok, false);
  const stats = externalProviderStats();
  assert.ok(stats.providers >= 1);
  assert.equal(stats.connected, 0); // nothing real is integrated — by design
  assert.match(stats.oneWayRule, /never initiate/i);
});

test('a configured provider pointing nowhere fails gracefully (retry + honest error)', async () => {
  registerProvider({ id: 'dead-endpoint', name: 'Dead', endpoint: 'http://127.0.0.1:9/none', timeoutMs: 300, retry: { attempts: 2, backoffMs: 50 } });
  const r = await callProvider('dead-endpoint', {});
  assert.equal(r.ok, false);
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /failed after 2 attempt/i);
});

/* ═══ §4–§8, §20: ArchitectureViews snapshot ══════════════════════════════ */

test('the architecture snapshot indexes every registry with metadata + health', () => {
  const snap = av.architectureSnapshot();
  assert.ok(snap.registries.agents.total > 100, 'agent roster indexed');
  assert.ok(snap.registries.tools.total > 100, 'tool registry indexed');
  assert.equal(snap.registries.mcp.total, 42, 'all 42 MCP servers indexed');
  assert.equal(snap.registries.plugins.total, 51, 'all 51 plugins indexed');
  for (const m of snap.registries.mcp.items) {
    assert.ok(['disabled', 'ready', 'connected', 'error', 'cooldown'].includes(m.status));
    assert.ok(['open', 'closed'].includes(m.circuit));
  }
  assert.ok(snap.capabilityRouting.capabilities.length > 10);
  assert.ok(snap.pipeline.includes('CAPABILITY ROUTER'));
});

test('run views list every run with task states (observability without new UI)', async () => {
  clearRuns();
  const run = createRun({ query: 'view demo' });
  addTask(run.id, { title: 'only task' });
  await executeRun(run.id, { worker: async () => ({ result: 'x' }) });
  const runs = listRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'completed');
  assert.equal(runs[0].tasks[0].status, 'COMPLETED');
  assert.ok(taskGraphStats().runs >= 1);
  assert.deepEqual(taskGraphStats().taskStates.find((s) => s.state === 'COMPLETED').count >= 1, true);
});
