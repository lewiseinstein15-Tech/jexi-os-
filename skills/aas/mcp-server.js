#!/usr/bin/env node
/**
 * JEXI OS — AAS CORE — mcp-server.js
 *
 * Local stdio MCP (Model Context Protocol) server over the AAS catalog.
 * Real JSON-RPC 2.0, newline-delimited messages (MCP stdio transport):
 *
 *   initialize            → protocol handshake
 *   tools/list            → the 4 AAS tools
 *   tools/call:
 *     search_catalog      { query }            → matching skills
 *     inspect_skill       { id }               → full metadata or error
 *     compose_stack       { ids[] }            → validation verdict + stack
 *     compare_stacks      { idsA[], idsB[] }   → side-by-side compose diff
 *
 * stdout carries ONLY protocol messages; logs go to stderr.
 */
import { createInterface } from 'node:readline';
import { list, get, search, diagnostics } from './catalog.js';
import { compose } from './compose-stack.js';

const SERVER_INFO = { name: 'jexi-aas', version: '1.0.0' };

const TOOLS = [
  {
    name: 'search_catalog',
    description: 'Search the local JEXI skill catalog (skills/**/SKILL.md metadata) by query.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'search terms' } }, required: ['query'] },
  },
  {
    name: 'inspect_skill',
    description: 'Return full metadata for one skill id, or an error if unknown.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'compose_stack',
    description: 'Validate a skill selection: unknown ids, description overlap (cosine >= 0.85), context budget. Returns {valid, errors, stack}.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'compare_stacks',
    description: 'Compose two candidate stacks and diff them: members, errors, budget.',
    inputSchema: {
      type: 'object',
      properties: { idsA: { type: 'array', items: { type: 'string' } }, idsB: { type: 'array', items: { type: 'string' } } },
      required: ['idsA', 'idsB'],
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'search_catalog':
      return { results: search(String(args?.query || '')), catalogSize: list().length };
    case 'inspect_skill': {
      const skill = get(String(args?.id || ''));
      if (!skill) throw new Error(`UNKNOWN_ID: '${args?.id}' is not in the catalog`);
      return skill;
    }
    case 'compose_stack':
      return compose(Array.isArray(args?.ids) ? args.ids : []);
    case 'compare_stacks': {
      const a = await compose(Array.isArray(args?.idsA) ? args.idsA : []);
      const b = await compose(Array.isArray(args?.idsB) ? args.idsB : []);
      const setB = new Set(b.stack?.ids ?? []);
      return {
        A: { ids: a.stack?.ids ?? [], valid: a.valid, errors: a.errors, budget: { used: a.stack?.totalDescriptionChars ?? null, cap: DESCRIPTION_CAP() } },
        B: { ids: b.stack?.ids ?? [], valid: b.valid, errors: b.errors, budget: { used: b.stack?.totalDescriptionChars ?? null, cap: DESCRIPTION_CAP() } },
        onlyInA: (a.stack?.ids ?? []).filter((id) => !setB.has(id)),
        onlyInB: (b.stack?.ids ?? []).filter((id) => !(new Set(a.stack?.ids ?? [])).has(id)),
      };
    }
    default:
      throw new Error(`UNKNOWN_TOOL: ${name}`);
  }
}

import { DESCRIPTION_BUDGET_CHARS } from './compose-stack.js';
const DESCRIPTION_CAP = () => DESCRIPTION_BUDGET_CHARS;

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    write({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
    return;
  }
  if (method === 'notifications/initialized' || (id === undefined && String(method || '').startsWith('notifications/'))) return; // notification — no reply
  if (method === 'tools/list') {
    write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    callTool(params?.name, params?.arguments)
      .then((result) => write({ jsonrpc: '2.0', id, result: textResult(result) }))
      .catch((e) => write({ jsonrpc: '2.0', id, result: textResult({ error: true, message: e.message }) }));
    return;
  }
  write({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
});

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

process.stderr.write(`[jexi-aas] MCP server ready on stdio — catalog: ${list().length} skills, skipped: ${diagnostics().skipped.length}\n`);
