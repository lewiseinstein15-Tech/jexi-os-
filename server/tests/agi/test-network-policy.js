/**
 * PHASE 3B — EXPLICIT REMOTE FALLBACK POLICY contracts.
 *
 * The Phase 3A audit proved that a local-provider failure could slide a turn
 * to a real remote keyless endpoint (kilo / pollinations). These suites pin
 * the boundary the fix establishes, using ONLY loopback fixtures and injected
 * seams — no real external service is ever contacted.
 *
 * What the tests actually establish (and what they do NOT):
 *   - They establish that under `local-only` the provider walk does not DIAL a
 *     non-loopback endpoint, and that the attempted-provider list is exactly
 *     the loopback set. The network guard makes an accidental remote request a
 *     loud failure rather than silent egress.
 *   - They establish the policy plumbing end to end (selection, refusal,
 *     accounting, tighten-only). They do NOT prove the OS is hermetic: a bug
 *     that bypassed these seams would still be a real dial. Hermeticity at
 *     runtime is a property of the environment plus this policy.
 *
 * Explicitly asked for run:
 *   node --test --test-reporter=spec tests/agi/test-network-policy.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATA_DIR = './data/test-agi-network-policy';

const {
  NETWORK_POLICIES, getNetworkPolicy, networkPolicySnapshot, isLocalOnly,
  isLoopbackUrl, classifyProvider, isLocalProvider, providerAllowed,
  resolveEffectivePolicy, filterProvidersByPolicy, providerKeyOf,
  beginProviderAttempt, attemptedProviders, refusedProviders, policyAuditLog,
  __setProviderAttemptHook, __resetPolicyAudit,
} = await import('../../src/services/NetworkPolicy.js');

const { generateContent, generateContentSafe, generateWithToolsLoop, testProvider } = await import('../../src/providers/runtime/LLMClient.js');
const { configuredProviders, providerHealthSnapshot, providerNetworkSummary, resetProviderHealth } = await import('../../src/providers/runtime/ProviderRouter.js');
const { runtimeChain } = await import('../../src/providers/catalog/WorkerRouter.js');

/* ── env hygiene: never let the host's policy leak into the run ─────────── */
const SAVED = { ...process.env };
function clearPolicy() { delete process.env.JEXI_NETWORK_POLICY; }

/* ═══ network guard — fail LOUDLY on any non-loopback dial ════════════════ */

const realFetch = globalThis.fetch;
const remoteAttempts = []; // real non-loopback dials — must stay empty where asserted
const dialed = [];         // every real dial (loopback included) — the ground truth
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  dialed.push(url);
  if (!isLoopbackUrl(url)) {
    remoteAttempts.push(url);
    throw new Error(`EGRESS GUARD: test attempted a non-loopback request to ${url}`);
  }
  return realFetch(input, init);
};
process.on('exit', () => { globalThis.fetch = realFetch; });

/** A tiny loopback OpenAI-compatible server (Ollama-shaped). */
function startLocalModel(makeText = (m) => `LOCAL[${m}]`) {
  const seen = { chats: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'local-model' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.chats += 1;
        const parsed = JSON.parse(body || '{}');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'cmpl-local', model: parsed.model,
          choices: [{ index: 0, message: { role: 'assistant', content: makeText(parsed.model) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen })));
}

function installAttemptGuard() {
  __setProviderAttemptHook((rec) => {
    if (rec.endpoint && !isLoopbackUrl(rec.endpoint)) {
      throw new Error(`EGRESS GUARD: provider "${rec.provider}" would dial non-loopback ${rec.endpoint}`);
    }
  });
}

let seq = 0;
/** Unique prompt so concurrent-identical dedup can never coalesce a test call. */
const uniq = (label) => `${label} #${++seq}`;

test.beforeEach(() => {
  remoteAttempts.length = 0;
  dialed.length = 0;
  clearPolicy();
  resetProviderHealth();
  __resetPolicyAudit();
  __setProviderAttemptHook(null); // per-test: only local-only suites arm the strict hook
});
test.after(() => {
  __setProviderAttemptHook(null);
  for (const k of ['JEXI_NETWORK_POLICY', 'MODEL_PROVIDER', 'OLLAMA_HOST', 'MODEL_NAME']) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
});

