// Phase 11 Scope G — codegraph-mcp: local stdio MCP server exposing the
// 15 CBM code-graph tools (Scope B) as real MCP tools.
//
// JSON-RPC 2.0 over stdio (MCP stdio transport = newline-delimited JSON).
// Methods: initialize, notifications/initialized, ping, tools/list, tools/call.
// tools/list  → the real Scope-B tool definitions (name/description/inputSchema).
// tools/call  → dispatches to the REAL tool handler (capability/code/graph store).
//
// No stubs: every tool runs against the SQLite/file graph store in
// capability/code/graph/db (index-repository populates it).

import readline from 'node:readline';
import * as indexRepository from '../../tools/domains/lsp/index-repository.tool.js';
import * as listProjects from '../../tools/domains/lsp/list-projects.tool.js';
import * as deleteProject from '../../tools/domains/lsp/delete-project.tool.js';
import * as indexStatus from '../../tools/domains/lsp/index-status.tool.js';
import * as checkIndexCoverage from '../../tools/domains/lsp/check-index-coverage.tool.js';
import * as searchGraph from '../../tools/domains/lsp/search-graph.tool.js';
import * as searchCode from '../../tools/domains/lsp/search-code.tool.js';
import * as tracePath from '../../tools/domains/lsp/trace-path.tool.js';
import * as queryGraph from '../../tools/domains/lsp/query-graph.tool.js';
import * as getGraphSchema from '../../tools/domains/lsp/get-graph-schema.tool.js';
import * as getCodeSnippet from '../../tools/domains/lsp/get-code-snippet.tool.js';
import * as getArchitecture from '../../tools/domains/lsp/get-architecture.tool.js';
import * as manageAdr from '../../tools/domains/lsp/manage-adr.tool.js';
import * as ingestTraces from '../../tools/domains/lsp/ingest-traces.tool.js';
import * as detectChanges from '../../tools/domains/lsp/detect-changes.tool.js';

const SERVER_INFO = { name: 'codegraph-mcp', version: '1.0.0' };

const MODULES = [
  indexRepository, listProjects, deleteProject, indexStatus,
  checkIndexCoverage, searchGraph, searchCode, tracePath, queryGraph,
  getGraphSchema, getCodeSnippet, getArchitecture, manageAdr, ingestTraces,
  detectChanges,
];

const TOOLS = MODULES.map((m) => ({
  name: m.def.name,
  description: m.def.description,
  inputSchema: m.def.parameters,
  run: m.handler,
}));

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyErr = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return replyErr(null, -32700, 'Parse error'); }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
        break;
      case 'notifications/initialized':
      case 'initialized':
        break; // notification — never answered
      case 'ping':
        reply(id, {});
        break;
      case 'tools/list':
        reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
        break;
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return replyErr(id, -32602, `unknown tool: ${params?.name}`);
        try {
          const result = await tool.run(params?.arguments || {});
          reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
          reply(id, { content: [{ type: 'text', text: String(err?.message || err) }], isError: true });
        }
        break;
      }
      default:
        if (!isNotification) replyErr(id, -32601, `method not found: ${method}`);
    }
  } catch (err) {
    if (!isNotification) replyErr(id, -32603, `internal error: ${String(err?.message || err)}`);
  }
});

// stderr is for logs only — stdout carries the protocol.
process.stderr.write(`${SERVER_INFO.name} ${SERVER_INFO.version} ready: ${TOOLS.length} tools\n`);
