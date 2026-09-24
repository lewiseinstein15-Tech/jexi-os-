/**
 * JEXI OS — Phase 8 Scope C — QUERY: attack-paths (traversal across edges).
 *
 * Decepticon pattern: agents ASK THE GRAPH for context instead of carrying
 * it in memory. This query answers "from an initial foothold, which attack
 * paths reach the target?" over the typed entity graph.
 *
 * TRAVERSAL MODEL (directed; derived edges come from entity columns,
 * explicit edges from the edges table):
 *
 *   host          -has-service->       service        (derived: service.host_id)
 *   service       -has-vulnerability-> vulnerability (derived: vulnerability.service_id)
 *   vulnerability -exploited-by->      exploit       (derived; traversal only through
 *                                                      exploits with succeeded = 1 —
 *                                                      "no exploit, no path")
 *   exploit       -grants->            credential    (derived: credential.obtained_via = exploit.id)
 *   credential    -resides-on->        host          (derived: credential.host_id)
 *   credential    -escalates-to->      credential    (explicit edge)
 *   service       -connects-to->       host          (explicit edge)
 *   host          -moves-lateral-to->  host          (explicit edge; traversable ONLY while
 *                                                      the enabling credential is in
 *                                                      POSSESSION on the current path)
 *
 * POSSESSION (path-local, monotone — immutable per branch):
 *   - starts with the from-node when it is a credential (+ escalates-to closure)
 *   - grows when a traversed succeeded exploit grants a credential
 *   - grows with every credential residing on a visited host
 *   - closes over escalates-to edges
 *
 * DETERMINISM (probe P10): adjacency is built from ORDER BY queries and
 * expanded in sorted order; collected paths are sorted by (edge count,
 * then lexicographic node sequence). Identical graph state yields
 * byte-identical results.
 *
 * Simple paths only (no node revisits). Safety caps: maxDepth 14 edges,
 * maxPaths 500 collected paths.
 */

const MAX_DEPTH = 14;
const MAX_PATHS = 500;

export function attackPaths(graph, { fromType, fromId, toType, toId, maxDepth = MAX_DEPTH } = {}) {
  if (!fromType || !fromId || !toType || !toId) {
    throw new Error('attackPaths: fromType, fromId, toType, toId are required');
  }
  if (!existsNode(graph, fromType, fromId)) throw new Error(`attackPaths: from-node ${fromType}:${fromId} does not exist in the graph`);
  if (!existsNode(graph, toType, toId)) throw new Error(`attackPaths: to-node ${toType}:${toId} does not exist in the graph`);

  const { adj, credsOnHost, escalations } = buildAdjacency(graph);

  const paths = [];
  const visited = new Set([`#${fromType}#${fromId}`]);
  const startPossession = fromType === 'credential' ? new Set([fromId]) : new Set();
  closeOver(escalations, startPossession);

  const dfs = (node, path, possession) => {
    if (paths.length >= MAX_PATHS) return;
    if (node.type === toType && node.id === toId) {
      paths.push(path.slice());
      return;
    }
    if (path.length >= maxDepth) return;

    for (const step of adjFor(adj, node)) {
      const key = `#${step.to.type}#${step.to.id}`;
      if (visited.has(key)) continue;
      if (step.requiresCredential && !possession.has(step.requiresCredential)) continue;

      // possession is immutable per branch — correct backtracking by construction
      const next = new Set(possession);
      if (step.to.type === 'credential') next.add(step.to.id);
      if (step.to.type === 'host') {
        for (const c of credsOnHost.get(step.to.id) || []) next.add(c);
      }
      closeOver(escalations, next);

      visited.add(key);
      path.push(step);
      dfs(step.to, path, next);
      path.pop();
      visited.delete(key);
    }
  };

  dfs({ type: fromType, id: fromId }, [], startPossession);

  paths.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    const ka = a.map((s) => `${s.edge}>${s.to.type}:${s.to.id}`).join('|');
    const kb = b.map((s) => `${s.edge}>${s.to.type}:${s.to.id}`).join('|');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    from: { type: fromType, id: fromId },
    to: { type: toType, id: toId },
    pathCount: paths.length,
    paths: paths.map((p) => ({
      hops: p.length,
      nodes: [{ type: fromType, id: fromId }, ...p.map((s) => s.to)],
      edges: p.map((s) => ({
        edge: s.edge,
        from: s.from,
        to: s.to,
        ...(s.requiresCredential ? { viaCredential: s.requiresCredential } : {}),
        ...(s.via !== undefined ? { via: s.via } : {}),
      })),
    })),
  };
}

