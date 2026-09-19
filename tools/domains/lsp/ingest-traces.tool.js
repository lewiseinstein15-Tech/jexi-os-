// CBM tool — ingest-traces: validate HTTP_CALLS edges from runtime traces.
// CBM contract (RUNTIME_TRACE_MODEL.md): runtime observations are an OVERLAY —
// they may validate existing HTTP_CALLS edges but must NEVER mutate the
// static graph.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'ingest-traces',
  description: 'Ingest runtime trace observations to validate existing HTTP_CALLS edges — overlay only, never mutates static graph edges.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      traces: {
        type: 'array',
        description: 'Observations: [{ caller, endpoint, method?, status? }] — caller is a symbol name, endpoint a URL or /api path.',
        items: {
          type: 'object',
          properties: {
            caller: { type: 'string' },
            endpoint: { type: 'string' },
            method: { type: 'string' },
            status: { type: 'number' },
          },
          required: ['caller', 'endpoint'],
          additionalProperties: false,
        },
        minItems: 1,
      },
    },
    required: ['traces'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, overlayId, validated, unmatched, staticEdgesUntouched: true }' },
  riskLevel: 'medium',
  runtimeRing: 2,
  sideEffects: ['graph-db-meta'],
  idempotent: false,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const traces = args.traces;
  if (!Array.isArray(traces) || traces.length === 0) {
    throw new ToolInputError('TRACES_REQUIRED', 'traces must be a non-empty array of { caller, endpoint }');
  }
  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const nodes = store.nodes(project);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nameIndex = new Map();
  for (const n of nodes) {
    if (!nameIndex.has(n.name)) nameIndex.set(n.name, []);
    nameIndex.get(n.name).push(n);
  }

  const hostSet = new Set();
  const routeSet = new Set();
  for (const n of nodes) {
    if (n.label === 'Resource' && n.props?.kind === 'http-host') hostSet.add(n.name);
    if (n.label === 'Route') routeSet.add(n.props?.path || n.name.split(' ').slice(1).join(' '));
  }

  const validated = [];
  const unmatched = [];
  for (const t of traces) {
    const endpoint = String(t.endpoint || '');
    if (!endpoint) { unmatched.push({ ...t, reason: 'empty endpoint' }); continue; }
    let known = false;
    if (/^https?:\/\//.test(endpoint)) {
      const host = /^https?:\/\/([^/'"]+)/.exec(endpoint)?.[1];
      known = host ? hostSet.has(host) : false;
    } else if (endpoint.startsWith('/api/')) {
      known = routeSet.has(endpoint.split('?')[0]);
    } else {
      unmatched.push({ ...t, reason: 'endpoint is neither http(s) URL nor /api path' });
      continue;
    }
    const callerKnown = t.caller ? nameIndex.has(t.caller) : false;
    if (known) {
      validated.push({ caller: t.caller || null, callerKnown, endpoint, method: t.method || null, status: t.status ?? null });
    } else {
      unmatched.push({ caller: t.caller, endpoint, reason: 'endpoint not present in static HTTP_CALLS graph' });
    }
  }

  const overlayId = `overlay-${Date.now().toString(36)}`;
  const overlay = { id: overlayId, ingestedAt: new Date().toISOString(), validated, unmatched };
  // Overlay stored under a dedicated meta key — static edges deliberately untouched.
  store.setMeta(`${project}:runtime-overlay:${overlayId}`, JSON.stringify(overlay));
  store.flush();
  return {
    ok: true,
    overlayId,
    ingested: traces.length,
    validated: validated.length,
    unmatched: unmatched.length,
    unmatchedDetail: unmatched.slice(0, 5),
    staticEdgesUntouched: true,
  };
}