/* ═══ 1. policy parsing + locality by ENDPOINT, not by key ════════════════ */

test('the default policy is allow-remote; local-only is opt-in and alias-safe', () => {
  clearPolicy();
  assert.equal(getNetworkPolicy(), NETWORK_POLICIES.ALLOW_REMOTE);
  assert.equal(isLocalOnly(), false);
  assert.equal(getNetworkPolicy({ JEXI_NETWORK_POLICY: 'local-only' }), NETWORK_POLICIES.LOCAL_ONLY);
  assert.equal(getNetworkPolicy({ JEXI_NETWORK_POLICY: 'hermetic' }), NETWORK_POLICIES.LOCAL_ONLY);
  assert.equal(getNetworkPolicy({ JEXI_NETWORK_POLICY: 'air-gapped' }), NETWORK_POLICIES.LOCAL_ONLY);
  // a typo is not a policy — it defaults, and says so
  const snap = networkPolicySnapshot({ JEXI_NETWORK_POLICY: 'wat' });
  assert.equal(snap.policy, NETWORK_POLICIES.ALLOW_REMOTE);
  assert.equal(snap.source, 'env-unrecognized-defaulted');
});

test('locality is decided by ENDPOINT — a keyless provider is not automatically local', () => {
  // kilo and pollinations are KEYLESS and REMOTE. This is the exact trap.
  assert.equal(classifyProvider('kilo'), 'remote');
  assert.equal(classifyProvider('pollinations'), 'remote');
  assert.equal(isLocalProvider('kilo'), false);
  // loopback is local; a LAN address is NOT (a shared model server is egress)
  assert.equal(classifyProvider('ollama'), 'local');
  assert.equal(isLoopbackUrl('http://127.0.0.1:11434/v1'), true);
  assert.equal(isLoopbackUrl('http://localhost:8000/v1'), true);
  assert.equal(isLoopbackUrl('http://192.168.1.5:8000/v1'), false);
  // an override can move a "local" provider off-machine — and we must see it
  assert.equal(classifyProvider('vllm', {}, { VLLM_BASE_URL: 'http://10.0.0.9:8000/v1' }), 'remote');
  assert.equal(classifyProvider('vllm', {}, {}), 'local'); // default is loopback
});

test('a per-call policy may only TIGHTEN — a caller cannot widen the boundary', () => {
  clearPolicy();
  // env allow-remote, a call asking for local-only → local-only
  assert.equal(resolveEffectivePolicy({ networkPolicy: 'local-only' }), NETWORK_POLICIES.LOCAL_ONLY);
  // env local-only, a call asking for allow-remote → STILL local-only
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  assert.equal(resolveEffectivePolicy({ networkPolicy: 'allow-remote' }), NETWORK_POLICIES.LOCAL_ONLY);
  assert.equal(resolveEffectivePolicy({}), NETWORK_POLICIES.LOCAL_ONLY);
});

/* ═══ 2. selection: what the policy offers ════════════════════════════════ */

test('under local-only the configured/keyless remote legs are not offered', () => {
  clearPolicy();
  process.env.MODEL_PROVIDER = 'ollama';
  try {
    // allow-remote (default): the keyless remote floor is present, as today
    const before = configuredProviders();
    assert.ok(before.includes('kilo'), 'kilo present by default');
    assert.ok(before.includes('pollinations'), 'pollinations present by default');
    assert.ok(before.includes('ollama'), 'local ollama present');

    process.env.JEXI_NETWORK_POLICY = 'local-only';
    const after = configuredProviders();
    assert.ok(!after.includes('kilo'), 'kilo removed under local-only');
    assert.ok(!after.includes('pollinations'), 'pollinations removed under local-only');
    assert.ok(after.includes('ollama'), 'the local provider stays');
    // every remaining leg is provably on-machine
    for (const k of after) assert.equal(isLocalProvider(k), true, `${k} must be local`);
  } finally {
    delete process.env.MODEL_PROVIDER;
    clearPolicy();
  }
});