/* ----------------------------- adjacency build ----------------------------- */

function buildAdjacency(graph) {
  const db = graph.store.db;
  const adj = new Map(); // "#type#id" -> [step, ...]
  const credsOnHost = new Map();
  const escalations = [];

  const push = (fromType, fromId, step) => {
    const k = `#${fromType}#${fromId}`;
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push(step);
  };
  const order = (a, b) => (a.edge === b.edge ? cmpNode(a.to, b.to) : a.edge < b.edge ? -1 : 1);

  for (const s of db.prepare('SELECT id, host_id FROM services ORDER BY id').all()) {
    push('host', s.host_id, { edge: 'has-service', from: { type: 'host', id: s.host_id }, to: { type: 'service', id: s.id } });
  }
  for (const v of db.prepare('SELECT id, service_id FROM vulnerabilities ORDER BY id').all()) {
    push('service', v.service_id, { edge: 'has-vulnerability', from: { type: 'service', id: v.service_id }, to: { type: 'vulnerability', id: v.id } });
  }
  for (const e of db.prepare('SELECT id, vulnerability_id, method FROM exploits WHERE succeeded = 1 ORDER BY id').all()) {
    push('vulnerability', e.vulnerability_id, { edge: 'exploited-by', from: { type: 'vulnerability', id: e.vulnerability_id }, to: { type: 'exploit', id: e.id }, via: e.method });
  }
  for (const c of db.prepare('SELECT id, host_id, obtained_via FROM credentials ORDER BY id').all()) {
    if (c.obtained_via) {
      push('exploit', c.obtained_via, { edge: 'grants', from: { type: 'exploit', id: c.obtained_via }, to: { type: 'credential', id: c.id } });
    }
    push('credential', c.id, { edge: 'resides-on', from: { type: 'credential', id: c.id }, to: { type: 'host', id: c.host_id } });
    if (!credsOnHost.has(c.host_id)) credsOnHost.set(c.host_id, []);
    credsOnHost.get(c.host_id).push(c.id);
  }
  for (const e of graph.connectsTo.list()) {
    push('service', e.src.id, { edge: 'connects-to', from: { type: 'service', id: e.src.id }, to: { type: 'host', id: e.dst.id } });
  }
  for (const e of graph.escalatesTo.list()) {
    escalations.push({ from: e.src.id, to: e.dst.id });
    push('credential', e.src.id, { edge: 'escalates-to', from: { type: 'credential', id: e.src.id }, to: { type: 'credential', id: e.dst.id }, ...(e.privilege ? { via: e.privilege } : {}) });
  }
  for (const e of graph.movesLateralTo.list()) {
    push('host', e.src.id, { edge: 'moves-lateral-to', from: { type: 'host', id: e.src.id }, to: { type: 'host', id: e.dst.id }, requiresCredential: e.viaCredentialId });
  }

  for (const steps of adj.values()) steps.sort(order);
  for (const list of credsOnHost.values()) list.sort();
  return { adj, credsOnHost, escalations };
}

/** Transitive closure of escalates-to over a possession set (in place). */
function closeOver(escalations, set) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const esc of escalations) {
      if (set.has(esc.from) && !set.has(esc.to)) { set.add(esc.to); changed = true; }
    }
  }
}

function cmpNode(a, b) {
  const ka = `${a.type}#${a.id}`;
  const kb = `${b.type}#${b.id}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function adjFor(map, node) {
  return map.get(`#${node.type}#${node.id}`) || [];
}

function existsNode(graph, type, id) {
  const db = graph.store.db;
  const table = { host: 'hosts', service: 'services', vulnerability: 'vulnerabilities', exploit: 'exploits', credential: 'credentials' }[type];
  if (!table) throw new Error(`attackPaths: unknown node type "${type}"`);
  return !!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
}
