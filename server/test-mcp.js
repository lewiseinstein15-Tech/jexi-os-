/**
 * MCP server smoke test — boots the Express app with the MCP endpoint mounted
 * and verifies: initialize handshake, tools/list, resources/list, and one tool
 * call (get_health, which needs no AI keys).
 */
import express from 'express';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { mountMcp } from './mcp-server.js';

const PORT = 3911;
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failures++;
};

// Build the same wiring index.js uses: json middleware then mountMcp.
const app = express();
app.use(express.json({ limit: '2mb' }));
mountMcp(app);
app.get('/api/health', (req, res) => res.json({ ok: true }));

const server = app.listen(PORT);

const call = async (body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  // The StreamableHTTPServerTransport replies with SSE framing when
  // text/event-stream is accepted: "event: message\ndata: {...}". Peel off the
  // data: line(s) so the JSON-RPC body can be parsed.
  const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('\n');
  try {
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return { error: { message: `unparseable: ${raw.slice(0, 120)}` } };
  }
};

try {
  // 1. Initialize handshake
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } });
  check('initialize returns serverInfo jexi-os', init?.result?.serverInfo?.name === 'jexi-os');

  // 2. Tools list (allowlist)
  const tools = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (tools?.result?.tools || []).map((t) => t.name).sort();
  check('tools/list exposes the 5-tool allowlist', JSON.stringify(names) === JSON.stringify(['ask_jexi', 'get_health', 'knowledge_search', 'list_books', 'memory_lookup']));

  // 3. Resources list
  const resources = await call({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
  const uris = (resources?.result?.resources || []).map((r) => r.uri).sort();
  check('resources/list exposes 4 resources', uris.length === 4 && uris.includes('memory://chat') && uris.includes('knowledge://files/{category}'));

  // 4. One real tool call — get_health (no AI keys needed)
  const health = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_health', arguments: {} } });
  const healthText = JSON.stringify(health?.result?.structuredContent || {});
  check('tools/call get_health returns ok:true', healthText.includes('"ok":true'));

  // 5. Unknown tool is rejected (allowlist enforcement — SDK returns isError)
  const unknown = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'clear_memory', arguments: {} } });
  check('unknown tool rejected (no destructive ops)', unknown?.result?.isError === true || !!unknown?.error);
} catch (e) {
  check(`no crash during test run (${e.message})`, false);
} finally {
  server.close();
  await sleep(100);
}

console.log(failures === 0 ? '\nALL MCP TESTS PASSED' : `\n${failures} MCP TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
