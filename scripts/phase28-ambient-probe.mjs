/**
 * JEXI OS — Phase 28 Scope G live probe — retrieval reflex + ambient recall.
 * P1 pointers · P2 judgment · P3 fail-open · P4 pack · P5 delta cursor ·
 * P6 boundary · P7 escalation · P8 visibility · P9 determinism.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepo } from '../mind/brain/repo/index.js';
import { extract } from '../mind/brain/kg/index.js';
import {
  createBrainAmbient, DEFAULT_MAX_POINTERS, JUDGMENT_RULE,
  POINTER_INSTRUCTION, estimatePackTokens, PACK_PRIORITY,
} from '../mind/brain/ambient/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

// ── Fixture brain + Scope C KG ─────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28g-'));
const repo = createRepo(root);
const NOW = '2026-09-22T10:00:00Z';
repo.create('people', 'alice-example', {
  title: 'Alice Example',
  compiledTruth: 'Alice Example founded Acme Labs. Alice Example advises Bob Stone.',
  now: NOW,
});
repo.create('people', 'bob-stone', {
  title: 'Bob Stone',
  compiledTruth: 'Bob Stone works at Acme Labs and reviews engine designs.',
  now: NOW,
});
repo.create('companies', 'acme-labs', {
  title: 'Acme Labs',
  compiledTruth: 'Acme Labs builds analytical engines with Alice Example.',
  now: NOW,
});
const kgEdges = repo.list().flatMap((page) => extract(page).edges);
console.log('Fixture Scope C edges:', JSON.stringify(kgEdges));

const catalog = [
  { name: 'Alice Example', slug: 'people/alice-example', summary: 'Founder of Acme Labs and advisor to Bob Stone.', handle: '@alice', visibility: 'world' },
  { name: 'Bob Stone', slug: 'people/bob-stone', summary: 'Engineer who reviews analytical-engine designs.', handle: '@bob', visibility: 'world' },
  { name: 'Acme Labs', slug: 'companies/acme-labs', summary: 'Company building analytical engines.', handle: '@acme', visibility: 'world' },
  { name: 'Private Person', slug: 'people/private-person', summary: 'Private relationship context.', handle: '@private', visibility: 'private', page: { kind: 'people', slug: 'private-person', title: 'Private Person', compiledTruth: 'Private relationship context.' } },
];
const facts = [
  { id: 'f-alice', fact: 'Alice committed to review the launch plan.', kind: 'commitment', entity_slug: 'people/alice-example', visibility: 'world', rank: 10, op_seq: 2, superseded_by: null },
  { id: 'f-bob', fact: 'Bob prefers concise design notes.', kind: 'preference', entity_slug: 'people/bob-stone', visibility: 'world', rank: 9, op_seq: 3, superseded_by: null },
  { id: 'f-private', fact: 'Private Person has a confidential constraint.', kind: 'fact', entity_slug: 'people/private-person', visibility: 'private', rank: 20, op_seq: 4, superseded_by: null },
];
const threads = [
  { id: 't-alice', text: 'Open thread: confirm Alice launch review.', entity_slug: 'people/alice-example', visibility: 'world', priority: 8, op_seq: 3 },
  { id: 't-private', text: 'Open thread: private follow-up.', entity_slug: 'people/private-person', visibility: 'private', priority: 9, op_seq: 4 },
];
const changes = [
  { type: 'page', id: 'p1', slug: 'people/alice-example', title: 'Alice changed', visibility: 'world', op_seq: 1 },
  { type: 'fact', id: 'd-f1', fact: 'A world fact changed.', visibility: 'world', op_seq: 2 },
  { type: 'fact', id: 'd-private', fact: 'A private fact changed.', visibility: 'private', op_seq: 2 },
  { type: 'thread', id: 'd-t1', text: 'A world thread opened.', visibility: 'world', op_seq: 3 },
];
const runtime = createBrainAmbient({ repo, catalog, facts, threads, changes });
const { reflex, ambient } = runtime;

// ── P1: pointer scan + cap ─────────────────────────────────────────────────
console.log('── P1 deterministic pointer scan ──');
const turn = 'Compare Alice Example, @bob, and Acme Labs before our decision meeting.';
const pointers = reflex.point(turn, {});
console.log(`P1 declared default cap N=${DEFAULT_MAX_POINTERS}`);
for (const pointer of pointers) console.log('P1 pointer:', JSON.stringify(pointer));
ok(pointers.length === 3, 'P1 three salient entities -> three pointers');
ok(pointers.every((pointer) => pointer.name && pointer.slug && pointer.summary && pointer.instruction === POINTER_INSTRUCTION), 'P1 each pointer carries name + slug + summary + open-page instruction');
ok(pointers.map((pointer) => pointer.slug).join(',') === 'people/alice-example,people/bob-stone,companies/acme-labs', 'P1 pointers preserve mention order including @handle resolution');
const capped = reflex.point(turn, { maxPointers: 2 });
console.log('P1 override cap=2:', capped.map((pointer) => pointer.slug).join(', '));
ok(capped.length === 2, 'P1 pointer output obeys declared cap');

// ── P2: judgment gate ──────────────────────────────────────────────────────
console.log('── P2 judgment gate ──');
console.log('P2 declared rule:', JSON.stringify(JUDGMENT_RULE));
const trivial = reflex.point('FYI: Alice Example.', {});
const loaded = reflex.point('Review Alice Example before our project decision meeting.', { loadedSlugs: ['people/alice-example'] });
console.log('P2 trivial pointers:', JSON.stringify(trivial));
console.log('P2 already-loaded pointers:', JSON.stringify(loaded));
const policyText = fs.readFileSync(new URL('../brain/ambient/reflex/policy.md', import.meta.url), 'utf8');
ok(trivial.length === 0, 'P2 trivial passing mention is silent');
ok(loaded.length === 0, 'P2 entity already loaded in caller context is silent');
ok(policyText.includes('## Trigger rule') && policyText.includes('## Escalation ladder'), 'P2 committed policy.md encodes trigger rule + escalation ladder');

// ── P3: fail-open ──────────────────────────────────────────────────────────
console.log('── P3 pointer fail-open ──');
const broken = createBrainAmbient({
  catalogSource() { throw new Error('fixture catalog failure'); },
});
let raised = false;
let failOpenPointers;
try { failOpenPointers = broken.reflex.point('Review Alice Example before the project decision meeting.', {}); }
catch { raised = true; }
console.log('P3 raised=', raised, 'pointers=', JSON.stringify(failOpenPointers));
console.log('P3 query continues after pointer layer failure');
ok(!raised && Array.isArray(failOpenPointers) && failOpenPointers.length === 0, 'P3 forced extraction error -> [] and no caller exception');

// ── P4: context pack budget ────────────────────────────────────────────────
console.log('── P4 context_pack budget ──');
const fullPack = ambient.pack({ entities: ['Alice Example', 'Bob Stone'], budgetTokens: 1000 });
console.log('P4 priority:', PACK_PRIORITY.join(' -> '));
console.log('P4 under budget:', JSON.stringify(fullPack, null, 2));
const cardsCost = fullPack.cards.reduce((sum, card) => sum + estimatePackTokens(`CARD ${card.name} | ${card.slug} | ${card.summary}`), 0);
const topFact = fullPack.facts[0];
const topFactCost = estimatePackTokens(`FACT [${topFact.kind}] ${topFact.fact}`);
const tightBudget = cardsCost + topFactCost + 1;
const tightPack = ambient.pack({ entities: ['Alice Example', 'Bob Stone'], budgetTokens: tightBudget });
console.log(`P4 tight budget=${tightBudget}:`, JSON.stringify(tightPack, null, 2));
ok(Object.keys(fullPack).join(',') === 'cards,threads,facts,budgetUsed,droppedCount', 'P4 exact pack contract shape');
ok(fullPack.cards.length === 2 && fullPack.facts.length === 2 && fullPack.threads.length === 1 && fullPack.droppedCount === 0, 'P4 under-budget pack retains cards, facts, and thread');
ok(tightPack.budgetUsed <= tightBudget && tightPack.cards.length === 2 && tightPack.facts.length === 1 && tightPack.facts[0].id === 'f-alice' && tightPack.droppedCount === 2, 'P4 over-budget retains higher rank, drops lowest-priority tail, and reports count');

// ── P5: op-seq delta cursor ────────────────────────────────────────────────
console.log('── P5 delta cursor ──');
const firstDelta = ambient.delta({ since: 0, sessionId: 'wake-1' });
const cursorAfterFirst = ambient.cursor('wake-1');
console.log('P5 first delta:', JSON.stringify(firstDelta));
console.log('P5 cursor after first:', cursorAfterFirst);
ambient.publish({ type: 'page', id: 'p2', slug: 'companies/acme-labs', title: 'Acme changed', visibility: 'world', op_seq: 4 });
ambient.publish({ type: 'fact', id: 'd-f2', fact: 'A second world fact changed.', visibility: 'world', op_seq: 5 });
const secondDelta = ambient.delta({ sessionId: 'wake-1' });
const thirdDelta = ambient.delta({ sessionId: 'wake-1' });
console.log('P5 second delta:', JSON.stringify(secondDelta));
console.log('P5 cursor after second:', ambient.cursor('wake-1'));
console.log('P5 third delta:', JSON.stringify(thirdDelta));
ok(firstDelta.pages.length === 1 && firstDelta.facts.length === 1 && firstDelta.threads.length === 1 && cursorAfterFirst === 3 && ambient.cursor('wake-1') === 5, 'P5 first wake advances past three initial world events; later wake advances cursor to 5');
ok(secondDelta.pages[0]?.op_seq === 4 && secondDelta.facts[0]?.op_seq === 5, 'P5 next delta returns only events newer than prior cursor');
ok(thirdDelta.pages.length + thirdDelta.facts.length + thirdDelta.threads.length === 0, 'P5 unchanged third wake is empty');

// ── P6: boundary hooks ─────────────────────────────────────────────────────
console.log('── P6 boundary runtime ──');
const startA = ambient.boundary('session-boundary', {
  phase: 'session-start', entities: ['people/alice-example'], budgetTokens: 1000,
});
const startB = ambient.boundary('session-boundary', {
  phase: 'session-start', entities: ['people/alice-example'], budgetTokens: 1000,
});
const banked = ambient.boundary('session-boundary', {
  phase: 'pre-compaction', entities: ['companies/acme-labs', 'people/alice-example', 'companies/acme-labs'],
});
const rehydrated = ambient.boundary('session-boundary', { phase: 'session-start', budgetTokens: 1000 });
console.log('P6 session-start warm context:', JSON.stringify(startA, null, 2));
console.log('P6 pre-compaction banked:', JSON.stringify(banked));
console.log('P6 rehydrated from bank:', JSON.stringify(rehydrated, null, 2));
ok(JSON.stringify(startA) === JSON.stringify(startB) && startA.warmContext.pack.cards.length === 1, 'P6 session-start warm context is deterministic');
ok(JSON.stringify(banked.warmContext.banked) === JSON.stringify(['companies/acme-labs', 'people/alice-example']), 'P6 pre-compaction banks deduped standing entities');
ok(rehydrated.warmContext.entities.join(',') === 'companies/acme-labs,people/alice-example', 'P6 next session-start uses banked entities');

// ── P7: escalation ladder ──────────────────────────────────────────────────
console.log('── P7 escalation ladder ──');
const alicePointer = pointers.find((pointer) => pointer.slug === 'people/alice-example');
const level1 = reflex.escalate(alicePointer, { level: 1 });
const level2 = reflex.escalate(alicePointer, { level: 2 });
const level3 = reflex.escalate(alicePointer, { level: 3 });
console.log('P7 level 1:', JSON.stringify(level1, null, 2));
console.log('P7 level 2:', JSON.stringify(level2, null, 2));
console.log('P7 level 3:', JSON.stringify(level3, null, 2));
ok(level1.level === 1 && level1.pointer.slug === 'people/alice-example' && !('page' in level1), 'P7 level 1 is pointer only');
ok(level2.level === 2 && level2.page?.compiledTruth.includes('founded Acme Labs'), 'P7 level 2 widens to full Scope A page');
ok(level3.level === 3 && level3.neighbors.some((neighbor) => neighbor.slug === 'companies/acme-labs') && level3.neighbors.some((neighbor) => neighbor.slug === 'people/bob-stone'), 'P7 level 3 widens to Scope C KG neighbors');

// ── P8: world/private visibility ───────────────────────────────────────────
console.log('── P8 private opt-in ──');
const privateTurn = 'Review Private Person before making the confidential project decision.';
const defaultPointers = reflex.point(privateTurn, {});
const privatePointers = reflex.point(privateTurn, { includePrivate: true });
const defaultPrivatePack = ambient.pack({ entities: ['Private Person'], budgetTokens: 1000 });
const optedPrivatePack = ambient.pack({ entities: ['Private Person'], budgetTokens: 1000, includePrivate: true });
const defaultPrivateEscalation = reflex.escalate(privatePointers[0], { level: 2 });
const optedPrivateEscalation = reflex.escalate(privatePointers[0], { level: 2, includePrivate: true });
const worldDelta = ambient.delta({ since: 0, sessionId: 'privacy-world' });
const privateDelta = ambient.delta({ since: 0, sessionId: 'privacy-all', includePrivate: true });
console.log('P8 pointer default:', JSON.stringify(defaultPointers));
console.log('P8 pointer includePrivate:', JSON.stringify(privatePointers));
console.log('P8 pack default:', JSON.stringify(defaultPrivatePack));
console.log('P8 pack includePrivate:', JSON.stringify(optedPrivatePack));
console.log('P8 escalation default:', JSON.stringify(defaultPrivateEscalation));
console.log('P8 escalation includePrivate:', JSON.stringify(optedPrivateEscalation));
console.log('P8 world delta:', JSON.stringify(worldDelta));
console.log('P8 private delta:', JSON.stringify(privateDelta));
ok(defaultPointers.length === 0 && privatePointers.length === 1 && privatePointers[0].visibility === 'private', 'P8 pointer default is world-only; explicit opt-in includes private');
ok(defaultPrivatePack.cards.length === 0 && defaultPrivatePack.facts.length === 0 && optedPrivatePack.cards.length === 1 && optedPrivatePack.facts.some((fact) => fact.id === 'f-private') && defaultPrivateEscalation.page === null && optedPrivateEscalation.page?.title === 'Private Person', 'P8 context pack and escalation honor private flag');
ok(!worldDelta.facts.some((fact) => fact.id === 'd-private') && privateDelta.facts.some((fact) => fact.id === 'd-private'), 'P8 delta default is world-only; explicit opt-in widens private lane');

// ── P9: determinism ────────────────────────────────────────────────────────
console.log('── P9 determinism ──');
const pointA = JSON.stringify(reflex.point(turn, {}));
const pointB = JSON.stringify(reflex.point(turn, {}));
const packA = JSON.stringify(ambient.pack({ entities: ['Alice Example', 'Bob Stone'], budgetTokens: 1000 }));
const packB = JSON.stringify(ambient.pack({ entities: ['Alice Example', 'Bob Stone'], budgetTokens: 1000 }));
console.log('P9 pointers A:', pointA);
console.log('P9 pointers B:', pointB);
console.log('P9 pack A:', packA);
console.log('P9 pack B:', packB);
ok(pointA === pointB && packA === packB, 'P9 same turn/context + same pack inputs -> byte-identical');

console.log('');
console.log(`SCOPE G: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
