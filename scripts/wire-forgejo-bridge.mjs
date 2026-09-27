#!/usr/bin/env node
/**
 * FINAL GAP 3 — wire forgejo-mcp through the real stdio bridge. Idempotent.
 *
 * Before: declarative placeholder whose spawn failed honestly ("shipped forge
 * toolset is a library surface, NOT an MCP stdio server").
 * After:  command=node args=[forgejo-bridge.js] enabled — connect() spawns the
 * bridge, tools/list serves the 6 forgejo.* tools, tools/call performs REAL
 * HTTP against FORGEJO_URL (honest not-configured until the env is set).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = path.join(ROOT, 'server', 'mcp', 'registry.json');
const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));

const s = reg.servers.find((x) => x.name === 'forgejo-mcp');
if (!s) { console.error('forgejo-mcp entry missing'); process.exit(1); }
s.transport = 'stdio';
s.command = 'node';
s.args = ['${JEXI_SERVER_ROOT}/mcp/servers/forgejo-bridge.js'];
s.enabled = true;
s.declarative = false;
s.permissions = ['NETWORK'];
s.notes = 'WIRED (FINAL GAP 3): real stdio MCP bridge (server/mcp/servers/forgejo-bridge.js — initialize/tools/list/tools/call, zero deps). Six forgejo.* tools perform REAL HTTP against the configured instance: FORGEJO_URL + FORGEJO_TOKEN env (Bearer/token auth, /api/v1 routes). Unconfigured instances get an honest "forgejo not configured" error naming the exact env vars — never a stub. Live-verified against a local mock forgejo (HTTP interception).';

fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
console.log('forgejo-mcp wired → stdio bridge (enabled, network permission)');
