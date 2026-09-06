#!/usr/bin/env node
/**
 * MCP PREWARM (build-time) — Sept 2026.
 *
 * Every stdio MCP server in mcp/registry.json launches through npx/uvx,
 * which downloads the package on FIRST use. In the Render container that
 * cold download can exceed the gateway's 60s connect window (observed:
 * `npx -y mcp-server-qrcode` timed out on first connect). Baking the
 * package caches into the Docker image makes every server connect in
 * seconds, first time, every time — no runtime surprises.
 *
 * How: run each server command with `--help` appended under a timeout.
 * The package download happens BEFORE the process starts serving, so even
 * a killed run leaves the cache warm. Failures never fail the build —
 * they just mean that server pays the cold cost at runtime (and the
 * gateway retries on next use).
 *
 * Usage: node scripts/mcp-prewarm.mjs [timeoutSecPerServer]
 */
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(here, '../../mcp/registry.json');
const perServerTimeout = Number(process.argv[2] || 90) * 1000;

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const servers = (registry.servers || []).filter(
  (s) => s.enabled !== false && s.transport === 'stdio' && (s.command === 'npx' || s.command === 'uvx')
);

let warmed = 0, slow = 0, failed = 0;
for (const s of servers) {
  // Substitute registry placeholders with safe dummy paths (downloads don't
  // care about the values; the servers never get far enough to use them).
  const args = (s.args || []).map((a) => String(a)
    .replace(/\$\{JEXI_WORKSPACE\}/g, '/tmp/jexi-ws')
    .replace(/\$\{JEXI_SQLITE_DB\}/g, '/tmp/jexi-prewarm.db'));
  const label = `${s.command} ${args.join(' ')}`;
  process.stdout.write(`prewarm ${s.name}: ${label} … `);
  const t0 = Date.now();
  const r = spawnSync(s.command, [...args, '--help'], {
    timeout: perServerTimeout,
    encoding: 'utf8',
    env: { ...process.env, JEXI_WORKSPACE: '/tmp/jexi-ws', JEXI_SQLITE_DB: '/tmp/jexi-prewarm.db' },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // timed-out runs still downloaded the package — count as warm-but-slow.
  if (r.error && r.error.code === 'ETIMEDOUT') { slow++; console.log(`downloaded, help hung (${secs}s) — cache warm`); }
  else if (r.error) { failed++; console.log(`spawn error: ${r.error.message}`); }
  else { warmed++; console.log(`ok (${secs}s)`); }
}
console.log(`\nprewarm done: ${warmed} clean · ${slow} downloaded-but-help-hung · ${failed} failed · ${servers.length} stdio servers total`);
// Exit 0 always — prewarm is an optimization, never a build gate.
process.exit(0);
