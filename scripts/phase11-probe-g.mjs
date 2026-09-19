// Phase 11 Scope G — MCP servers probe (P1–P10).
// Real JSON-RPC 2.0 over stdio; P9 goes through the REAL MCPGateway
// (official @modelcontextprotocol/sdk client). No simulation.
//
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = []; const fail = [];
const ok = (cond, label) => { (cond ? pass : fail).push(label); console.log(`  ${cond ? '✅' : '❌'} ${label}`); };

/** Minimal MCP stdio client: newline-delimited JSON-RPC 2.0. */
class McpClient {
  constructor(serverFile) {
    this.child = spawn('node', [serverFile], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (d) => process.stderr.write(`    [server] ${String(d).trim()}\n`));
    this.pending = new Map();
    this.buf = '';
    this.child.stdout.on('data', (d) => {
      this.buf += String(d);
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx); this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const p = this.pending.get(msg.id);
          if (p) { this.pending.delete(msg.id); p(msg); }
        } catch { /* ignore non-JSON */ }
    }
    });
  }
  call(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timeout after ${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) return reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
        resolve(msg.result);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params = {}) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  nextId = 0;
  async close() { try { this.child.stdin.end(); this.child.kill('SIGTERM'); } catch { /* gone */ } }
}

const printJson = (label, obj) => console.log(`  ${label}: ${JSON.stringify(obj)}`);

// ── P1 — registry BEFORE ──
console.log('\n════ P1 — registry before (raw) ════');
{
  const before = JSON.parse(execSync('git show HEAD:server/mcp/registry.json', { cwd: ROOT, encoding: 'utf8' }));
  const hits = before.servers.filter((s) => ['codegraph-mcp', 'reach-mcp'].includes(s.name || s.id));
  console.log(`  servers in committed registry: ${before.servers.length}`);
  console.log(`  codegraph-mcp/reach-mcp entries: ${JSON.stringify(hits)}`);
  ok(hits.length === 0, 'P1 both entries ABSENT before Scope G');
}

// ── P2–P4 — codegraph-mcp ──
console.log('\n════ P2 — codegraph-mcp spawns: initialize (raw) ════');
const cg = new McpClient('capability/code/mcp-server.js');
{
  const init = await cg.call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'phase11-probe-g', version: '1.0.0' },
  }, 15000);
  console.log(`  ${JSON.stringify(init)}`);
  ok(init.serverInfo?.name === 'codegraph-mcp' && typeof init.protocolVersion === 'string', 'P2 initialize returned real capabilities + serverInfo');
  cg.notify('notifications/initialized');
}

console.log('\n════ P3 — codegraph-mcp tools/list ════');
{
  const list = await cg.call('tools/list', {}, 15000);
  console.log(`  tools (${list.tools.length}): ${JSON.stringify(list.tools.map((t) => t.name))}`);
  console.log(`  sample tool (raw): ${JSON.stringify(list.tools.find((t) => t.name === 'search-graph'))}`);
  ok(list.tools.length === 15, 'P3 tools/list returns exactly 15 tools');
  ok(list.tools.every((t) => t.name && t.description && t.inputSchema), 'P3 every tool has name/description/inputSchema');
}

console.log('\n════ P4 — codegraph-mcp tools/call: index-repository then search-graph (real graph) ════');
{
  const t0 = Date.now();
  const idx = await cg.call('tools/call', { name: 'index-repository', arguments: { root: ROOT, project: 'jexi-os', fresh: true } }, 900000);
  const idxBody = JSON.parse(idx.content[0].text);
  console.log(`  index-repository (raw, ${Date.now() - t0}ms wall): ${JSON.stringify(idxBody).slice(0, 300)}`);
  ok(idxBody.ok === true && idxBody.nodes > 0, `P4 index-repository indexed ${idxBody.nodes} nodes / ${idxBody.edges} edges`);

  const sr = await cg.call('tools/call', { name: 'search-graph', arguments: { name: 'readViaBackends', label: 'Function', limit: 5 } }, 30000);
  const srBody = JSON.parse(sr.content[0].text);
  console.log(`  search-graph "readViaBackends" (raw): ${JSON.stringify(srBody).slice(0, 400)}`);
  ok(!sr.isError && Array.isArray(srBody.rows), 'P4 search-graph returned real graph data (rows)');
  const found = JSON.stringify(srBody).includes('readViaBackends');
  ok(found, 'P4 result contains the real function added in Scope F (readViaBackends)');
}

await cg.close();

// ── P5–P7 — reach-mcp ──
console.log('\n════ P5 — reach-mcp spawns: initialize (raw) ════');
const rm = new McpClient('capability/internet/reach/mcp-server.js');
{
  const init = await rm.call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'phase11-probe-g', version: '1.0.0' },
  }, 15000);
  console.log(`  ${JSON.stringify(init)}`);
  ok(init.serverInfo?.name === 'reach-mcp', 'P5 initialize returned real capabilities + serverInfo');
  rm.notify('notifications/initialized');
}

console.log('\n════ P6 — reach-mcp tools/list ════');
{
  const list = await rm.call('tools/list', {}, 15000);
  console.log(`  tools (${list.tools.length}): ${JSON.stringify(list.tools.map((t) => t.name))}`);
  console.log(`  sample tool (raw): ${JSON.stringify(list.tools.find((t) => t.name === 'reach_read'))}`);
  ok(list.tools.length === 8, 'P6 tools/list returns exactly 8 reach tools');
}