test('the health snapshot reports local vs remote and the active policy', () => {
  clearPolicy();
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  try {
    const snap = providerHealthSnapshot();
    const kilo = snap.find((r) => r.key === 'kilo');
    // configured (keyless) AND remote AND not allowed — three different facts
    assert.equal(kilo.configured, true);
    assert.equal(kilo.local, false);
    assert.equal(kilo.allowed, false);
    const ollama = snap.find((r) => r.key === 'ollama');
    if (ollama) assert.equal(ollama.local, true);
    const net = providerNetworkSummary();
    assert.equal(net.policy, 'local-only');
    assert.equal(net.localOnly, true);
    assert.equal(net.remoteAllowed, false);
  } finally {
    clearPolicy();
  }
});

/* ═══ 3. the walk: local succeeds, no remote fallback ═════════════════════ */

test('local provider succeeds → no remote fallback occurs', { timeout: 60_000 }, async () => {
  const { server, port, seen } = await startLocalModel();
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${port}`;
  process.env.MODEL_NAME = 'local-model';
  clearPolicy(); // allow-remote: remote legs exist but must not be needed
  try {
    const answer = await generateContent(uniq('hello'), 'You are JEXI.', null, {});
    assert.ok(String(answer).includes('LOCAL[local-model]'), `local answer expected, got: ${answer}`);
    assert.equal(seen.chats, 1);
    // only the loopback provider was ever dialed
    assert.deepEqual(attemptedProviders(), ['ollama']);
    assert.deepEqual(remoteAttempts, [], 'no remote egress on the happy path');
    assert.equal(dialed.length, 1, 'exactly one real dial (the loopback chat)');
    assert.ok(dialed.every(isLoopbackUrl), 'every dial was loopback');
  } finally {
    server.close();
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; delete process.env.MODEL_NAME;
  }
});

test('local provider FAILS under local-only → no outbound provider attempt at all', { timeout: 60_000 }, async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9'; // nothing listens — the local lane dies
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  resetProviderHealth('ollama');
  installAttemptGuard(); // the decisive gate: a permitted REMOTE slot throws loudly
  try {
    await assert.rejects(
      () => generateContent(uniq('hello'), 'sys', null, {}),
      (e) => {
        // the error must be honest about WHY nothing answered
        assert.match(String(e.message), /local-only/);
        assert.match(String(e.message), /remote providers were not attempted/);
        return true;
      },
    );
    // The decisive assertion: NO remote provider was dialed. Before the fix,
    // this walk reached kilo and pollinations.
    assert.deepEqual(remoteAttempts, [], 'local-only must produce ZERO remote egress');
    // the local endpoint IS dialed (and fails) — but every dial stays on-machine
    assert.ok(dialed.length >= 1, 'the local provider was really dialed');
    assert.ok(dialed.every(isLoopbackUrl), 'every dial stayed loopback');
    const tried = attemptedProviders();
    assert.ok(tried.every((p) => isLocalProvider(p)), `only local attempts allowed, saw: ${tried.join(', ')}`);
    assert.ok(refusedProviders().includes('kilo'), 'kilo refused at the boundary');
    assert.ok(refusedProviders().includes('pollinations'), 'pollinations refused at the boundary');
  } finally {
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; delete process.env.JEXI_NETWORK_POLICY;
  }
});

test('explicit remote fallback stays available when the policy allows it', { timeout: 90_000 }, async () => {
  // Local dies; the remote rung is a LOOPBACK fixture standing in for a real
  // remote endpoint (the guard would reject a real one). This proves the
  // fallback MECHANISM is untouched when the policy permits remote.
  const remote = await startLocalModel((m) => `REMOTE-RUNG[${m}]`);
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  process.env.NVIDIA_API_URL = `http://127.0.0.1:${remote.port}/v1`;
  process.env.NVIDIA_API_KEY = 'test-seam-key';
  clearPolicy(); // allow-remote (the default)
  try {
    const answer = await generateContent(uniq('Reply with the single word: online'), 'You are JEXI OS.', null, {});
    assert.ok(String(answer).includes('REMOTE-RUNG'), `remote rung must answer — got: ${answer}`);
    // the walk reached the remote rung; the accounting names the real attempts
    const tried = attemptedProviders();
    assert.ok(tried.includes('nvidia'), `attempted list must record nvidia: ${tried.join(', ')}`);
    assert.ok(tried.includes('ollama'), 'the failed local attempt is recorded too');
    // a real dial happened at the remote rung's loopback fixture
    assert.ok(dialed.some((u) => u.includes(`127.0.0.1:${remote.port}`)), 'the remote rung was really dialed');
  } finally {
    remote.server.close();
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST;
    delete process.env.NVIDIA_API_URL; delete process.env.NVIDIA_API_KEY;
  }
});

