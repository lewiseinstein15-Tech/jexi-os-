// CBM tool — query-graph: Cypher-like read-only graph queries.
// Supported shape:
//   MATCH (n:Function)-[:CALLS]->(m) WHERE n.name = 'X' AND m.label =~ /Class/ RETURN n.name, m.qualname LIMIT 10
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'query-graph',
  description: 'Execute a read-only Cypher-like query: MATCH (a:Label)-[:TYPE]->(b) [WHERE …] RETURN props [LIMIT n].',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: "MATCH (n:Function)-[:CALLS]->(m) WHERE n.name = 'X' RETURN n.name, m.name LIMIT 20" },
      project: { type: 'string' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, columns, rows, count }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

const MATCH_RE = /^MATCH\s*\(\s*(\w+)\s*(?::\s*([A-Za-z]+)\s*)?\)\s*-\s*\[\s*:\s*([A-Z_]+)\s*\]\s*->\s*\(\s*(\w+)\s*(?::\s*([A-Za-z]+)\s*)?\)(.*)$/s;
const PROP_REF = /^(\w+)\.(name|label|file|qualname|line|language)$/;

function parseWhere(where) {
  const preds = [];
  if (!where || !where.trim()) return preds;
  const parts = where.split(/\bAND\b/i);
  for (const raw of parts) {
    const p = raw.trim().replace(/^WHERE\s+/i, '');
    const m = /^(.+?)\s*(=|=~)\s*(.+)$/.exec(p);
    if (!m) throw new ToolInputError('QUERY_PARSE_ERROR', `cannot parse WHERE predicate: "${p}" (supported: var.prop = 'value' | var.prop =~ /re/)`);
    const lhs = m[1].trim();
    if (!PROP_REF.test(lhs)) throw new ToolInputError('QUERY_PARSE_ERROR', `unsupported WHERE left side "${lhs}" (use var.prop with prop in name|label|file|qualname|line|language)`);
    let rhs = m[3].trim();
    if (m[2] === '=') {
      const s = /^'(.*)'$/.exec(rhs) || /^"(.*)"$/.exec(rhs);
      if (!s) throw new ToolInputError('QUERY_PARSE_ERROR', `= needs a quoted string, got ${rhs}`);
      preds.push({ lhs, op: 'eq', value: s[1] });
    } else {
      const r = /^\/(.*)\/$/.exec(rhs);
      if (!r) throw new ToolInputError('QUERY_PARSE_ERROR', `=~ needs /regex/, got ${rhs}`);
      preds.push({ lhs, op: 're', value: new RegExp(r[1], 'i') });
    }
  }
  return preds;
}

export async function handler(args = {}) {
  const q = String(args.query || '').trim();
  if (!q) throw new ToolInputError('QUERY_REQUIRED', 'query is required');
  const m = MATCH_RE.exec(q);
  if (!m) {
    throw new ToolInputError('QUERY_PARSE_ERROR', 'expected: MATCH (a:Label)-[:TYPE]->(b) WHERE … RETURN props [LIMIT n]');
  }
  const [, va, la, etype, vb, lb, rest] = m;
  const retMatch = /RETURN\s+(.+)$/i.exec(rest.split(/\bLIMIT\b/i)[0]);
  if (!retMatch) throw new ToolInputError('QUERY_PARSE_ERROR', 'missing RETURN clause');
  const limitMatch = /\bLIMIT\s+(\d+)/i.exec(rest);
  const limit = Math.min(limitMatch ? Number(limitMatch[1]) : 20, 200);
  const columns = retMatch[1].split(',').map((c) => c.trim());
  for (const c of columns) {
    if (!PROP_REF.test(c)) throw new ToolInputError('QUERY_PARSE_ERROR', `unsupported RETURN item "${c}" (use var.prop)`);
  }
  const whereClause = rest.split(/\bRETURN\b/i)[0];
  const preds = parseWhere(whereClause);

  const store = await getStore();
  const project = String(args.project || 'jexi-os');
  const byId = new Map(store.nodes(project).map((n) => [n.id, n]));
  const rows = [];
  for (const e of store.edges(project)) {
    if (e.type !== etype) continue;
    const a = byId.get(e.src);
    const b = byId.get(e.dst);
    if (!a || !b) continue;
    if (la && a.label !== la) continue;
    if (lb && b.label !== lb) continue;
    const env = { [va]: a, [vb]: b };
    let ok = true;
    for (const p of preds) {
      const [v, prop] = p.lhs.split('.');
      const node = env[v];
      if (!node) throw new ToolInputError('QUERY_PARSE_ERROR', `WHERE references unknown variable "${v}"`);
      const actual = String(node[prop]);
      if (p.op === 'eq' ? actual !== p.value : !p.value.test(actual)) { ok = false; break; }
    }
    if (!ok) continue;
    rows.push(columns.map((c) => {
      const [v, prop] = c.split('.');
      return env[v][prop];
    }));
    if (rows.length >= limit) break;
  }
  return { ok: true, columns, rows, count: rows.length };
}
