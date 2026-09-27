#!/usr/bin/env node
/**
 * JEXI MCP — FORGEJO BRIDGE (FINAL GAP 3).
 *
 * A minimal dependency-free MCP stdio server for forgejo (self-hosted Git
 * forge, Gitea fork). Implements the MCP stdio protocol:
 *   initialize / notifications/initialized / tools/list / tools/call / ping
 *
 * Tools (matching forgejo's REST API):
 *   forgejo.list_repos    GET    /api/v1/repos/search
 *   forgejo.get_repo      GET    /api/v1/repos/{owner}/{repo}
 *   forgejo.list_issues   GET    /api/v1/repos/{owner}/{repo}/issues?state=
 *   forgejo.create_issue  POST   /api/v1/repos/{owner}/{repo}/issues
 *   forgejo.list_prs      GET    /api/v1/repos/{owner}/{repo}/pulls?state=
 *   forgejo.get_pr        GET    /api/v1/repos/{owner}/{repo}/pulls/{index}
 *
 * Configuration (env):
 *   FORGEJO_URL    base URL of the forgejo instance (e.g. https://git.example.com)
 *   FORGEJO_TOKEN  bearer token (forgejo access token)
 * If either is missing, every tool returns an HONEST "forgejo not configured"
 * error naming the exact env vars needed — never a fake result.
 *
 * Usage (also the registry entry):
 *   node forgejo-bridge.js
 */
import fs from 'node:fs';
import path from 'node:path';

const PROTOCOL = '2024-11-05';
const SERVER_NAME = 'forgejo-mcp';
const SERVER_VERSION = '1.0.0';

const TOOLS = [
  {
    name: 'forgejo.list_repos',
    description: 'List repositories visible to the configured token (GET /api/v1/repos/search).',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'page size (default 20)' } } },
  },
  {
    name: 'forgejo.get_repo',
    description: 'One repository (GET /api/v1/repos/{owner}/{repo}).',
    inputSchema: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string' }, repo: { type: 'string' } } },
  },
  {
    name: 'forgejo.list_issues',
    description: 'List issues (GET /api/v1/repos/{owner}/{repo}/issues?state=).',
    inputSchema: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string', description: 'open | closed | all (default open)' } } },
  },
  {
    name: 'forgejo.create_issue',
    description: 'Create an issue (POST /api/v1/repos/{owner}/{repo}/issues).',
    inputSchema: { type: 'object', required: ['owner', 'repo', 'title'], properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', description: 'markdown body' } } },
  },
  {
    name: 'forgejo.list_prs',
    description: 'List pull requests (GET /api/v1/repos/{owner}/{repo}/pulls?state=).',
    inputSchema: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string', description: 'open | closed | all (default open)' } } },
  },
  {
    name: 'forgejo.get_pr',
    description: 'One pull request (GET /api/v1/repos/{owner}/{repo}/pulls/{index}).',
    inputSchema: { type: 'object', required: ['owner', 'repo', 'index'], properties: { owner: { type: 'string' }, repo: { type: 'string' }, index: { type: 'number' } } },
  },
];

/* ── configuration ─────────────────────────────────────────────────────── */

function config() {
  const url = String(process.env.FORGEJO_URL || '').trim().replace(/\/+$/, '');
  const token = String(process.env.FORGEJO_TOKEN || '').trim();
  return {
    url,
    token,
    configured: Boolean(url && token),
    missing: [!url ? 'FORGEJO_URL' : null, !token ? 'FORGEJO_TOKEN' : null].filter(Boolean),
  };
}

function notConfigured(toolName) {
  const c = config();
  return {
    isError: true,
    text: JSON.stringify({
      ok: false,
      tool: toolName,
      error: 'forgejo not configured',
      need: `set ${c.missing.join(' + ')} to a reachable forgejo instance (e.g. FORGEJO_URL=https://git.example.com, FORGEJO_TOKEN=<access token>)`,
      configured: c.configured,
      missingEnv: c.missing,
    }),
  };
}

/* ── tool implementations (real HTTP against the configured instance) ──── */

const RE_OWNER = /^[a-zA-Z0-9._-]{1,200}$/;