test('all providers fail → JEXI reports the failure honestly (no fake answer)', { timeout: 60_000 }, async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  clearPolicy();
  resetProviderHealth('ollama');
  try {
    let threw = null;
    try { await generateContent(uniq('hello'), 'sys', null, {}); } catch (e) { threw = e; }
    assert.ok(threw, 'a total failure must reject — never a canned answer');
    assert.match(String(threw.message), /provider/i);
    // This suite runs under the DEFAULT (allow-remote) policy, so remote rungs
    // may be attempted — but the egress guard intercepted every non-loopback
    // dial, so NO real external service was ever contacted.
    for (const url of remoteAttempts) assert.ok(!isLoopbackUrl(url), 'guard only logs remote dials');
    assert.ok(remoteAttempts.length === 0 || remoteAttempts.every((u) => !isLoopbackUrl(u)));
  } finally {
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST;
  }
});

test('generateContentSafe stays hermetic under local-only (no local backend → honest degraded text, zero egress)', { timeout: 60_000 }, async () => {
  // generateContentSafe never throws: on failure it tries the local backend,
  // then returns honest degraded text. Its local probe must also honor the
  // policy — under local-only it must not leak a remote dial.
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  resetProviderHealth('ollama');
  installAttemptGuard();
  try {
    const res = await generateContentSafe(uniq('hello'), 'sys', null, {});
    assert.equal(res.ok, false, 'no provider answered → honest failure object');
    assert.equal(res.degraded, true);
    assert.match(String(res.text), /degraded/i, 'the degraded message is returned, never a fake answer');
    assert.deepEqual(remoteAttempts, [], 'generateContentSafe must not leak remote egress under local-only');
  } finally {
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; delete process.env.JEXI_NETWORK_POLICY;
  }
});

/* ═══ 4. tool lane also passes the boundary ═══════════════════════════════ */

test('the tool lane does not dial a remote provider under local-only', { timeout: 60_000 }, async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  resetProviderHealth('ollama');
  installAttemptGuard(); // a permitted remote slot in the tool lane must throw loudly
  const tools = [{ slug: 'fs_read', name: 'fs_read', desc: 'read', args: { path: { type: 'string' } } }];
  try {
    let threw = null;
    try {
      await generateWithToolsLoop(uniq('read a file'), 'You are JEXI.', tools, { maxIterations: 1 });
    } catch (e) { threw = e; }
    assert.ok(threw, 'tool lane must fail honestly when only remote providers remain');
    assert.deepEqual(remoteAttempts, [], 'tool lane must not leak remote egress under local-only');
    assert.ok(dialed.every(isLoopbackUrl), 'tool lane dials stayed loopback');
    const tried = attemptedProviders();
    assert.ok(tried.every((p) => isLocalProvider(p)), `only local attempts allowed, saw: ${tried.join(', ')}`);
  } finally {
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; delete process.env.JEXI_NETWORK_POLICY;
  }
});

/* ═══ 5. accounting: the attempted list is real, not a flag ═══════════════ */

test('the attempted-provider list records what was dialed, with reasons for refusals', { timeout: 60_000 }, async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  resetProviderHealth('ollama');
  installAttemptGuard();
  try {
    await generateContent(uniq('hello'), 'sys', null, {}).catch(() => {});
    const log = policyAuditLog();
    assert.ok(log.length >= 1, 'the audit log records every decision');
    const kilo = log.find((r) => r.provider === 'kilo');
    assert.ok(kilo, 'kilo was considered and refused');
    assert.equal(kilo.allowed, false);
    assert.equal(kilo.policy, 'local-only');
    assert.match(kilo.reason, /local-only/);
    // the refused list and the attempted list are disjoint by construction
    for (const p of attemptedProviders()) assert.ok(!refusedProviders().includes(p));
  } finally {
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; delete process.env.JEXI_NETWORK_POLICY;
  }
});

/* ═══ 6. the policy cannot bypass permissions / safeguards ════════════════ */