console.log('\n════ P7 — reach-mcp tools/call: reach_read + reach_channels (real HTTP) ════');
{
  const ch = await rm.call('tools/call', { name: 'reach_channels', arguments: {} }, 15000);
  const chBody = JSON.parse(ch.content[0].text);
  console.log(`  reach_channels (raw): count=${chBody.count} webIsLast=${chBody.webIsLast} first3=${JSON.stringify(chBody.channels.slice(0, 3).map((c) => c.name))}`);
  ok(chBody.count === 16 && chBody.webIsLast === true, 'P7 reach_channels: 16 channels, web LAST');

  const rr = await rm.call('tools/call', { name: 'reach_read', arguments: { url: 'https://github.com/torvalds/linux' } }, 60000);
  const rrBody = JSON.parse(rr.content[0].text);
  console.log(`  reach_read github/torvalds/linux (raw): backend=${rrBody.backend} routing=${JSON.stringify(rrBody.routing)}`);
  console.log(`  content (raw head): ${JSON.stringify(rrBody.content).slice(0, 220)}`);
  ok(rrBody.ok === true && rrBody.backend === 'rest-api' && rrBody.content?.stars > 0, `P7 reach_read real: ${rrBody.content?.full_name} stars=${rrBody.content?.stars}`);
}
await rm.close();

// ── P8 — registry AFTER ──
console.log('\n════ P8 — registry after (raw) ════');
{
  const after = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/mcp/registry.json'), 'utf8'));
  const hits = after.servers.filter((s) => ['codegraph-mcp', 'reach-mcp'].includes(s.name));
  console.log(JSON.stringify(hits, null, 2));
  console.log(`  (servers in registry: ${after.servers.length})`);
  ok(hits.length === 2 && hits.every((h) => h.transport === 'stdio' && h.command === 'node' && h.enabled === true), 'P8 both entries present with stdio/node/enabled');
}

// ── P9 — the REAL gateway sees them (official SDK client) ──
console.log('\n════ P9 — MCPGateway discovery + real SDK connect ════');
{
  process.env.DATA_DIR = '/tmp/p11g-data';
  process.env.WORKSPACE_DIR = '/tmp/p11g-ws';
  fs.mkdirSync('/tmp/p11g-data', { recursive: true });
  fs.mkdirSync('/tmp/p11g-ws', { recursive: true });
  const gw = await import(path.join(ROOT, 'server/src/services/MCPGateway.js'));
  const eff = gw.effectiveRegistry();
  const mine = eff.servers.filter((s) => ['codegraph-mcp', 'reach-mcp'].includes(s.name));
  console.log(`  effectiveRegistry: ${eff.servers.length} enabled-eligible servers; discovered: [${mine.map((s) => s.name).join(', ')}]`);
  ok(mine.length === 2, 'P9 gateway effectiveRegistry discovers both servers');
  for (const name of ['codegraph-mcp', 'reach-mcp']) {
    try {
      const conn = await gw.connectGatewayServer(name, { registryPath: path.join(ROOT, 'server/mcp/registry.json') });
      console.log(`  gateway connect '${name}' (official SDK): ${JSON.stringify(conn)}`);
      ok(conn.ok === true && conn.tools > 0, `P9 gateway connected ${name} → ${conn.tools} tools discovered`);
    } catch (e) {
      console.log(`  gateway connect '${name}' FAILED: ${String(e.message).slice(0, 200)}`);
      ok(false, `P9 gateway connect ${name}`);
    }
  }
  const unified = gw.mcpToolsUnified().filter((t) => ['codegraph-mcp', 'reach-mcp'].includes(t.server));
  console.log(`  unified tool path (live): ${JSON.stringify(unified.map((t) => ({ id: t.id, live: t.live })))}`);
  ok(unified.filter((t) => t.server === 'codegraph-mcp').length === 15 && unified.filter((t) => t.server === 'reach-mcp').length === 8, 'P9 unified path exposes 15 + 8 live tools');
  for (const name of ['codegraph-mcp', 'reach-mcp']) { try { await gw.disconnectGatewayServer(name); } catch { /* already gone */ } }
}

// ── P10 — registry diff ──
console.log('\n════ P10 — git diff server/mcp/registry.json (raw) ════');
{
  const diff = execSync('git diff server/mcp/registry.json', { cwd: ROOT, encoding: 'utf8' });
  console.log(diff);
  const before = JSON.parse(execSync('git show HEAD:server/mcp/registry.json', { cwd: ROOT, encoding: 'utf8' }));
  const after = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/mcp/registry.json'), 'utf8'));
  const b = before.servers, a = after.servers;
  ok(Object.keys(before).join() === Object.keys(after).join(), 'P10 top-level registry keys unchanged (no invented fields)');
  ok(JSON.stringify(a.slice(0, b.length)) === JSON.stringify(b), 'P10 all 42 pre-existing entries VERBATIM-identical (same order, zero modification)');
  ok(a.length === b.length + 2 && a[a.length - 2].name === 'codegraph-mcp' && a[a.length - 1].name === 'reach-mcp', 'P10 exactly two entries ADDED at the end: codegraph-mcp + reach-mcp');
  const minusLines = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  ok(minusLines.length === 0, 'P10 raw diff has ZERO removed lines (pure addition)');
}

console.log(`\n════ SCOPE G PROBE DONE — ${pass.length} passed, ${fail.length} failed ════`);
process.exit(fail.length === 0 ? 0 : 1);
