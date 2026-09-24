/**
 * JEXI OS — Phase 26 Scope C — live probe for the instinct store.
 * Run: node scripts/phase26-c-probe.mjs
 */
import fs from 'node:fs';
import { createInstincts } from '../mind/instincts/core/index.js';
import { createInstinctStore } from '../mind/instincts/store/index.js';
import { nextOp } from '../mind/instincts/observe/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

function buildSequence(root) {
  const core = createInstincts(root);
  const store = createInstinctStore(root);
  const a = core.create({ projectId: 'proj-x', action: 'alpha-action', evidence: ['a0'], examples: [] });
  let b = core.create({ projectId: 'proj-x', action: 'beta-action', evidence: ['b0'], examples: [] });
  let c = core.create({ projectId: 'proj-x', action: 'gamma-action', evidence: ['c0'], examples: [] });
  for (let k = 0; k < 3; k += 1) b = core.reinforce(b.id, { projectId: 'proj-x', evidence: 'b' + (k + 1) });
  for (let k = 0; k < 6; k += 1) c = core.reinforce(c.id, { projectId: 'proj-x', evidence: 'c' + (k + 1) });
  return { core, store, ids: { a: a.id, b: b.id, c: c.id } };
}

const ROOT = '/tmp/p26-store';
fs.rmSync(ROOT, { recursive: true, force: true });
const { core, store, ids } = buildSequence(ROOT);

// P1 — save + ordered list
const s1 = store.save(core.get('proj-x', ids.a));
const s2 = store.save(core.get('proj-x', ids.b));
const s3 = store.save(core.get('proj-x', ids.c));
const listed = store.list('proj-x');
console.log('P1 saved: ' + [s1, s2, s3].map((s) => s.id + '=' + s.confidence).join(', '));
console.log('P1 list order: ' + listed.map((i) => i.id + '=' + i.confidence).join(', '));
ok(listed.length === 3 && listed.map((i) => i.confidence).join() === '0.9,0.6,0.3', 'P1 list -> 3 instincts ordered 0.9, 0.6, 0.3');
const snapshotAfterP1 = JSON.stringify(listed); // captured BEFORE P4/P5 mutate this root

// P2 — get
const ga = store.get(ids.a, { projectId: 'proj-x' });
ok(ga.id === ids.a && ga.action === 'alpha-action', 'P2 get by id -> correct instinct');

// P3 — cross-project get
const cross = errOf(() => store.get(ids.a, { projectId: 'proj-y' }));
console.log('P3 get(' + ids.a + ', proj-y) -> ' + (cross ? cross.code : 'no error'));
ok(cross && cross.code === 'E_SCOPE_MISMATCH', 'P3 cross-project get -> E_SCOPE_MISMATCH');
const nowhere = errOf(() => store.get('instinct-ghost', { projectId: 'proj-x' }));
ok(nowhere && nowhere.code === 'E_UNKNOWN_INSTINCT', 'P3 unknown-everywhere id -> E_UNKNOWN_INSTINCT');

// P4 — idempotent save: bumped reinforceCount, evidence unioned
const before = store.get(ids.a, { projectId: 'proj-x' });
const bumped = { ...before, reinforceCount: before.reinforceCount + 1, evidence: [...before.evidence, { text: 'new-evidence', at: 9999 }] };
const s4 = store.save(bumped);
const after = store.get(ids.a, { projectId: 'proj-x' });
console.log('P4 confidence ' + before.confidence + ' -> ' + after.confidence + ' | evidence ' + before.evidence.length + ' -> ' + after.evidence.length);
ok(s4.confidence === 0.4 && after.confidence === 0.4, 'P4 re-save recomputes confidence (0.3 + 0.1 = 0.4)');
ok(after.evidence.length === 2 && after.evidence.some((e) => e.text === 'new-evidence'), 'P4 evidence unioned (dedup by (text, at))');
const s4again = store.save(bumped);
ok(store.get(ids.a, { projectId: 'proj-x' }).evidence.length === 2 && s4again.confidence === 0.4, 'P4 save is idempotent (re-save changes nothing)');

// P5 — prune removes only the stale low-confidence instinct
nextOp(ROOT); nextOp(ROOT); nextOp(ROOT); nextOp(ROOT); // advance op-seq past the old lastSeenAt values
const pruned = store.prune('proj-x', { olderThanOpSeq: 2 });
const afterPrune = store.list('proj-x');
console.log('P5 pruned=' + pruned.pruned + ' ids=' + JSON.stringify(pruned.ids) + ' | list now ' + afterPrune.length);
ok(pruned.pruned === 1 && pruned.ids.join() === ids.a, 'P5 prune removed exactly the 0.4-confidence stale instinct');
ok(afterPrune.length === 2 && afterPrune.map((i) => i.confidence).join() === '0.9,0.6', 'P5 list now 2 (0.9, 0.6 survive)');

// P6 — minConfidence filter
const filtered = store.list('proj-x', { minConfidence: 0.5 });
ok(filtered.length === 2 && filtered.map((i) => i.confidence).join() === '0.9,0.6', 'P6 minConfidence 0.5 -> 2 instincts');

// P7 — determinism
const ROOT2 = '/tmp/p26-store2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const seq2 = buildSequence(ROOT2);
seq2.store.save(seq2.core.get('proj-x', seq2.ids.a));
seq2.store.save(seq2.core.get('proj-x', seq2.ids.b));
seq2.store.save(seq2.core.get('proj-x', seq2.ids.c));
ok(JSON.stringify(seq2.store.list('proj-x')) === snapshotAfterP1, 'P7 same save sequence -> byte-identical list');

console.log('');
console.log('SCOPE C: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
