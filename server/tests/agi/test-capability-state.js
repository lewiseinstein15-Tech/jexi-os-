/**
 * JEXI OS — capability-state truthfulness regression tests (Phase 2A).
 *
 * Guards the confirmed defect: `describeCapability` computed `available` as
 * `registered && hasEngine && permitted` and NEVER consulted the runtime risk
 * guard. Seven capabilities (terminal, git, browser, delegation, data, github,
 * code_intel) declare `runtimeRing: 2` on every tool provider, so the guard
 * refuses them at the active `container` ring — yet they were reported
 * `available: true` and the model was told "Available now: terminal".
 *
 * These tests pin the six distinct concepts the mission requires:
 *   registered → discoverable → permitted → reachable → executable → succeeded
 *
 * `sandboxRing` is injected explicitly so the assertions are deterministic and
 * independent of the host's sandbox backend. A final test checks the live
 * environment's own detection for consistency. Nothing here weakens the guard;
 * the assertions run the SAME `makeRiskGuard` the executor runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-capstate-'));

const {
  describeCapability, listCapabilityStatesAsync, capabilitySummaryAsync, primeCapabilities,
} = await import('../../src/capability/registry/registry.js');
const { makeRiskGuard } = await import('../../src/tools/execution/risk-guard.js');
const { getTool } = await import('../../src/tools/registry/ToolRegistry.js');
const { detectSandboxBackends } = await import('../../src/services/Sandbox.js');
const { domainDispatch } = await import('../../src/tools/domains/executor.js');

const RING = 'container';

/* ── the core defect: a ring-blocked capability is not executable ───────── */

test('capability truth: a capability the ring guard blocks is NOT executable', async () => {
  await primeCapabilities();
  // Every tool provider of `terminal` is ring 2; the container ring allows 1.
  const d = describeCapability('terminal', { sandboxRing: RING });
  assert.equal(d.registered, true, 'terminal must still be registered');
  assert.equal(d.permitted, true, 'the profile does not block terminal — the RING does');
  assert.equal(d.ringAllowed, false, 'the ring guard must refuse terminal at the container ring');
  assert.equal(d.executable, false, 'a ring-blocked capability must not be executable');
  assert.equal(d.available, false, 'the deprecated alias must not claim a blocked capability runs');
  assert.ok(d.blockedBy.includes('runtime_ring'), `blockedBy must name runtime_ring, got ${d.blockedBy}`);
});

test('capability truth: the same capability IS executable when the ring permits it', async () => {
  await primeCapabilities();
  // Proves the result is derived from the guard, not hard-coded to false.
  const d = describeCapability('terminal', { sandboxRing: 'host' });
  assert.equal(d.ringAllowed, true);
  assert.equal(d.executable, true, 'ring 2 is allowed at the host ring');
  assert.equal(d.available, true);
});

/* ── the six states are distinct ────────────────────────────────────────── */

test('capability truth: a safe read is registered, discoverable, permitted, reachable and executable', async () => {
  await primeCapabilities();
  const d = describeCapability('filesystem_read', { profile: 'auto', sandboxRing: RING });
  assert.equal(d.registered, true);
  assert.equal(d.discoverable, true);
  assert.equal(d.permitted, true);
  assert.equal(d.reachable, true);
  assert.equal(d.executable, true);
  assert.equal(d.succeeded, false, 'nothing has succeeded yet — success is evidence, not promise');
});

test('capability truth: a profile-denied capability is registered but NOT reachable', async () => {
  await primeCapabilities();
  const d = describeCapability('filesystem_write', { profile: 'readonly', sandboxRing: RING });
  assert.equal(d.registered, true, 'it exists in the registry');
  assert.equal(d.permitted, false, 'readonly forbids the medium tier');
  assert.equal(d.reachable, false, 'a capability the runtime would not offer is not reachable');
  assert.equal(d.executable, false);
  assert.ok(d.blockedBy.includes('permission_denied'), `got ${d.blockedBy}`);
});

/* ── invariants that must hold for every capability ─────────────────────── */

