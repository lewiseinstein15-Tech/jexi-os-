/**
 * M8 — HERMETIC TEST ENVIRONMENT (the harness proves itself).
 *
 * The suite runs under `npm test`, which preloads tests/setup/hermetic-preload.mjs
 * into every child. Importing that module here (same URL -> same instance) also
 * installs the guard, so these assertions pin the properties that make the
 * aggregate deterministic and fail loudly if a future change removes them:
 *
 *   1. the harness is wired (the preload is registered for the process);
 *   2. a non-loopback dial is REFUSED on every transport (fetch, node-fetch,
 *      https.request) and the refusal is recorded;
 *   3. loopback still works - local test servers are not collateral damage;
 *   4. the guard blocks regardless of the network policy (defence in depth);
 *   5. creating a mission does not spawn a language server in a test process
 *      (the leaked-child hang M8 fixed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { refusedEgress } from '../setup/hermetic-preload.mjs';

const PRELOADED = /hermetic-preload\.mjs/.test(process.env.NODE_OPTIONS || '');
const NEEDS_HARNESS = 'run under `npm test` (the hermetic harness) to exercise this';

test('the harness registers the preload for the process', { skip: PRELOADED ? false : NEEDS_HARNESS }, () => {
  assert.match(process.env.NODE_OPTIONS, /hermetic-preload\.mjs/);
  assert.equal(process.env.JEXI_TEST_HARNESS, '1', 'product code sees the test-process marker');
});

test('a non-loopback fetch is refused loudly and recorded', async () => {
  const before = refusedEgress.length;
  await assert.rejects(() => fetch('https://api.kilo.ai/hermetic-probe'), /EGRESS GUARD/);
  assert.equal(refusedEgress.length, before + 1, 'the refusal was recorded');
  assert.match(refusedEgress.at(-1).url, /api\.kilo\.ai/);
});

test('a non-loopback node-fetch is refused', async () => {
  const nodeFetch = (await import('node-fetch')).default;
  await assert.rejects(() => nodeFetch('https://api.kilo.ai/hermetic-probe'), /EGRESS GUARD/);
});

test('a non-loopback https.request is refused', async () => {
  // Default-object form, which is what node-fetch/axios/undici use internally.
  // (ESM *named* imports of node:https are immune to this by language design —
  // no src module uses that form, so coverage is complete.)
  const https = (await import('node:https')).default;
  await assert.rejects(
    () => new Promise((resolve, reject) => {
      const req = https.request('https://api.kilo.ai/hermetic-probe', resolve);
      req.on('error', reject);
      req.end();
    }),
    /EGRESS GUARD/
  );
});

test('loopback still works (local test servers are not blocked)', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(await res.text(), 'ok');
  await new Promise((r) => server.close(r));
});

test('the guard blocks regardless of the network policy (defence in depth)', async () => {
  const prev = process.env.JEXI_NETWORK_POLICY;
  process.env.JEXI_NETWORK_POLICY = 'allow-remote';
  try {
    await assert.rejects(() => fetch('https://api.kilo.ai/hermetic-probe'), /EGRESS GUARD/);
  } finally {
    if (prev === undefined) delete process.env.JEXI_NETWORK_POLICY;
    else process.env.JEXI_NETWORK_POLICY = prev;
  }
});

test('creating a mission does not spawn a language server in a test process', async () => {
  const { MissionRunner } = await import('../../src/services/director/MissionRunner.js');
  const { lspManager } = await import('../../src/lsp/index.js');
  const { recent } = await import('../../src/services/Observer.js');

  const runner = new MissionRunner(); // llm stays null — create() needs none
  const mission = runner.create({ conversationId: 'hermetic-m8', objective: 'prove no language server is spawned', budgets: {} });
  assert.ok(mission && mission.id, 'mission still created (the gate changed no semantics)');
  assert.ok(recent({ limit: 50, typePrefix: 'mission.created' }).length >= 1, 'mission.created still emitted');

  // A spawn would show up as a running language server almost immediately.
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(lspManager().status().running.length, 0, 'no language server was spawned for a test mission');
});
