#!/usr/bin/env node
/**
 * MCP TOOL DIRECTORY GENERATOR — Sept 2026.
 *
 * Connects to every ENABLED server in mcp/registry.json through the real
 * gateway connector (same interpolation, same transports) and records each
 * server's live tool list to mcp/tool-directory.json. The directory lets the
 * unified catalog offer sleeping servers' tools (with descriptions) without
 * holding a child process per server.
 *
 * Usage: cd server && node scripts/mcp-gen-tool-directory.mjs [--timeout 90000]
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectGatewayServer, disconnectGatewayServer } from '../src/services/MCPGateway.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '../../mcp/tool-directory.json');
const perServerTimeout = Number(process.argv[3] || process.argv[2] || 90_000);

const registryPath = path.resolve(here, '../../mcp/registry.json');
const registry = JSON.parse((await import('fs')).readFileSync(registryPath, 'utf8'));
const enabled = registry.servers.filter((s) => s.enabled !== false);

const servers = {};
let ok = 0, fail = 0;
for (const s of enabled) {
  process.stdout.write(`directory ${s.name} … `);
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      connectGatewayServer(s.name),
      new Promise((_, rej) => setTimeout(() => rej(new Error('script timeout')), perServerTimeout)),
    ]);
    if (r.ok !== true) { fail++; console.log(`connect failed: ${String(r.error).slice(0, 90)}`); continue; }
    // pull the live tool list through the gateway's own connection record
    const { gatewayServerTools } = await import('../src/services/MCPGateway.js');
    const tools = gatewayServerTools(s.name) || [];
    servers[s.name] = {
      tools: tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 220), inputSchema: t.inputSchema || null })),
      launch: s.transport === 'streamable-http' ? `hosted: ${s.url}` : `${s.command} ${(s.args || []).join(' ')}`.trim(),
      verifiedAt: new Date().toISOString(),
    };
    await disconnectGatewayServer(s.name);
    ok++;
    console.log(`${servers[s.name].tools.length} tools (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    fail++;
    console.log(`error: ${String(e && e.message).slice(0, 90)}`);
  }
}

const toolCount = Object.values(servers).reduce((n, s) => n + (s.tools?.length || 0), 0);
writeFileSync(outPath, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), servers }, null, 1));
console.log(`\ndirectory written: ${ok} servers ok · ${fail} failed · ${toolCount} tools → ${outPath}`);
process.exit(fail > 0 ? 1 : 0);
