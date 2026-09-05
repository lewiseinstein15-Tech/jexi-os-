/**
 * AGI Phase 2 — MCP gateway contracts. Keyless, deterministic: a fake
 * connector stands in for real MCP servers; the REGISTRY under test is the
 * real shipped mcp/registry.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATA_DIR = './data/test-agi-mcp';

const {
  loadRegistry, effectiveRegistry, enableMcpServer, disableMcpServer,
  connectGatewayServer, mcpToolsUnified, invokeMcpTool, mcpServerHealth,
  __setConnector, __resetGateway,
} = await import('../../src/services/MCPGateway.js');

const REGISTRY = new URL('../../../mcp/registry.json', import.meta.url).pathname;

/* A fake MCP server used via the injectable connector. */
function fakeServer(tools, behavior = {}) {
  const state = { calls: [] };
  return {
    state,
    async listTools() { return { tools }; },
    async callTool({ name, arguments: args }) {
      state.calls.push({ name, args });
      if (behavior.slow) await new Promise((r) => setTimeout(r, behavior.slow));
      if (behavior.failFor === name) throw new Error(behavior.error || 'tool exploded');
      return { content: [{ type: 'text', text: `ok:${name}` }] };
    },
  };
}

/* ═══ 1. the shipped registry ═══════════════════════════════════════════ */

test('the shipped registry is valid; enabled defaults are curated-only (Lewis switched them on Sept 2026)', () => {
  const reg = loadRegistry(REGISTRY);
  assert.ok(reg.servers.length >= 5);
  for (const s of reg.servers) {
    // Policy update (Lewis, Sept 2026): curated servers MAY ship enabled.
    // The invariants that still hold: community-trust ships disabled, and
    // every entry carries an explicit permission boundary.
    if (s.trustLevel === 'community') assert.equal(s.enabled, false, `${s.name} (community) must ship disabled`);
    assert.ok(s.permissions.length, `${s.name} needs an explicit permission boundary`);
    assert.ok(['curated', 'community'].includes(s.trustLevel));
  }
});

test('no shipped server holds the DESTRUCTIVE grant', () => {
  const reg = loadRegistry(REGISTRY);
  for (const s of reg.servers) assert.ok(!s.permissions.includes('DESTRUCTIVE'), `${s.name} must not ship DESTRUCTIVE`);
});

test('community-trust servers cannot be enabled without force (review first)', () => {
  const pw = loadRegistry(REGISTRY).servers.find((s) => s.name === 'playwright');
  assert.equal(pw.trustLevel, 'community');
  const no = enableMcpServer('playwright', { force: false });
  assert.equal(no.ok, false);
  assert.match(no.error, /force/);
  assert.equal(effectiveRegistry(REGISTRY).servers.find((s) => s.name === 'playwright').enabled, false);
});

/* ═══ 2. enable/disable lifecycle ═══════════════════════════════════════ */

test('enable + disable persist as runtime state over the shipped defaults', () => {
  assert.equal(enableMcpServer('fetch', { force: true }).ok, true);
  assert.equal(effectiveRegistry(REGISTRY).servers.find((s) => s.name === 'fetch').enabled, true);
  assert.equal(disableMcpServer('fetch').ok, true);
  assert.equal(effectiveRegistry(REGISTRY).servers.find((s) => s.name === 'fetch').enabled, false);
  assert.equal(enableMcpServer('no-such-server').ok, false);
});

/* ═══ 3. connection + discovery ═════════════════════════════════════════ */

test('a disabled server cannot connect; an enabled one can, and discovery wraps its tools', async () => {
  __resetGateway();
  const off = await connectGatewayServer('sqlite', { registryPath: REGISTRY });
  assert.equal(off.ok, false);
  assert.match(off.error, /not enabled/);

  enableMcpServer('sqlite', { force: true });
  const fake = fakeServer([
    { name: 'read_query', description: 'Run a read-only SQL query', inputSchema: { type: 'object' } },
    { name: 'list_tables', description: 'List tables', inputSchema: { type: 'object' } },
  ]);
  __setConnector(async () => fake);
  const on = await connectGatewayServer('sqlite', { registryPath: REGISTRY });
  assert.equal(on.ok, true);
  assert.equal(on.tools, 2);

  const unified = mcpToolsUnified();
  assert.equal(unified.length, 2);
  for (const t of unified) {
    assert.equal(t.source, 'mcp');
    assert.equal(t.server, 'sqlite');
    assert.ok(t.id.startsWith('mcp:sqlite:'));
    assert.deepEqual(t.permissions, ['READ_ONLY']);
    assert.equal(t.risk, 'safe'); // read-only server → safe tools
    assert.ok(typeof t.timeoutMs === 'number');
  }
  disableMcpServer('sqlite');
});

/* ═══ 4. the permission boundary ════════════════════════════════════════ */

