#!/usr/bin/env node
/**
 * PHASE 5 P5-2 — MCP SIMULATION.
 *
 * "Ask something needing a connected MCP; assert MCP invoked."
 *
 * Uses the REAL MCPGateway (connect → list → invoke → audit) with the
 * gateway's official test seam (__setConnector) standing in for the child
 * process — the sandbox is keyless/keyless-host (0 live servers connect),
 * so the synthetic connector makes the FULL gateway path observable:
 *   1. connectGatewayServer   → real connect path (MCP_CONNECTED audit)
 *   2. invokeMcpTool          → real invocation path (grants, calls counter,
 *                               MCP_TOOL_CALL audit, tool result)
 *   3. disconnect + lazy wake → invokeMcpTool auto-reconnects (lazy-connect
 *                               contract: no standing connections)
 * Raw evidence: DATA_DIR/mcp audit JSONL entries printed verbatim.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-p52-'));
process.env.JEXI_MCP_IDLE_MINUTES = '0';

const gw = await import(path.join(ROOT, 'server/src/services/MCPGateway.js'));
const { DATA_DIR } = await import(path.join(ROOT, 'server/src/config.js'));

// Find an enabled stdio server in the REAL registry to exercise.
const reg = gw.effectiveRegistry();
const target = reg.servers.find((s) => s.enabled && s.transport !== 'streamable-http');
if (!target) { console.log('[FAIL] no enabled stdio server in registry'); process.exit(1); }
console.log(`[TARGET] ${target.name} (transport=${target.transport}, enabled=${target.enabled})`);

// Synthetic connector — a tiny REAL MCP-server-shaped object (listTools/callTool).
const calls = [];
let disconnected = 0;
gw.__setConnector(async (entry) => ({
  async listTools() {
    return {
      tools: [
        { name: 'ping', description: 'health ping', inputSchema: { type: 'object', properties: {} } },
        { name: 'echo', description: 'echo a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } },
      ],
    };
  },
  async callTool(call, maybeArgs) {
    const name = typeof call === 'string' ? call : call && call.name;
    const args = typeof call === 'string' ? maybeArgs : call && call.arguments;
    calls.push({ name, args });
    if (name === 'ping') return { content: [{ type: 'text', text: 'pong' }] };
    return { content: [{ type: 'text', text: `echo: ${args && args.message}` }] };
  },
  async close() { disconnected++; },
  transport: null,
}));

let pass = 0, total = 0;
const auditLines = () => {
  const f = path.join(DATA_DIR, 'mcp-audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
};

// ── 1. connect ─────────────────────────────────────────────────────────
total++;
const c = await gw.connectGatewayServer(target.name);
const connectedAudit = auditLines().find((a) => a.type === 'MCP_CONNECTED' && a.server === target.name);
const ok1 = c.ok && typeof c.tools === 'number' && c.tools === 2 && Boolean(connectedAudit);
if (ok1) pass++;
console.log(`[${ok1 ? 'PASS' : 'FAIL'}] connect → ${JSON.stringify(c)} | audit: ${connectedAudit ? JSON.stringify(connectedAudit) : 'MISSING'}`);

// ── 2. invoke (the "ask something needing a connected MCP" step) ───────
total++;
const inv = await gw.invokeMcpTool({ server: target.name, tool: 'echo', args: { message: 'hello from JEXI' } });
const toolAudit = auditLines().find((a) => a.type === 'MCP_TOOL_CALL' || (a.type || '').startsWith('MCP_') && a.tool === 'echo');
const ok2 = inv && inv.ok !== false && calls.some((x) => x.name === 'echo') && Boolean(toolAudit);
if (ok2) pass++;
console.log(`[${ok2 ? 'PASS' : 'FAIL'}] invoke echo → result: ${JSON.stringify(inv).slice(0, 140)} | calls=${JSON.stringify(calls)}`);
console.log(`   audit entry: ${toolAudit ? JSON.stringify(toolAudit) : '(check below for the real entry type)'}`);
if (!toolAudit) console.log('   all audit lines:', JSON.stringify(auditLines()));

// ── 3. disconnect → lazy wake on next use ──────────────────────────────
total++;
await gw.disconnectGatewayServer(target.name);
const inv2 = await gw.invokeMcpTool({ server: target.name, tool: 'ping', args: {} });
const ok3 = inv2 && inv2.ok !== false && calls.filter((x) => x.name === 'ping').length === 1 && disconnected >= 1;
if (ok3) pass++;
console.log(`[${ok3 ? 'PASS' : 'FAIL'}] lazy wake after disconnect → ping result: ${JSON.stringify(inv2).slice(0, 100)} | reconnect proves lazy-connect (no standing connection needed)`);

// ── 4. unknown tool refused (permission boundary honesty) ──────────────
total++;
const inv3 = await gw.invokeMcpTool({ server: target.name, tool: 'does-not-exist', args: {} });
const ok4 = inv3 && inv3.ok === false && /unknown tool/i.test(String(inv3.error));
if (ok4) pass++;
console.log(`[${ok4 ? 'PASS' : 'FAIL'}] unknown tool refused → ${JSON.stringify(inv3)}`);

console.log(`P5-2 MCP SIM: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
