/**
 * JEXI OS — Phase 14 Scope B — live probe for PROV-O provenance.
 * Run: node scripts/phase14-b-probe.mjs
 */
import { graph, SemanticaError } from '../semantica/graph/index.js';
import { prov } from '../semantica/provenance/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`PASS ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const expectCode = (fn, code, label) => {
  try { fn(); ok(false, `${label} (no throw)`); }
  catch (e) { ok(e instanceof SemanticaError && e.code === code, `${label} -> ${e.code}`); }
};

// P1 — attach + of shape
const g = graph.create();
const n = g.addNode({ id: 'fact-1', kind: 'entity', label: 'phase-14 merged' });
const agent = prov.makeAgent({ id: 'agent:lewis', label: 'Lewis' });
const activity = prov.makeActivity({ id: 'act:merge-check', label: 'merge verification' });
prov.attach(n, { agent, activity, source: 'arena-session', when: '2026-09-21T00:00:00Z' });
const rec = prov.of(n);
console.log(`P1 record: ${JSON.stringify({ agent: rec.agent, activity: rec.activity, source: rec.source, when: rec.when, parent: rec.parent })}`);
ok(rec && rec.source === 'arena-session' && rec.parent === null, 'P1 prov.of returns the attached record');
ok(rec.agent.provType === 'Agent' && rec.activity.provType === 'Activity', 'P1 PROV-O Agent/Activity refs preserved');

// P2 — enforcement through prov.strictGraph()
const sg = prov.strictGraph();
expectCode(() => sg.addNode({ id: 'e1', kind: 'entity', label: 'no-prov' }), 'E_MISSING_PROVENANCE', 'P2 strict addNode without provenance');
expectCode(() => { sg.addNode({ id: 'ok1', kind: 'entity', label: 'a' }, { agent: 'ag', activity: 'ac', source: 's', when: 1 }); sg.addEdge({ from: 'ok1', to: 'missing', kind: 'x' }, { agent: 'ag', activity: 'ac', source: 's', when: 1 }); }, 'E_UNKNOWN_NODE', 'P2 (sanity) endpoint check still live');
expectCode(() => { const a = sg.addNode({ id: 'a', kind: 'entity', label: 'a' }, { agent: 'ag', activity: 'ac', source: 's', when: 1 }); sg.addEdge({ from: 'a', to: 'ghost', kind: 'k' }, { agent: 'ag', activity: 'ac', source: 's', when: 1 }); }, 'E_UNKNOWN_NODE', 'P2 (sanity) edge endpoint');
const sg2 = prov.strictGraph();
const en = sg2.addNode({ id: 'e1', kind: 'entity', label: 'with-prov' }, { agent: 'ag', activity: 'ac', source: 'src-1', when: 1 });
expectCode(() => sg2.addEdge({ from: 'e1', to: 'e1', kind: 'self' }), 'E_MISSING_PROVENANCE', 'P2 strict addEdge without provenance');
ok(prov.has(en) === true && prov.of(en).source === 'src-1', 'P2 node added WITH provenance carries it');

// P3 — immutability
expectCode(() => { rec.agent = 'mallory'; }, 'E_PROV_IMMUTABLE', 'P3 mutate attached provenance');
expectCode(() => prov.attach(n, { agent: 'x', activity: 'y', source: 'z', when: 2 }), 'E_PROV_IMMUTABLE', 'P3 second attach refuses');

// P4 — trace chain of 3
const t1 = g.addNode({ id: 'root-fact', kind: 'entity', label: 'root' });
const t2 = g.addNode({ id: 'mid-fact', kind: 'entity', label: 'mid' });
const t3 = g.addNode({ id: 'leaf-fact', kind: 'entity', label: 'leaf' });
prov.attach(t1, { agent: 'ag', activity: 'a1', source: 'src-root', when: 1 });
prov.attach(t2, { agent: 'ag', activity: 'a2', source: 'src-mid', when: 2, parent: t1 });
prov.attach(t3, { agent: 'ag', activity: 'a3', source: 'src-leaf', when: 3, parent: t2 });
const chain = prov.trace(t3).map((r) => r.source).join(',');
ok(chain === 'src-leaf,src-mid,src-root', `P4 trace chain of 3 in order (got ${chain})`);

// P5 — depth limits
ok(prov.trace(t3, { depth: 1 }).length === 1, 'P5 depth=1 -> 1 record');
ok(prov.trace(t3, { depth: 0 }).map((r) => r.source).join(',') === 'src-leaf', 'P5 depth=0 -> just the target');
ok(prov.trace(t3, { depth: 2 }).length === 2, 'P5 depth=2 -> 2 records');

// P6 — determinism: same sequence twice -> byte-identical
function seq() {
  const gg = graph.create();
  const a = gg.addNode({ id: 'a', kind: 'entity', label: 'a' });
  const b = gg.addNode({ id: 'b', kind: 'entity', label: 'b' });
  prov.attach(a, { agent: 'ag', activity: 'ac', source: 's1', when: 10 });
  prov.attach(b, { agent: 'ag', activity: 'ac', source: 's2', when: 20, parent: a });
  return JSON.stringify(prov.trace(b));
}
const d1 = seq(); const d2 = seq();
ok(d1 === d2, `P6 byte-identical attach+trace output (${d1.length} bytes twice)`);

console.log(`\nSCOPE B: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
