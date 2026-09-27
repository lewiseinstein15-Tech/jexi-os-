#!/usr/bin/env node
/**
 * P10 GAP 3 — MCP STATE CLASSIFICATION — acceptance test.
 *
 * Spec: query /api/mcps, assert each MCP is in one of the three states
 * (connected / declarative / disabled), and any "connected" one is callable.
 * 100% classified required.
 *
 * Part A (HTTP): the live server's /api/mcps — 100% of the registry
 *   classified into exactly the three states; declarative servers answer
 *   "what do you offer" (declared schemas) via ?server=<name>.
 * Part B (in-process, same gateway module the server runs): a CONNECTED
 *   server is callable (gateway seam), and a declarative server honestly
 *   responds to an invoke with its declared offer.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_P10G3_PORT || 3063);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-gap3-'));
  process.env.DATA_DIR = dataDir; // the in-process part shares the run dir
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0, total = 0;
  try {
    let up = false;
    for (let i = 0; i < 90; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) { up = true; break; } } catch {} await wait(1000); }
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }

    /* A1 — /api/mcps: 100% classified into exactly the three states */
    total++;
    const res = await fetch(`${base}/api/mcps`);
    const report = await res.json().catch(() => ({}));
    const servers = Array.isArray(report.servers) ? report.servers : [];
    const validStates = new Set(['connected', 'declarative', 'disabled']);
    const classified = servers.filter((s) => validStates.has(s.state)).length;
    const sum = report.summary || {};
    const sumsOk = Number(sum.connected) + Number(sum.declarative) + Number(sum.disabled) === servers.length;
    const ok = report.ok === true && servers.length > 0 && classified === servers.length && sumsOk;
    if (ok) pass++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] A1 /api/mcps — 100% classified into three states`);
    console.log(`  summary: ${JSON.stringify(sum)} | servers: ${servers.length} | classified: ${classified}/${servers.length} | sumsMatch: ${sumsOk}`);
    const byState = {};
    for (const s of servers) byState[s.state] = (byState[s.state] || []).concat(s.name);
    for (const st of ['connected', 'declarative', 'disabled']) {
      console.log(`  ${st} (${(byState[st] || []).length}): ${(byState[st] || []).slice(0, 18).join(', ')}${(byState[st] || []).length > 18 ? ' …' : ''}`);
    }

    /* A2 — a declarative server answers "what do you offer" honestly */
    total++;
    const dres = await fetch(`${base}/api/mcps?server=nmap`);
    const drep = await dres.json().catch(() => ({}));
    const d = drep.describe || {};
    const offerOk = d.ok === true && d.state === 'declarative' && Array.isArray(d.tools) && d.tools.length > 0 && d.tools.every((t) => t.name) && d.declarativeByDesign === true;
    if (offerOk) pass++;
    console.log(`[${offerOk ? 'PASS' : 'FAIL'}] A2 declarative "what do you offer" — nmap answers with declared schemas (no live process)`);
    console.log(`  state: ${d.state} | live: ${d.live} | declarativeByDesign: ${d.declarativeByDesign} | offerSource: ${d.offerSource}`);
    console.log(`  offer: ${JSON.stringify((d.tools || []).map((t) => ({ name: t.name, schema: t.inputSchema ? 'declared' : null })))}`);
    console.log(`  note: ${d.note}`);

    /* B — in-process: a CONNECTED server is callable; declarative invoke answers */
    const gw = await import(path.join(ROOT, 'server/src/services/MCPGateway.js'));
    const reg = gw.effectiveRegistry();
    const target = reg.servers.find((s) => s.enabled && s.transport !== 'streamable-http');
    let calls = 0;
    gw.__setConnector(async () => ({
      async listTools() { return { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] }; },
      async callTool(call) { calls++; const n = typeof call === 'string' ? call : call.name; return { content: [{ type: 'text', text: n === 'ping' ? 'pong' : 'echo' }] }; },
      async close() {},
      transport: null,
    }));
    total++;
    const c = await gw.connectGatewayServer(target.name);
    const afterConnect = gw.mcpStateReport();
    const connRow = afterConnect.servers.find((s) => s.name === target.name);
    const inv = await gw.invokeMcpTool({ server: target.name, tool: 'ping', args: {} });
    const connectedOk = c.ok && connRow && connRow.state === 'connected' && calls >= 1 && String(inv?.result?.content?.[0]?.text) === 'pong';
    if (connectedOk) pass++;
    console.log(`[${connectedOk ? 'PASS' : 'FAIL'}] B1 connected server is callable — ${target.name}`);
    console.log(`  connect: ${JSON.stringify(c)} | state: ${connRow && connRow.state} | invoke → ${String(inv?.result?.content?.[0]?.text)} | calls: ${calls}`);

    total++;
    const dInv = await gw.invokeMcpTool({ server: 'nmap', tool: 'nmap_scan', args: { target: 'example.com' } });
    const dText = String(dInv?.result?.content?.[0]?.text || '');
    const declaredOk = dInv.ok === true && dInv.declarative === true && /nmap_scan/.test(dText) && /declarative/.test(dText);
    if (declaredOk) pass++;
    console.log(`[${declaredOk ? 'PASS' : 'FAIL'}] B2 declarative invoke answers honestly with its declared offer`);
    console.log(`  raw: ${dText.slice(0, 260)}`);
    console.log(`  audit: ${fs.existsSync(path.join(dataDir, 'mcp-audit.jsonl')) ? fs.readFileSync(path.join(dataDir, 'mcp-audit.jsonl'), 'utf8').split('\n').filter((l) => /MCP_DECLARED_INVOKE/.test(l)).length + ' MCP_DECLARED_INVOKE entries' : 'no audit file'}`);
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await wait(500);
    try { child.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nP10 GAP 3 MCP STATE TEST: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}
await main();