function apiPath(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = encodeURIComponent(String(params[k]));
    if (!v || v === 'undefined') throw new Error(`missing path parameter: ${k}`);
    return v;
  });
}

async function callTool(name, args = {}) {
  const c = config();
  if (!c.configured) return notConfigured(name);
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { isError: true, text: JSON.stringify({ ok: false, error: `unknown tool '${name}'`, tools: TOOLS.map((t) => t.name) }) };

  const owner = String(args.owner || ''), repo = String(args.repo || '');
  if (owner && !RE_OWNER.test(owner)) return { isError: true, text: JSON.stringify({ ok: false, error: `invalid owner '${owner.slice(0, 60)}'` }) };
  if (repo && !RE_OWNER.test(repo)) return { isError: true, text: JSON.stringify({ ok: false, error: `invalid repo '${repo.slice(0, 60)}'` }) };

  const state = ['open', 'closed', 'all'].includes(String(args.state)) ? String(args.state) : 'open';
  const calls = {
    'forgejo.list_repos': () => ({ path: `/api/v1/repos/search?limit=${Math.min(Number(args.limit) || 20, 50)}`, method: 'GET' }),
    'forgejo.get_repo': () => ({ path: apiPath('/api/v1/repos/{owner}/{repo}', { owner, repo }), method: 'GET' }),
    'forgejo.list_issues': () => ({ path: apiPath(`/api/v1/repos/{owner}/{repo}/issues?state=${state}&limit=20`, { owner, repo }), method: 'GET' }),
    'forgejo.create_issue': () => ({ path: apiPath('/api/v1/repos/{owner}/{repo}/issues', { owner, repo }), method: 'POST', body: { title: String(args.title || ''), body: String(args.body || '') } }),
    'forgejo.list_prs': () => ({ path: apiPath(`/api/v1/repos/{owner}/{repo}/pulls?state=${state}&limit=20`, { owner, repo }), method: 'GET' }),
    'forgejo.get_pr': () => ({ path: apiPath('/api/v1/repos/{owner}/{repo}/pulls/{index}', { owner, repo, index: Number(args.index) }), method: 'GET' }),
  };
  const call = calls[name];
  if (!call) return { isError: true, text: JSON.stringify({ ok: false, error: `no route for '${name}'` }) };

  const { path: api, method, body } = call();
  const t0 = Date.now();
  try {
    const res = await fetch(`${c.url}${api}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${c.token}`, // forgejo access-token auth scheme
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    return {
      text: JSON.stringify({
        ok: res.ok,
        tool: name,
        method,
        url: `${c.url}${api}`,
        httpStatus: res.status,
        duration_ms: Date.now() - t0,
        body: text.length > 200_000 ? text.slice(0, 200_000) + '…[truncated]' : text,
      }),
    };
  } catch (e) {
    return {
      isError: true,
      text: JSON.stringify({ ok: false, tool: name, method, url: `${c.url}${api}`, error: `forgejo unreachable: ${String(e && e.message || e).slice(0, 200)}`, duration_ms: Date.now() - t0 }),
    };
  }
}

/* ── MCP stdio protocol loop ───────────────────────────────────────────── */

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));

async function handle(line) {
  let msg = null;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg || {};
  const reply = (result, error) => send({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) });
  try {
    switch (method) {
      case 'initialize':
        reply({
          protocolVersion: (params && params.protocolVersion) || PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        break;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        break;
      case 'ping':
        reply({});
        break;
      case 'tools/list':
        reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        break;
      case 'tools/call': {
        const { name, arguments: args } = params || {};
        const out = await callTool(String(name || ''), args || {});
        reply({ content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) });
        break;
      }
      default:
        if (id !== undefined && id !== null) reply(null, { code: -32601, message: `method not found: ${method}` });
    }
  } catch (e) {
    if (id !== undefined && id !== null) reply(null, { code: -32603, message: String((e && e.message) || e).slice(0, 300) });
  }
}

process.on('uncaughtException', (e) => { try { process.stderr.write(`[forgejo-bridge] uncaught: ${e && e.message}\n`); } catch { /* dying */ } });
process.on('unhandledRejection', (e) => { try { process.stderr.write(`[forgejo-bridge] unhandled: ${String(e && e.message || e)}\n`); } catch { /* dying */ } });
