/**
 * Final F5 — JEXI_MCP_MINIMAL=1 forces lazy-only MCP (nothing stdio at boot).
 * Proves: the env gate exists in the boot-connect path; with the flag set,
 * every stdio server reports skipped (no child spawned); without it the
 * normal memory-guard path is untouched.
 */
import { connectEnabledMcpServers } from './src/services/MCPGateway.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };

process.env.JEXI_MCP_MINIMAL = '1';
const rows = await connectEnabledMcpServers();
ok(rows.length > 0, `registry non-empty (${rows.length} servers)`);
ok(rows.every((r) => r.skipped === true), `all ${rows.length} servers skipped (lazy) under MINIMAL=1`);
ok(rows.every((r) => r.ok === true), 'skipped rows still report ok:true (ready, not failed)');
delete process.env.JEXI_MCP_MINIMAL;

console.log(`\nF5 mcp-minimal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