test('a destructive tool is REFUSED on a server without the DESTRUCTIVE grant', async () => {
  __resetGateway();
  enableMcpServer('memory', { force: true }); // READ_ONLY + LOCAL_WRITE, no DESTRUCTIVE
  __setConnector(async () => fakeServer([
    { name: 'create_entities', description: 'create', inputSchema: {} },
    { name: 'delete_all_graphs', description: 'wipe everything', annotations: { destructiveHint: true } },
  ]));
  await connectGatewayServer('memory', { registryPath: REGISTRY });

  const refused = await invokeMcpTool({ server: 'memory', tool: 'delete_all_graphs', args: {}, authorized: true });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /DESTRUCTIVE permission/);
  disableMcpServer('memory');
});

test('destructive-looking tools need explicit authorization even when granted', async () => {
  __resetGateway();
  // hand the memory server a DESTRUCTIVE grant via a temp registry copy
  const tmp = process.env.DATA_DIR + '/registry-destructive.json';
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const mem = reg.servers.find((s) => s.name === 'memory');
  mem.name = 'memory-destructive-test';
  mem.permissions.push('DESTRUCTIVE');
  mem.enabled = true;
  fs.writeFileSync(tmp, JSON.stringify(reg));

  __setConnector(async () => fakeServer([{ name: 'delete_graph', description: 'delete one graph' }]));
  await connectGatewayServer('memory-destructive-test', { registryPath: tmp });

  const unauthorized = await invokeMcpTool({ server: 'memory-destructive-test', tool: 'delete_graph' });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.error, /explicit authorization/);

  const authorized = await invokeMcpTool({ server: 'memory-destructive-test', tool: 'delete_graph', authorized: true });
  assert.equal(authorized.ok, true);
});

test('normal tools run and return results; unknown tools are refused', async () => {
  __resetGateway();
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const f = reg.servers.find((s) => s.name === 'fetch');
  f.name = 'fetch-run-test';
  f.enabled = true;
  const tmp = process.env.DATA_DIR + '/registry-fetch.json';
  fs.writeFileSync(tmp, JSON.stringify(reg));
  const fake = fakeServer([{ name: 'fetch_url', description: 'fetch a url', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } }]);
  __setConnector(async () => fake);
  await connectGatewayServer('fetch-run-test', { registryPath: tmp });

  const ok = await invokeMcpTool({ server: 'fetch-run-test', tool: 'fetch_url', args: { url: 'https://example.com' } });
  assert.equal(ok.ok, true);
  assert.equal(fake.state.calls.length, 1);

  const unknown = await invokeMcpTool({ server: 'fetch-run-test', tool: 'not_a_tool' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown tool/);
});

test('tool calls time out instead of hanging forever', async () => {
  __resetGateway();
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const fx = reg.servers.find((s) => s.name === 'fetch');
  fx.name = 'fetch-slow-test';
  fx.enabled = true;
  const tmp = process.env.DATA_DIR + '/registry-slow.json';
  fs.writeFileSync(tmp, JSON.stringify(reg));
  __setConnector(async () => fakeServer([{ name: 'fetch_url', description: 'slow fetch' }], { slow: 500 }));
  await connectGatewayServer('fetch-slow-test', { registryPath: tmp });
  const t0 = Date.now();
  const out = await invokeMcpTool({ server: 'fetch-slow-test', tool: 'fetch_url', timeoutMs: 40 });
  assert.equal(out.ok, false);
  assert.match(out.error, /timed out/);
  assert.ok(Date.now() - t0 < 400);
});

/* ═══ 5. health + audit ═════════════════════════════════════════════════ */

test('server health reflects connection state, calls, and failures', async () => {
  __resetGateway();
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const g = reg.servers.find((s) => s.name === 'filesystem');
  g.name = 'fs-health-test';
  g.enabled = true;
  const tmp = process.env.DATA_DIR + '/registry-fs.json';
  fs.writeFileSync(tmp, JSON.stringify(reg));
  __setConnector(async () => fakeServer([
    { name: 'list_directory', description: 'list' },
    { name: 'read_file', description: 'read' },
  ], { failFor: 'read_file', error: 'not a file' }));
  await connectGatewayServer('fs-health-test', { registryPath: tmp });
  await invokeMcpTool({ server: 'fs-health-test', tool: 'list_directory' });
  await invokeMcpTool({ server: 'fs-health-test', tool: 'read_file' });
  await invokeMcpTool({ server: 'fs-health-test', tool: 'read_file' });

  const h = mcpServerHealth().find((s) => s.name === 'fs-health-test');
  assert.equal(h.status, 'connected');
  assert.equal(h.enabled, true);
  assert.equal(h.tools, 2);
  assert.equal(h.calls, 3);
  assert.equal(h.failures, 2);
  assert.match(h.lastError, /not a file/);
  assert.ok(h.lastSuccessAt);

  // audit log recorded the invocations (bounded JSONL)
  const audit = fs.readFileSync(process.env.DATA_DIR + '/mcp-audit.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(audit.some((e) => e.type === 'MCP_CONNECTED' && e.server === 'fs-health-test'));
  assert.ok(audit.some((e) => e.type === 'MCP_INVOKE' && e.tool === 'list_directory'));
  assert.ok(audit.some((e) => e.type === 'MCP_INVOKE_FAILED' && e.tool === 'read_file'));
});
