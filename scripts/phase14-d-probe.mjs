/**
 * JEXI OS — Phase 14 Scope D — live probe for ontology + validation + dedup.
 * Run: node scripts/phase14-d-probe.mjs
 */
import { ontology, SemanticaError } from '../services/semantica/ontology/index.js';
import { prov } from '../services/semantica/provenance/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`PASS ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const expectCode = (fn, code, label) => {
  try { fn(); ok(false, `${label} (no throw)`); }
  catch (e) { ok(e instanceof SemanticaError && e.code === code, `${label} -> ${e.code}`); }
};

// P1 — declaration shape
const { ontology: ont } = ontology.declare({
  classes: [
    { name: 'entity' },
    { name: 'relation' },
    { name: 'decision', constraints: { requiredProps: ['rationale'] } },
  ],
  relations: [
    { kind: 'uses-auth' },
    { kind: 'causes' },
    { kind: 'supersedes' },
    { kind: 'depends-on', constraints: { from: 'entity', to: 'entity' } },
  ],
});
console.log(`P1 declaration: ${JSON.stringify(ont.toJSON())}`);
ok(ont.toJSON().classes.length === 3 && ont.toJSON().relations.length === 4, 'P1 3 classes + 4 relations declared');

// P2 — validation
ok(ont.validate({ id: 'e', kind: 'entity', label: 'x', props: {} }).valid === true, 'P2 valid node -> valid:true');
expectCode(() => ont.validate({ id: 'w', kind: 'widget', label: 'x' }), 'E_UNDECLARED_KIND', 'P2 undeclared node kind');
expectCode(() => ont.validate({ from: 'a', to: 'b', kind: 'hates' }), 'E_UNDECLARED_RELATION', 'P2 undeclared edge relation');
expectCode(() => ont.declare({ classes: [{ name: 'entity', constraints: { requiredProps: ['owner'] } }] }), 'E_ONTOLOGY_CONFLICT', 'P2 redeclare class with different constraints');
ok(ont.validate({ id: 'd', kind: 'decision', label: 'x', props: { rationale: 'r' } }).valid === true, 'P2 declared constraints satisfied');
const bad = ont.validate({ id: 'd2', kind: 'decision', label: 'x', props: {} });
ok(bad.valid === false && bad.errors.length === 1, `P2 constraint violation -> ${JSON.stringify(bad.errors)}`);

// P3 — dedup groups
const nodes = [
  { id: 'api-1', kind: 'entity', label: 'API' },
  { id: 'api-2', kind: 'entity', label: 'api ' },
  { id: 'db-1', kind: 'entity', label: 'postgres' },
  { id: 'rel-1', kind: 'relation', label: 'API' },
];
const plan = ontology.deduplicate(nodes);
console.log(`P3 plan: ${JSON.stringify(plan)}`);
ok(plan.groups.length === 1 && plan.groups[0].members.length === 2, 'P3 one group, two members (same kind + normalized label)');
ok(plan.merged[0].keep === 'api-1' && plan.merged[0].absorb.join(',') === 'api-2', 'P3 survivor = lowest id');

// P4 — apply merge: 3 edges into the absorbed node all rewritten
const data = {
  nodes: [...nodes],
  edges: [
    { from: 'c1', to: 'api-2', kind: 'calls' },
    { from: 'c2', to: 'api-2', kind: 'calls' },
    { from: 'c3', to: 'api-2', kind: 'depends-on' },
    { from: 'api-1', to: 'db-1', kind: 'reads' },
  ],
};
const before = data.edges.map((e) => `${e.from}->${e.to}`).sort().join(',');
const after = ontology.applyMerge(data, plan);
const afterSet = after.edges.map((e) => `${e.from}->${e.to}`).sort().join(',');
console.log(`P4 before: ${before}`);
console.log(`P4 after:  ${afterSet}`);
ok(after.edges.filter((e) => e.to === 'api-1').length === 3, 'P4 all 3 edges now point to the survivor');
ok(!after.nodes.some((n) => n.id === 'api-2'), 'P4 absorbed node removed');
// load rebuilt arrays into a provenanced live graph and prove connectivity
const sg = prov.strictGraph();
const PROV = { agent: 'agent:ontology', activity: 'activity:dedup-rebuild', source: 'ontology.applyMerge', when: 1 };
for (const n of [...after.nodes, { id: 'c1', kind: 'entity', label: 'c1' }, { id: 'c2', kind: 'entity', label: 'c2' }, { id: 'c3', kind: 'entity', label: 'c3' }]) {
  sg.addNode({ ...n, props: n.props ?? {} }, PROV);
}
for (const e of after.edges) sg.addEdge(e, PROV);
const reach = sg.traverse('c1', { depth: 10 }).map((n) => n.id).sort().join(',');
ok(reach.includes('api-1') && reach.includes('db-1'), `P4 rebuilt graph connected (c1 reaches ${reach})`);

// P5 — determinism
const p1 = JSON.stringify(ontology.deduplicate(nodes));
const p2 = JSON.stringify(ontology.deduplicate([...nodes].reverse()));
ok(p1 === p2, 'P5 byte-identical plan regardless of input order');

console.log(`\nSCOPE D: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