test('capability truth: executable ⊆ reachable ⊆ permitted (no capability skips a gate)', async () => {
  await primeCapabilities();
  const states = await listCapabilityStatesAsync({ sandboxRing: RING });
  for (const c of states) {
    if (c.executable) assert.ok(c.reachable, `${c.id}: executable but not reachable`);
    if (c.reachable) assert.ok(c.permitted, `${c.id}: reachable but not permitted`);
    if (c.executable) assert.equal(c.available, c.executable, `${c.id}: alias must equal executable`);
  }
});

test('capability truth: the live sandbox ring never grants MORE than the host ring', async () => {
  await primeCapabilities();
  const backends = detectSandboxBackends();
  const liveRing = backends.docker.available ? 'container' : backends.namespaces ? 'container' : 'host';
  const atLive = (await listCapabilityStatesAsync({ sandboxRing: liveRing })).filter((c) => c.executable).length;
  const atHost = (await listCapabilityStatesAsync({ sandboxRing: 'host' })).filter((c) => c.executable).length;
  assert.ok(atLive <= atHost, 'a stricter ring must never enable more capabilities');
  // The guard itself must agree with the capability report on the ring-2 tools.
  const guard = makeRiskGuard({ sandboxRing: liveRing });
  for (const slug of ['term_execute', 'git_status', 'data_json']) {
    const def = getTool(slug);
    assert.equal(guard.check(def).allowed, false, `${slug} must be refused at the live ring ${liveRing}`);
  }
});

/* ── provider-level honesty (web_search vs web-search, synthetic defs) ──── */

test('capability truth: a synthetic domain provider reports its ring honestly', async () => {
  await primeCapabilities();
  const d = describeCapability('web_search', { sandboxRing: RING });
  const tool = d.providers.find((p) => p.tool === 'web_search');
  assert.ok(tool, 'the web_search domain provider must be listed');
  assert.equal(tool.ringAllowed, false, 'the ring-2 domain provider is refused at container');
  assert.ok(tool.blockedBy.includes('runtime_ring'));
  // An MCP provider is a different execution path — it must not be reported as
  // probed, so a consumer never reads it as a verified live check.
  const mcp = d.providers.find((p) => p.mcpServer);
  assert.ok(mcp, 'web_search has MCP providers');
  assert.equal(mcp.probed, false, 'an MCP provider must not claim it was probed');
});

test('capability truth: the summary separates executable from ring-blocked', async () => {
  await primeCapabilities();
  const s = await capabilitySummaryAsync({ sandboxRing: RING });
  assert.equal(typeof s.executable, 'number', 'summary must expose an executable count');
  assert.equal(typeof s.ringBlocked, 'number', 'summary must expose a ring-blocked count');
  assert.ok(s.ringBlocked >= 1, `terminal/git/etc. are ring-blocked at container, got ${s.ringBlocked}`);
  // A capability is in the AVAILABLE or SUCCEEDED bucket exactly when the guard
  // lets it run — that is the honest partition the summary must satisfy.
  assert.equal(s.available + s.succeeded, s.capabilities.filter((c) => c.executable).length,
    'AVAILABLE + SUCCEEDED must equal the executable set');
  assert.equal(s.executable, s.capabilities.filter((c) => c.executable).length);
  // The buckets still cover the whole catalog (backward compatible).
  assert.equal(s.available + s.registered + s.exists + s.succeeded + s.unavailable, s.total);
});

/* ── Phase 2B F2: the ringBlocked metric is exactly its definition ───────── */

test('capability truth: ringBlocked equals the registered, non-executable, ring-blocked count', async () => {
  await primeCapabilities();
  const s = await capabilitySummaryAsync({ sandboxRing: RING });
  const expected = s.capabilities.filter(
    (c) => c.registered && !c.executable && c.blockedBy.includes('runtime_ring'),
  ).length;
  assert.equal(s.ringBlocked, expected,
    `ringBlocked (${s.ringBlocked}) must equal registered && !executable && runtime_ring (${expected})`);
});

