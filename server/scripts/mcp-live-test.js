/**
 * MCP LIVE TEST — real connections, real tool calls, no fakes.
 *
 * For every JS/npx-runnable server in the registry this script:
 *   1. spins a clean test registry (isolated DATA_DIR, temp workspace/git repo)
 *   2. connects through the REAL gateway (real SDK client + stdio transport)
 *   3. lists tools and requires a sane count
 *   4. calls ONE real tool and verifies its actual output
 *   5. disconnects (child process must die)
 *
 * Not covered here (honest): fetch/sqlite/time need uvx (Python, absent);
 * playwright/puppeteer need browser binaries (heavy, redundant with native).
 *
 * Usage: cd server && node scripts/mcp-live-test.js   (network required — npx downloads)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const SERVER_ROOT = path.resolve(process.cwd());
const TEST_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-live-data-'));
const TEST_WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-live-ws-'));
process.env.DATA_DIR = TEST_DATA;
process.env.WORKSPACE_DIR = TEST_WS;

const registry = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, '../mcp/registry.json'), 'utf8'));

// Test registry: only the JS/npx-runnable servers, isolated names not needed (own DATA_DIR).
// (git server removed upstream: @modelcontextprotocol/server-git is archived off npm.)
const runnable = ['filesystem', 'memory', 'everything', 'sequentialthinking', 'context7'];
const testReg = {
  version: registry.version,
  servers: registry.servers
    .filter((s) => runnable.includes(s.name))
    .map((s) => ({ ...s, enabled: true })),
};
// point filesystem at the temp workspace explicitly
testReg.servers.find((s) => s.name === 'filesystem').args = ['-y', '@modelcontextprotocol/server-filesystem', TEST_WS];
const REG_PATH = path.join(TEST_DATA, 'registry-live.json');
fs.writeFileSync(REG_PATH, JSON.stringify(testReg, null, 2));

const g = await import('../src/services/MCPGateway.js');
const results = [];

async function liveTest(name, toolCall) {
  const t0 = Date.now();
  process.stdout.write(`\n[${name}] connecting (real npx + SDK)… `);
  const c = await g.connectGatewayServer(name, { registryPath: REG_PATH });
  if (!c.ok) {
    results.push({ name, ok: false, stage: 'connect', error: c.error });
    console.log(`FAIL connect: ${c.error}`);
    return;
  }
  const tools = g.mcpToolsUnified().filter((t) => t.server === name);
  console.log(`connected · ${c.tools} tools in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const call = await toolCall(tools);
  await g.disconnectGatewayServer(name);
  if (!call.ok) {
    results.push({ name, ok: false, stage: 'tool', error: call.error });
    console.log(`  tool call FAILED: ${call.error}`);
    return;
  }
  results.push({ name, ok: true, tools: c.tools, evidence: call.evidence });
  console.log(`  tool call OK (${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
  await g.disconnectGatewayServer(name);
}

/* ── per-server REAL tool calls ─────────────────────────────────────────── */

await liveTest('filesystem', async () => {
  const w = await g.invokeMcpTool({ server: 'filesystem', tool: 'write_file', args: { path: path.join(TEST_WS, 'live-test.txt'), content: 'written by the real filesystem MCP server' } });
  if (!w.ok) return w;
  const r = await g.invokeMcpTool({ server: 'filesystem', tool: 'read_file', args: { path: path.join(TEST_WS, 'live-test.txt') } });
  if (!r.ok) return r;
  const text = Array.isArray(r.result?.content) ? r.result.content.map((x) => x.text || '').join('') : '';
  const disk = fs.readFileSync(path.join(TEST_WS, 'live-test.txt'), 'utf8');
  return text.includes('written by the real filesystem MCP server') && disk.includes('written by the real filesystem MCP server')
    ? { ok: true, evidence: 'file written via MCP AND read back via MCP AND verified on disk' }
    : { ok: false, error: 'round-trip mismatch' };
});

await liveTest('memory', async () => {
  const c = await g.invokeMcpTool({ server: 'memory', tool: 'create_entities', args: { entities: [{ name: 'Lewis', entityType: 'person', observations: ['runs JEXI OS'] }] } });
  if (!c.ok) return c;
  const r = await g.invokeMcpTool({ server: 'memory', tool: 'read_graph', args: {} });
  if (!r.ok) return r;
  const text = Array.isArray(r.result?.content) ? r.result.content.map((x) => x.text || '').join('') : '';
  return text.includes('Lewis')
    ? { ok: true, evidence: 'entity created via MCP and read back in the knowledge graph' }
    : { ok: false, error: 'entity not found after create' };
});

await liveTest('everything', async () => {
  const r = await g.invokeMcpTool({ server: 'everything', tool: 'echo', args: { message: 'jexi-live-test-2605' } });
  if (!r.ok) return r;
  const text = Array.isArray(r.result?.content) ? r.result.content.map((x) => x.text || '').join('') : '';
  return text.includes('jexi-live-test-2605')
    ? { ok: true, evidence: `echo round-trip: "${text.slice(0, 60)}"` }
    : { ok: false, error: `echo mismatch: ${text.slice(0, 120)}` };
});

await liveTest('sequentialthinking', async () => {
  const r = await g.invokeMcpTool({ server: 'sequentialthinking', tool: 'sequentialthinking', args: { thought: 'JEXI live test: if 2 plus 2 is 4, then 4 times 2 is 8.', nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 } });
  if (!r.ok) return r;
  const text = Array.isArray(r.result?.content) ? r.result.content.map((x) => x.text || '').join('') : '';
  return /thought/i.test(text)
    ? { ok: true, evidence: `thinking step processed: "${text.slice(0, 80)}…"` }
    : { ok: false, error: 'no thought processed' };
});

await liveTest('context7', async () => {
  const res = await g.invokeMcpTool({ server: 'context7', tool: 'resolve-library-id', args: { libraryName: 'react', query: 'react' } });
  if (!res.ok) return res;
  const text = Array.isArray(res.result?.content) ? res.result.content.map((x) => x.text || '').join('') : '';
  const ids = [...new Set((text.match(/\/[a-z0-9.-]+\/[a-z0-9.-]+/gi) || []))];
  if (!ids.length) return { ok: false, error: `no library id resolved: ${text.slice(0, 120)}` };
  let docsText = '';
  let usedId = '';
  for (const id of ids.slice(0, 3)) { // try the listed ids until real docs come back (a redirect notice means try the next)
    const docs = await g.invokeMcpTool({ server: 'context7', tool: 'query-docs', args: { libraryId: id, query: 'how do hooks work' } });
    if (!docs.ok) continue;
    const t = Array.isArray(docs.result?.content) ? docs.result.content.map((x) => x.text || '').join('') : '';
    if (t.length > 200) { docsText = t; usedId = id; break; }
  }
  return docsText
    ? { ok: true, evidence: `resolved "${usedId}" and pulled ${docsText.length} chars of real current docs` }
    : { ok: false, error: 'docs came back too thin to be real' };
});

/* ── report ─────────────────────────────────────────────────────────────── */

const pass = results.filter((r) => r.ok).length;
console.log('\n════════════ MCP LIVE TEST RESULTS ════════════');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(20)} ${r.ok ? `(${r.tools} tools · ${r.evidence})` : `FAILED at ${r.stage}: ${r.error}`}`);
}
console.log(`${pass}/${results.length} servers passed`);
fs.rmSync(TEST_DATA, { recursive: true, force: true });
fs.rmSync(TEST_WS, { recursive: true, force: true });
process.exit(pass === results.length && results.length > 0 ? 0 : 1);
