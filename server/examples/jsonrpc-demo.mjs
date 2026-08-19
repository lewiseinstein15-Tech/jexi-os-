#!/usr/bin/env node
/**
 * B139 — JSON-RPC DEMO (dsh examples/jsonrpc-demo mirror, JEXI-branded).
 * Minimal JSON-RPC 2.0 client against the MCP streamable endpoint.
 *
 *   node examples/jsonrpc-demo.mjs [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:3002';

const call = async (body) => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('\n');
  return data ? JSON.parse(data) : {};
};

const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'jsonrpc-demo', version: '1.0.0' } } });
const tools = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
console.log(JSON.stringify({ server: init.result?.serverInfo?.name, tools: (tools.result?.tools || []).map((t) => t.name) }, null, 2));
