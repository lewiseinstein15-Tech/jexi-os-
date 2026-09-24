/**
 * JEXI OS — Phase 14 Scope A — live probe for the context graph.
 * Run: node scripts/phase14-a-probe.mjs
 */
import { graph, SemanticaError } from '../services/semantica/graph/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`PASS ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const expectCode = (fn, code, label) => {
  try { fn(); ok(false, `${label} (no throw)`); }
  catch (e) { ok(e instanceof SemanticaError && e.code === code, `${label} -> ${e.code}`); }
};

function buildSample() {
  const g = graph.create();
  // P1: 5 entities, 6 relations (edges)
  g.addNode({ id: 'auth', kind: 'entity', label: 'auth-service', props: { tier: 'core' } });
  g.addNode({ id: 'db', kind: 'entity', label: 'postgres', props: { tier: 'core' } });
  g.addNode({ id: 'api', kind: 'entity', label: 'gateway', props: { tier: 'edge' } });
  g.addNode({ id: 'cache', kind: 'entity', label: 'redis', props: { tier: 'edge' } });
  g.addNode({ id: 'ui', kind: 'entity', label: 'console', props: { tier: 'edge' } });
  g.addNode({ id: 'uses-auth', kind: 'relation', label: 'api uses auth' });
  g.addEdge({ from: 'api', to: 'auth', kind: 'calls' });
  g.addEdge({ from: 'auth', to: 'db', kind: 'reads' });
  g.addEdge({ from: 'auth', to: 'cache', kind: 'writes' });
  g.addEdge({ from: 'ui', to: 'api', kind: 'calls' });
  g.addEdge({ from: 'api', to: 'cache', kind: 'reads' });
  g.addEdge({ from: 'api', to: 'uses-auth', kind: 'has-relation' });
  return g;
}

// P1 — counts
const g = buildSample();
console.log(`P1: nodes=${g.nodeCount} edges=${g.edgeCount}`);
ok(g.nodeCount === 6 && g.edgeCount === 6, 'P1 node/edge counts (5 entities + 1 relation node, 6 edges)');
ok(g.nodes().filter((n) => n.kind === 'entity').length === 5, 'P1 five entities present');

// P2 — query subsets
ok(g.query({ kind: 'entity' }).length === 5, 'P2 query kind=entity -> 5');
ok(g.query({ kind: 'relation' }).map((n) => n.id).join(',') === 'uses-auth', 'P2 query kind=relation -> [uses-auth]');
ok(g.query({ kind: 'entity', label: 'gateway' }).map((n) => n.id).join(',') === 'api', 'P2 query label -> [api]');
ok(g.query({ prop: { tier: 'core' } }).map((n) => n.id).join(',') === 'auth,db', 'P2 query prop tier=core -> auth,db (id order)');

// P3 — traverse 2 hops over a chain
const t = graph.create();
['n1', 'n2', 'n3', 'n4'].forEach((id) => t.addNode({ id, kind: 'entity', label: id }));
t.addEdge({ from: 'n1', to: 'n2', kind: 'causes' });
t.addEdge({ from: 'n2', to: 'n3', kind: 'causes' });
t.addEdge({ from: 'n3', to: 'n4', kind: 'causes' });
const two = t.traverse('n1', { depth: 2 }).map((n) => n.id).join(',');
ok(two === 'n1,n2,n3', `P3 traverse 2 hops -> {n1,n2,n3} (got ${two})`);
// same chain plus a shortcut edge of another kind: restriction must ignore it
t.addEdge({ from: 'n1', to: 'n4', kind: 'unrelated' });
const open1 = t.traverse('n1', { depth: 1 }).map((n) => n.id).join(',');
ok(open1 === 'n1,n2,n4', `P3 unrestricted 1 hop sees the shortcut (got ${open1})`);
const causal = t.traverse('n1', { depth: 3, edgeKinds: ['causes'] }).map((n) => n.id).join(',');
ok(causal === 'n1,n2,n3,n4', `P3 traverse restricted to causes reaches full chain (got ${causal})`);

// P4 — typed errors
expectCode(() => g.addNode({ id: 'x', kind: 'widget' }), 'E_UNKNOWN_NODE_KIND', 'P4 unknown node kind');
expectCode(() => g.addNode({ id: 'auth', kind: 'entity' }), 'E_DUPLICATE_NODE', 'P4 duplicate node id');
expectCode(() => g.addEdge({ from: 'ghost', to: 'db', kind: 'reads' }), 'E_UNKNOWN_NODE', 'P4 edge with missing endpoint');

// P5 — determinism: two independent builds -> byte-identical serialization
const s1 = buildSample().serialize();
const s2 = buildSample().serialize();
ok(s1 === s2, `P5 byte-identical serialization (${s1.length} bytes twice)`);

console.log(`\nSCOPE A: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