test('pinning a remote provider cannot bypass the boundary (tighten-only holds)', () => {
  clearPolicy();
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  try {
    // An explicit per-call request to widen is refused; a pinned remote
    // provider is still refused. The policy is not a permission backdoor.
    const verdict = providerAllowed('kilo', { policy: resolveEffectivePolicy({ networkPolicy: 'allow-remote' }) });
    assert.equal(verdict.allowed, false);
    const rec = beginProviderAttempt('kilo', { networkPolicy: 'allow-remote' });
    assert.equal(rec.allowed, false);
    assert.deepEqual(attemptedProviders(), [], 'a refused provider is never "attempted"');
    // filterProvidersByPolicy never ADDS a provider — it only removes
    const input = ['ollama', 'kilo', 'groq'];
    const out = filterProvidersByPolicy(input, { env: { JEXI_NETWORK_POLICY: 'local-only' } });
    assert.deepEqual(out, ['ollama']);
    for (const k of out) assert.ok(input.includes(k), 'no provider is invented');
  } finally {
    clearPolicy();
  }
});

test('the policy layer does not consult or alter tool permissions', () => {
  // The fallback policy is orthogonal to the tool/permission system: it is a
  // pure provider-selection filter. Proven by shape — the decision carries no
  // tool/permission state and the filter cannot grant anything.
  const before = providerAllowed('groq', { policy: NETWORK_POLICIES.ALLOW_REMOTE });
  assert.deepEqual(Object.keys(before).sort(), ['allowed', 'policy', 'reason']);
  assert.equal(typeof before.allowed, 'boolean');
  // Under local-only, allow-remote is the only widened value and it is refused.
  const gated = providerAllowed('groq', { policy: NETWORK_POLICIES.LOCAL_ONLY });
  assert.equal(gated.allowed, false);
  // filterProvidersByPolicy is a strict subset operation
  const wide = ['ollama', 'groq', 'kilo', 'pollinations'];
  const narrow = filterProvidersByPolicy(wide, { env: { JEXI_NETWORK_POLICY: 'local-only' } });
  assert.ok(narrow.length <= wide.length);
  assert.deepEqual([...new Set(narrow)], narrow, 'no duplicates invented');
});

/* ═══ 7. F1 — the lane-object shape must be classified by KEY ═════════════ */

test('F1: filterProvidersByPolicy classifies {key,model} lane objects by their key', () => {
  // runtimeChain() hands out lane OBJECTS, not id strings. The old filter
  // stringified them ("[object Object]" → unknown) and dropped even the local
  // lane under local-only. Classification must read the real provider id.
  assert.equal(providerKeyOf({ key: 'ollama', model: 'qwen3' }), 'ollama');
  assert.equal(providerKeyOf({ provider: 'kilo' }), 'kilo');
  assert.equal(providerKeyOf({ id: 'pollinations' }), 'pollinations');
  assert.equal(providerKeyOf('groq'), 'groq');

  const lanes = [{ key: 'ollama', model: 'qwen3' }, { key: 'kilo' }, { key: 'pollinations', model: 'openai' }];
  // allow-remote: untouched, original objects preserved
  const wide = filterProvidersByPolicy(lanes, { env: {} });
  assert.deepEqual(wide, lanes);
  // local-only: the local lane survives WITH its model; remotes are removed
  const narrow = filterProvidersByPolicy(lanes, { env: { JEXI_NETWORK_POLICY: 'local-only' } });
  assert.deepEqual(narrow, [{ key: 'ollama', model: 'qwen3' }]);
  // an unidentifiable entry is refused (fail-safe), never treated as local
  const unknown = filterProvidersByPolicy([{ model: 'x' }], { env: { JEXI_NETWORK_POLICY: 'local-only' } });
  assert.deepEqual(unknown, []);
});

test('F1: runtimeChain keeps the local leg and drops remotes under local-only', () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
  clearPolicy();
  try {
    const wide = runtimeChain('coder');
    assert.ok(wide.length > 0, 'the chain is non-empty by default');
    assert.ok(wide.every((l) => l && typeof l === 'object' && l.key), 'lanes are {key,...} objects');
    assert.ok(wide.some((l) => l.key === 'kilo'), 'keyless remote floor present by default');

    process.env.JEXI_NETWORK_POLICY = 'local-only';
    const narrow = runtimeChain('coder');
    assert.ok(narrow.length > 0, 'the LOCAL leg must survive local-only (the F1 regression)');
    assert.ok(narrow.some((l) => l.key === 'ollama'), 'ollama stays in the chain');
    assert.ok(!narrow.some((l) => l.key === 'kilo'), 'kilo removed');
    assert.ok(!narrow.some((l) => l.key === 'pollinations'), 'pollinations removed');
    for (const l of narrow) assert.equal(isLocalProvider(l.key), true, `${l.key} must be local`);
  } finally {
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; clearPolicy();
  }
});

