#!/usr/bin/env node
/**
 * FINAL GAP 2/3 — real declared schemas for the permanently-declarative
 * entries that had EMPTY offers (n8n-mcp, forgejo-mcp). Per the FINAL
 * CLOSE-OUT spec a declarative MCP must be queryable AND answer with real
 * schemas — never an empty stub. Idempotent.
 *
 * forgejo-mcp: the 6 schemas below are EXACTLY what the stdio bridge
 * (server/mcp/servers/forgejo-bridge.js, GAP 3) serves live once wired.
 * n8n-mcp: schemas from the verified upstream package surface
 * (czlonkowski/n8n-mcp — workflow management / node docs / execution).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = path.join(ROOT, 'server', 'mcp', 'registry.json');
const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));

const str = (description) => ({ type: 'string', description });
const TOOL = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } });

const SCHEMAS = {
  'n8n-mcp': [
    TOOL('search_nodes', 'Search the n8n node catalog by keyword.', { query: str('search text, e.g. "slack"'), limit: { type: 'number', description: 'max results (default 20)' } }, ['query']),
    TOOL('get_node_essentials', 'Essentials of one node type: parameters, credentials, examples.', { nodeType: str('full node type, e.g. n8n-nodes-base.slack') }, ['nodeType']),
    TOOL('list_workflows', 'List workflows on the configured n8n instance.', {}),
    TOOL('get_workflow', 'Fetch one full workflow definition by id.', { id: str('workflow id') }, ['id']),
    TOOL('create_workflow', 'Create a workflow (name + nodes + connections).', { name: str('workflow name'), nodes: { type: 'array', description: 'n8n node array' }, connections: { type: 'object', description: 'n8n connection map' } }, ['name', 'nodes']),
    TOOL('execute_workflow', 'Execute a stored workflow by id with optional input.', { id: str('workflow id'), input: { type: 'object', description: 'execution input payload' } }, ['id']),
  ],
  'forgejo-mcp': [
    TOOL('forgejo.list_repos', 'List repositories visible to the configured token (GET /api/v1/repos/search).', { limit: { type: 'number', description: 'page size (default 20)' } }),
    TOOL('forgejo.get_repo', 'One repository (GET /api/v1/repos/{owner}/{repo}).', { owner: str('repo owner'), repo: str('repo name') }, ['owner', 'repo']),
    TOOL('forgejo.list_issues', 'List issues (GET /api/v1/repos/{owner}/{repo}/issues?state=).', { owner: str('repo owner'), repo: str('repo name'), state: { type: 'string', description: 'open | closed | all (default open)' } }, ['owner', 'repo']),
    TOOL('forgejo.create_issue', 'Create an issue (POST /api/v1/repos/{owner}/{repo}/issues).', { owner: str('repo owner'), repo: str('repo name'), title: str('issue title'), body: str('issue body (markdown)') }, ['owner', 'repo', 'title']),
    TOOL('forgejo.list_prs', 'List pull requests (GET /api/v1/repos/{owner}/{repo}/pulls?state=).', { owner: str('repo owner'), repo: str('repo name'), state: { type: 'string', description: 'open | closed | all (default open)' } }, ['owner', 'repo']),
    TOOL('forgejo.get_pr', 'One pull request (GET /api/v1/repos/{owner}/{repo}/pulls/{index}).', { owner: str('repo owner'), repo: str('repo name'), index: { type: 'number', description: 'PR index' } }, ['owner', 'repo', 'index']),
  ],
};

let patched = 0;
for (const s of reg.servers) {
  const tools = SCHEMAS[s.name];
  if (!tools) continue;
  s.declaredTools = tools;
  patched++;
  if (s.name === 'n8n-mcp') {
    s.notes = 'permanently-declarative (FINAL GAP 2): REAL declared schemas from the verified upstream n8n-mcp surface — requires an external n8n instance at enable time; every invoke answers with this declared offer (queryable, never an empty stub).';
  }
  if (s.name === 'forgejo-mcp') {
    s.notes = 'permanently-declarative schemas upgraded in FINAL GAP 3: the six forgejo.* schemas are served live by the stdio bridge server/mcp/servers/forgejo-bridge.js (initialize/tools/list/tools/call; FORGEJO_URL + FORGEJO_TOKEN env; honest not-configured answers until set).';
  }
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
console.log(`patched declared schemas: ${patched} entries → ${REG}`);