test('capability truth: an executable MCP-backed capability is not counted ring-blocked', async () => {
  await primeCapabilities();
  // web_search has a ring-2 NATIVE provider AND MCP providers that run outside
  // the ring, so the capability itself is executable. Its native provider is
  // still ring-blocked — but the capability must NOT be counted as blocked.
  const d = describeCapability('web_search', { sandboxRing: RING });
  assert.equal(d.executable, true, 'web_search is executable through its MCP providers');
  assert.ok(d.providers.some((p) => p.tool && p.blockedBy?.includes('runtime_ring')),
    'its native provider is ring-blocked');
  assert.equal(d.blockedBy.includes('runtime_ring'), true, 'blockedBy still names the native provider gate');

  const s = await capabilitySummaryAsync({ sandboxRing: RING });
  assert.equal(s.capabilities.find((c) => c.id === 'web_search').blockedBy.includes('runtime_ring'), true);
  // The metric must exclude it: it is executable, so it is not "ring-blocked".
  assert.equal(s.ringBlocked, s.capabilities.filter(
    (c) => c.registered && !c.executable && c.blockedBy.includes('runtime_ring'),
  ).length, 'the metric must not count an executable capability');
});

/* ── Phase 2B F3: the prompt states the RING, not the profile ───────────── */

test('capability prompt: a ring-blocked terminal is reported as a ring limit, not a profile limit', async () => {
  await primeCapabilities();
  const { capabilityPromptBlock } = await import('../../src/services/CapabilityPrompt.js');
  const block = await capabilityPromptBlock({ sandboxRing: RING });
  assert.ok(block.includes('terminal'), 'the block must mention terminal');
  // Find the terminal line and assert it names the ring, not the profile.
  const line = block.split('\n').find((l) => l.trim().startsWith('- terminal:'));
  assert.ok(line, `terminal must be listed as unavailable, block was:\n${block}`);
  assert.match(line, /sandbox ring/i, `the terminal line must name the execution ring: ${line}`);
  assert.doesNotMatch(line, /permission profile/i,
    `the terminal line must NOT blame the permission profile: ${line}`);
});

/* ── Phase 2B F4: the available/executable/succeeded relationship ───────── */

test('capability truth: a capability can hold historical success while currently blocked', async () => {
  await primeCapabilities();
  // `terminal` is ring-blocked at the container ring, but the ledger may record
  // that it succeeded earlier (e.g. on a host-ring run). Historical success is
  // preserved — it is NOT overwritten by the current gate — so the state is
  // SUCCEEDED while `executable` is false. The summary invariant
  // `available + succeeded === executable` therefore holds ONLY while no
  // succeeded capability is currently non-executable.
  const succeeded = new Set(['terminal']);
  const d = describeCapability('terminal', { sandboxRing: RING, succeeded });
  assert.equal(d.executable, false, 'terminal is ring-blocked right now');
  assert.equal(d.succeeded, true, 'historical success must be preserved');
  assert.equal(d.state, 'succeeded', 'the strongest historical claim is SUCCEEDED');
  assert.equal(d.available, false, 'the deprecated alias reflects the CURRENT gate, not history');

  const s = await capabilitySummaryAsync({ sandboxRing: RING, succeeded });
  const exec = s.capabilities.filter((c) => c.executable).length;
  const blockedButSucceeded = s.capabilities.filter((c) => c.succeeded && !c.executable).length;
  assert.ok(blockedButSucceeded >= 1, 'terminal is succeeded-but-blocked');
  // Pin the intended relationship: available + succeeded counts the succeeded
  // bucket once, and the executable set excludes the blocked-but-succeeded
  // capability, so the two differ by exactly that count.
  assert.equal(s.available + s.succeeded - exec, blockedButSucceeded,
    'available + succeeded - executable === succeeded-but-not-executable');
});

/* ── the tool surface the model sees (capability_check) ─────────────────── */

test('capability truth: capability_check reports executability, not just availability', async () => {
  await primeCapabilities();
  const r = await domainDispatch('capability_check', { capability: 'terminal' }, { profile: 'auto' });
  assert.equal(r.ok, true, `capability_check must succeed, got ${JSON.stringify(r).slice(0, 200)}`);
  const entry = (r.result.capabilities || []).find((c) => c.id === 'terminal');
  assert.ok(entry, 'terminal must appear in the report');
  assert.equal(entry.executable, false, 'capability_check must not claim a ring-blocked tool can run');
  assert.ok(Array.isArray(entry.blockedBy) && entry.blockedBy.includes('runtime_ring'),
    `capability_check must explain WHY, got ${JSON.stringify(entry.blockedBy)}`);
  // The old fields stay present (additive change only).
  for (const f of ['state', 'available', 'registered', 'reason']) {
    assert.ok(f in entry, `the legacy field ${f} must remain for compatibility`);
  }
});