/* ═══ 8. F2 — testProvider() is a real dial and must pass the boundary ════ */

test('F2: testProvider() refuses a remote provider under local-only (no dial)', { timeout: 60_000 }, async () => {
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  __resetPolicyAudit();
  installAttemptGuard();
  try {
    const r = await testProvider('kilo');
    assert.equal(r.ok, false, 'a remote provider test cannot succeed under local-only');
    assert.equal(r.blocked, true, 'the refusal is explicit, not a generic failure');
    assert.match(String(r.error), /local-only/, 'the reason names the policy');
    assert.deepEqual(remoteAttempts, [], 'testProvider must not dial a remote endpoint');
    assert.equal(attemptedProviders().includes('kilo'), false, 'no permitted attempt was recorded');
  } finally {
    clearPolicy();
  }
});

test('F2: testProvider() still dials a permitted LOCAL provider under local-only', { timeout: 60_000 }, async () => {
  const { server, port, seen } = await startLocalModel();
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${port}`;
  process.env.MODEL_NAME = 'local-model';
  process.env.JEXI_NETWORK_POLICY = 'local-only';
  resetProviderHealth('ollama');
  try {
    const r = await testProvider('ollama');
    assert.equal(r.ok, true, `the local provider test must work, got: ${JSON.stringify(r)}`);
    assert.notEqual(r.blocked, true);
    assert.ok(seen.chats >= 1, 'the loopback endpoint was actually dialed');
    assert.deepEqual(remoteAttempts, [], 'no remote egress');
  } finally {
    server.close();
    delete process.env.MODEL_PROVIDER; delete process.env.OLLAMA_HOST; delete process.env.MODEL_NAME; clearPolicy();
  }
});

test('F2: testProvider() under allow-remote is gated only by the boundary, not blocked', { timeout: 60_000 }, async () => {
  clearPolicy(); // allow-remote
  __resetPolicyAudit();
  try {
    const r = await testProvider('kilo');
    // allowed by POLICY → the dial is attempted; our egress guard stops it and
    // the failure is a network error, NOT a policy refusal.
    assert.notEqual(r.blocked, true, 'allow-remote must not set the blocked flag');
    assert.ok(remoteAttempts.length >= 1, 'the remote dial was attempted under allow-remote');
    assert.equal(attemptedProviders().includes('kilo'), true, 'the attempt was recorded as permitted');
  } finally {
    remoteAttempts.length = 0;
  }
});

/* ═══ 9. F3 — generateContentSafe → OfflineAgent → queryLocalLLM ═════════ */

test('F3: the degraded local path cannot reach a non-loopback endpoint without the explicit exposure opt-in', { timeout: 60_000 }, async () => {
  // The pre-existing exposure guard (OllamaAdapter.checkBind →
  // OllamaExposureError) is the control here: a non-loopback "local" bind is
  // refused unless ALLOW_OLLAMA_EXPOSED=1. This test pins that control so a
  // future change cannot silently turn the local fallback into remote egress.
  delete process.env.ALLOW_OLLAMA_EXPOSED;
  const { OllamaAdapter } = await import('../../src/providers/adapters/ollama.js');
  const adapter = new OllamaAdapter({ baseUrl: 'http://192.168.1.50:11434' }, {});
  assert.equal(adapter.baseUrl, 'http://192.168.1.50:11434');
  const exposure = adapter.exposure();
  assert.equal(exposure.exposed, true, 'the guard SEES the non-loopback bind');
  await assert.rejects(
    () => adapter.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'x', timeoutMs: 3000 }),
    (e) => e && e.code === 'E_OLLAMA_EXPOSED',
    'a non-loopback local bind is refused without ALLOW_OLLAMA_EXPOSED=1',
  );
  assert.deepEqual(remoteAttempts, [], 'no dial reached the non-loopback endpoint');
});

