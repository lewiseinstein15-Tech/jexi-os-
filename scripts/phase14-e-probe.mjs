/**
 * JEXI OS — Phase 14 Scope E — live probe for the reasoning engine.
 * Run: node scripts/phase14-e-probe.mjs
 */
import { graph, SemanticaError } from '../semantica/graph/index.js';
import { prov } from '../semantica/provenance/index.js';
import { reasoning } from '../semantica/reasoning/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`PASS ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const expectCode = (fn, code, label) => {
  try { fn(); ok(false, `${label} (no throw)`); }
  catch (e) { ok(e instanceof SemanticaError && e.code === code, `${label} -> ${e.code}`); }
};

// P1 — causal chain of 3 + confidence derivation
const g = graph.create();
['a', 'b', 'c'].forEach((id) => g.addNode({ id, kind: 'entity', label: id }));
g.addEdge({ from: 'a', to: 'b', kind: 'causes' });
g.addEdge({ from: 'b', to: 'c', kind: 'causes' });
const c1 = reasoning.causal(g, 'a');
console.log(`P1 chain: ${c1.chain.join(' -> ')} confidence=${c1.confidence} (derivation: 1 / ${c1.chain.length} hops)`);
ok(c1.chain.join(',') === 'a,b,c', 'P1 chain of 3 in order');
ok(Math.abs(c1.confidence - 1 / 3) < 1e-12, 'P1 confidence = 1/chain.length');
const cyc = graph.create();
['x', 'y'].forEach((id) => cyc.addNode({ id, kind: 'entity', label: id }));
cyc.addEdge({ from: 'x', to: 'y', kind: 'causes' });
cyc.addEdge({ from: 'y', to: 'x', kind: 'causes' });
expectCode(() => reasoning.causal(cyc, 'x'), 'E_CYCLE', 'P1 cycle in causes');

// P2 — single-node chain
const one = reasoning.causal(g, 'c');
ok(one.chain.length === 1 && one.confidence === 1, 'P2 chain len 1 -> confidence 1');

// P3 — temporal window inclusive
const tg = prov.strictGraph();
const PROV = (when) => ({ agent: 'agent:probe', activity: 'activity:t', source: 'probe', when });
['t10', 't20', 't30', 't40', 't50'].forEach((id, i) => {
  tg.addNode({ id, kind: 'entity', label: id }, PROV(`2026-01-01T00:00:${10 * (i + 1)}Z`.replace(':60', ':59')));
});
// when values: 10,20,30,40,50 seconds (last clamped to valid 59s? avoid :60)
const win = reasoning.temporal(tg, { after: '2026-01-01T00:00:20Z', before: '2026-01-01T00:00:40Z' }).map((n) => n.id).join(',');
ok(win === 't20,t30,t40', `P3 window inclusive both ends (got ${win})`);

// P4 — node without when -> E_MISSING_TIMESTAMP
const ng = graph.create();
ng.addNode({ id: 'stamped', kind: 'entity', label: 's' });
prov.attach(ng.getNode('stamped'), { agent: 'a', activity: 'b', source: 'c', when: 5 });
ng.addNode({ id: 'unstamped', kind: 'entity', label: 'u' });
expectCode(() => reasoning.temporal(ng, {}), 'E_MISSING_TIMESTAMP', 'P4 node without when');

// P5 — infer a rule: derived fact + provenance + confidence
const ig = graph.create();
ig.addNode({ id: 'svc-a', kind: 'entity', label: 'svc-a', props: { risk: 'high' } });
ig.addNode({ id: 'svc-b', kind: 'entity', label: 'svc-b', props: {} });
ig.addEdge({ from: 'svc-a', to: 'svc-b', kind: 'depends-on' });
const rule = {
  id: 'risk-propagation',
  weight: 0.8,
  when: (gr) => gr.edges().filter((e) => e.kind === 'depends-on' && gr.getNode(e.from).props.risk === 'high')
    .map((e) => ({ sources: [e.from, e.to], from: e.from, to: e.to })),
  then: (m) => [{ label: `${m.to} inherits risk from ${m.from}`, props: { inherits: 'risk' } }],
};
const res = reasoning.infer(ig, [rule]);
const dnode = res.derived[0];
const dprov = res.provenance[0];
console.log(`P5 derived: ${dnode.id} "${dnode.label}" confidence=${dnode.props.confidence} (derivation: weight 0.8 / ${dnode.props.sources.length} sources)`);
console.log(`P5 provenance: ${JSON.stringify({ agent: dprov.agent, activity: dprov.activity, source: dprov.source })}`);
ok(res.derived.length === 1 && dnode.props.rule === 'risk-propagation', 'P5 derived fact carries rule id');
ok(dprov.activity === 'activity:rule:risk-propagation' && dprov.source === 'rule:risk-propagation(svc-a,svc-b)', 'P5 provenance names rule + sources');
ok(Math.abs(dnode.props.confidence - 0.4) < 1e-12, 'P5 confidence = 0.8/2 = 0.4');

// P6 — determinism
function seqAll() {
  const gg = graph.create();
  ['a', 'b', 'c'].forEach((id) => gg.addNode({ id, kind: 'entity', label: id }));
  gg.addEdge({ from: 'a', to: 'b', kind: 'causes' });
  gg.addEdge({ from: 'b', to: 'c', kind: 'causes' });
  const cc = reasoning.causal(gg, 'a');
  const rr = reasoning.infer(gg, [{ id: 'r', weight: 1, when: (gr) => [{ sources: ['a', 'b'] }], then: () => [{ label: 'x' }] }]);
  return JSON.stringify({ chain: cc.chain, confidence: cc.confidence, derived: rr.derived.map((d) => ({ id: d.id, label: d.label, props: d.props })), provenance: rr.provenance.map((p) => ({ a: p.agent, s: p.source })) });
}
const s1 = seqAll(); const s2 = seqAll();
ok(s1 === s2, `P6 byte-identical reasoning output (${s1.length} bytes twice)`);

console.log(`\nSCOPE E: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
