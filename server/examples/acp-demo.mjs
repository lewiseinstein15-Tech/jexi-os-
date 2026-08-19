#!/usr/bin/env node
/**
 * B139 — ACP DEMO (dsh examples/acp-demo mirror, JEXI-branded).
 * Speaks JSON-RPC 2.0 to the local server's ACP surface (/api/acp).
 *
 *   node examples/acp-demo.mjs [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:3002';

const call = async (method, params = {}) => {
  const res = await fetch(`${base}/api/acp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params }),
  });
  return res.json();
};

const init = await call('initialize', { protocolVersion: '0.1.0', capabilities: {}, clientInfo: { name: 'acp-demo', version: '1.0.0' } });
const tools = await call('tools/list', {});
console.log(JSON.stringify({ initialized: !!init.result, toolCount: (tools.result?.tools || []).length, tools: (tools.result?.tools || []).map((t) => t.name).slice(0, 10) }, null, 2));
