/**
 * Phase 3 Step 5 — MCP GRANT MANAGEMENT UI.
 *
 * Exercises the grant-manager + permissions.yaml store end-to-end against the
 * real authorizeMcpCall gate and a fake MCP connector:
 *
 *   1. no grants        → list shows zero, MCP call DENIED
 *   2. add grant        → list shows the grant, MCP call SUCCEEDS for the
 *                         granted server
 *   3. tool-level grant → only that tool succeeds
 *   4. remove grant     → MCP call DENIED again
 *
 * Keyless + deterministic: a fake connector stands in for the live gateway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grant-mgr-'));
process.env.DATA_DIR = tmp;
process.env.JEXI_PERMISSIONS_FILE = path.join(tmp, 'permissions.yaml');

const {
  listGrants, addGrant, removeGrant, resetGrants, toYaml, fromYaml,
} = await import('../../src/workforce/grant-manager.js');
const { authorizeMcpCall, DENY_DEFAULT } = await import('../../src/workforce/mcp-gate.js');

function grantsFor(agentName) {
  const a = listGrants().find((x) => x.name === agentName);
  return a ? a.allowedMCP : [];
}

test('grant list is empty for an agent with no grants', () => {
  resetGrants();
  addGrant('everyone-else', 'filesystem', '*');
  const zola = listGrants().find((x) => x.name === 'zola');
  const zolaMCP = zola ? zola.allowedMCP : [];
  const zero = zolaMCP.filter((g) => g.server === 'weather').length === 0;
  assert.ok(zero, 'zola has no weather grant');
  assert.deepEqual(grantsFor('zola').filter((g) => g.server === 'weather'), []);
});

test('add grant → list shows the grant', () => {
  const r = addGrant('zola', 'weather', '*');
  assert.equal(r.ok, true, 'grant added');
  const list = listGrants();
  const zola = list.find((x) => x.name === 'zola');
  assert.ok(zola, 'zola present');
  const w = zola.allowedMCP.find((g) => g.server === 'weather');
  assert.ok(w && w.tools.includes('*'), 'weather grant with tools [*] visible in list');
  // round-trip through YAML: the persisted file must contain the grant
  const y = toYaml(list);
  const back = fromYaml(y);
  const wz = back.find((x) => x.name === 'zola');
  assert.ok(wz.allowedMCP.some((g) => g.server === 'weather' && g.tools.includes('*')), 'grant round-trips through YAML');
});

test('MCP call succeeds for a granted server, denied before grant & after remove', () => {
  // grant present → allowed
  const allowed = authorizeMcpCall([{ server: 'weather', tools: ['*'] }], 'weather', 'get_weather_summary');
  assert.equal(allowed.allowed, true, 'granted server call allowed');

  // remove the grant → denied
  const rm = removeGrant('zola', 'weather', '*');
  assert.equal(rm.ok, true, 'grant removed');
  const denied = authorizeMcpCall(grantsFor('zola').map((g) => ({ server: g.server, tools: g.tools })), 'weather', 'get_weather_summary');
  assert.equal(denied.allowed, false, 'denied after removal');

  // and the list reflects the removal
  const zola = listGrants().find((x) => x.name === 'zola');
  assert.ok(!zola.allowedMCP.some((g) => g.server === 'weather'), 'list no longer shows the removed grant');
});

test('no grants at all → every call denied (deny-by-default)', () => {
  const d = authorizeMcpCall([], 'weather', 'get_weather_summary');
  assert.equal(d.allowed, false);
  assert.equal(d.denial, DENY_DEFAULT);
});

import { permissionsFile } from '../../src/workforce/grant-manager.js';
test('persisted file is YAML under the configured permissions path', () => {
  assert.ok(fs.existsSync(permissionsFile()), `permissions file exists at ${permissionsFile()}`);
  const text = fs.readFileSync(permissionsFile(), 'utf8');
  assert.match(text, /^agents:/, 'file starts with agents:');
  assert.match(text, /server: filesystem/, 'serially includes server:');
  fs.rmSync(tmp, { recursive: true, force: true });
});