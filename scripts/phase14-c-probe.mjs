/**
 * JEXI OS — Phase 14 Scope C — live probe for the decision log.
 * Run: node scripts/phase14-c-probe.mjs
 */
import { decisions, SemanticaError } from '../services/semantica/decisions/index.js';
import { prov } from '../services/semantica/provenance/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`PASS ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const expectCode = (fn, code, label) => {
  try { fn(); ok(false, `${label} (no throw)`); }
  catch (e) { ok(e instanceof SemanticaError && e.code === code, `${label} -> ${e.code}`); }
};

const ALT = ['option-x', 'option-y'];

// P1 — 3 decisions on 2 subjects, append order
const d = decisions.create();
const r1 = d.record({ subject: 'auth', chosen: 'jwt', alternatives: ALT, rationale: 'stateless and boring to debug', by: 'lewis', when: 1 });
const r2 = d.record({ subject: 'auth', chosen: 'session-cookies', alternatives: ALT, rationale: 'revocation matters more', by: 'lewis', when: 2 });
const r3 = d.record({ subject: 'storage', chosen: 'postgres', alternatives: ['sqlite', 'postgres'], rationale: 'concurrent writers', by: 'arena', when: 3 });
console.log(`P1 log: ${d.list().map((x) => `${x.decisionId}|${x.subject}|${x.chosen}|${x.rationale}`).join(' ; ')}`);
ok(r1.decisionId === 'decision-001' && r3.decisionId === 'decision-003', 'P1 decisionId format sequential');
ok(d.list().length === 3, 'P1 log shows 3 decisions in order');

// P2 — list filter + get
ok(d.list({ subject: 'auth' }).map((x) => x.decisionId).join(',') === 'decision-001,decision-002', 'P2 list({subject}) filtered');
ok(d.get('decision-002').chosen === 'session-cookies', 'P2 get returns the record');

// P3 — intelligence + real path verified by traversal
const intel = d.intelligence('auth');
const manual = d.graph().traverse('decision-001', { depth: Number.MAX_SAFE_INTEGER, edgeKinds: ['supersedes'] }).map((n) => n.id).join(',');
ok(intel.decisions.length === 2, 'P3 intelligence returns the decisions');
ok(intel.path.join(',') === 'decision-001,decision-002', `P3 path through graph (got ${intel.path.join(',')})`);
ok(manual === intel.path.join(','), 'P3 path matches an independent traversal');

// P4 — conflicts
const cf = d.conflicts({ subject: 'auth' });
ok(cf.length === 1 && cf[0].a === 'decision-001' && cf[0].b === 'decision-002', `P4 contradictory pair flagged (${JSON.stringify(cf[0] || {})})`);
const d2 = decisions.create();
d2.record({ subject: 's', chosen: 'same', alternatives: ALT, rationale: 'r1', by: 'x', when: 1 });
d2.record({ subject: 's', chosen: 'same', alternatives: ALT, rationale: 'r2', by: 'x', when: 2 });
ok(d2.conflicts({ subject: 's' }).length === 0, 'P4 same chosen -> not a conflict');

// P5 — typed errors
expectCode(() => d.record({ subject: 'auth', chosen: 'z', alternatives: ALT, by: 'x' }), 'E_MISSING_RATIONALE', 'P5 missing rationale');
expectCode(() => d.record({ chosen: 'z', alternatives: ALT, rationale: 'r', by: 'x' }), 'E_MISSING_SUBJECT', 'P5 missing subject');
expectCode(() => d.record({ subject: 'auth', chosen: 'z', alternatives: [], rationale: 'r', by: 'x' }), 'E_MISSING_ALTERNATIVES', 'P5 empty alternatives');

// P6 — graph integration + provenance
const node = d.graph().getNode('decision-001');
ok(node && node.kind === 'decision', 'P6 decision node exists with kind decision');
const p = prov.of(node);
ok(p && p.agent === 'agent:lewis' && p.source === 'decisions.record(auth)', `P6 prov.of(decisionNode) -> ${JSON.stringify({ agent: p && p.agent, source: p && p.source })}`);

// P7 — determinism
function seq() {
  const dd = decisions.create();
  dd.record({ subject: 'a', chosen: 'x', alternatives: ALT, rationale: 'r', by: 'b', when: 1 });
  dd.record({ subject: 'a', chosen: 'y', alternatives: ALT, rationale: 'r', by: 'b', when: 2 });
  return JSON.stringify({ list: dd.list(), conflicts: dd.conflicts({}) });
}
const s1 = seq(); const s2 = seq();
ok(s1 === s2, `P7 byte-identical log output (${s1.length} bytes twice)`);

console.log(`\nSCOPE C: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
