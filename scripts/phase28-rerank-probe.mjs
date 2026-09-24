/**
 * JEXI OS — Phase 28 Scope E live probe — pluggable cross-encoder reranker.
 * P1 noop · P2 fail-open · P3 budget · P4 top-N · P5 tokenmax gate ·
 * P6 determinism.
 */
import {
  createReranker, rerank as defaultRerank, requiredTokens,
  DEFAULT_RERANK_TOP_K, DEFAULT_CROSS_ENCODER_MODEL,
} from '../mind/brain/search/rerank/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};
const ids = (rows) => rows.map((row) => row.id).join(' > ');
const rows = [
  { id: 'r1', text: 'alpha first document', score: 0.9 },
  { id: 'r2', text: 'beta second document', score: 0.8 },
  { id: 'r3', text: 'gamma third document', score: 0.7 },
  { id: 'r4', text: 'delta fourth document', score: 0.6 },
  { id: 'r5', text: 'epsilon fifth document', score: 0.5 },
];

// ── P1 noop ────────────────────────────────────────────────────────────────
console.log('── P1 noop backend ──');
console.log('P1 process default available:', JSON.stringify(defaultRerank.available()));
const noopRerank = createReranker({ mode: 'tokenmax', backend: 'noop' });
const p1 = await noopRerank.rank('find beta', rows, { backend: 'noop', topK: 3 });
console.log('P1 before:', ids(rows));
console.log('P1 after: ', ids(p1));
ok(ids(p1) === ids(rows), 'P1 noop preserves input order');
ok(noopRerank.available().available === true && noopRerank.available().backend === 'noop', 'P1 noop reports available');

// ── P2 unconfigured external fail-open ────────────────────────────────────
console.log('── P2 external absent -> fail-open ──');
const failOpenEvents = [];
const absent = createReranker({
  mode: 'tokenmax',
  backend: 'cross-encoder',
  onFailOpen: (event) => failOpenEvents.push({ backend: event.backend, reason: event.reason }),
});
console.log('P2 available:', JSON.stringify(absent.available()));
let p2;
let p2Raised = false;
try { p2 = await absent.rank('find gamma', rows, { topK: 3 }); }
catch (error) { p2Raised = true; console.log('P2 unexpected error:', error.code, error.message); }
console.log('P2 fail-open events:', JSON.stringify(failOpenEvents));
console.log('P2 returned order:', ids(p2 || []));
ok(!p2Raised, 'P2 absent provider raises no error to caller');
ok(ids(p2) === ids(rows), 'P2 absent provider returns original order');
ok(failOpenEvents.length === 1 && failOpenEvents[0].reason === 'unavailable', 'P2 unavailable fail-open path is observable');

const throwingEvents = [];
const throwing = createReranker({
  mode: 'tokenmax',
  backend: 'cross-encoder',
  provider: { name: 'throwing-provider', async rerank() { throw new Error('fixture gateway timeout'); } },
  onFailOpen: (event) => throwingEvents.push({ backend: event.backend, reason: event.reason }),
});
let throwingRaised = false;
let throwingResult;
try { throwingResult = await throwing.rank('find gamma', rows, { topK: 3 }); }
catch { throwingRaised = true; }
console.log('P2 configured provider error ->', JSON.stringify(throwingEvents), 'order=' + ids(throwingResult || []));
ok(!throwingRaised && ids(throwingResult) === ids(rows), 'P2 configured external error also fails open to original order');
ok(throwingEvents[0]?.reason === 'rank-error', 'P2 external error fail-open path is observable');

// Injected zerank-2-shaped provider used by P3-P6. No network client exists in
// brain/search/rerank; this callable is the only external seam.
function reverseProvider(name = 'fixture-zerank') {
  const calls = [];
  return {
    name,
    calls,
    async rerank(input) {
      calls.push({ query: input.query, documents: [...input.documents], model: input.model, top_n: input.top_n });
      return {
        results: input.documents.map((_document, index) => ({
          index,
          relevance_score: index + 1, // backend sorts descending -> reverse
        })),
      };
    },
  };
}

// ── P3 budget cap ──────────────────────────────────────────────────────────
console.log('── P3 budget cap ──');
const budgetProvider = reverseProvider('budget-provider');
const budgetRows = [
  { id: 'b1', text: 'x'.repeat(100) },
  { id: 'b2', text: 'y'.repeat(100) },
];
const budgetQuery = 'budget query';
const required = requiredTokens(budgetQuery, budgetRows);
const availableBudget = 5;
const budgeted = createReranker({
  mode: 'tokenmax', backend: 'cross-encoder', provider: budgetProvider,
  budgetTokens: availableBudget,
});
let budgetError;
try { await budgeted.rank(budgetQuery, budgetRows); }
catch (error) { budgetError = error; }
console.log(`P3 required=${required} available=${availableBudget}`);
console.log('P3 error:', budgetError?.code, budgetError?.message);
console.log('P3 numeric fields:', JSON.stringify({ requiredTokens: budgetError?.requiredTokens, availableTokens: budgetError?.availableTokens }));
ok(budgetError?.code === 'E_RERANK_BUDGET', 'P3 over-budget refuses with E_RERANK_BUDGET');
ok(budgetError?.requiredTokens === required && budgetError?.availableTokens === availableBudget, 'P3 error exposes required and available token counts');
ok(budgetProvider.calls.length === 0, 'P3 budget refusal happens before provider call');

// ── P4 top-N sliding ───────────────────────────────────────────────────────
console.log('── P4 top-N sliding ──');
const topProvider = reverseProvider();
const topRerank = createReranker({
  mode: 'tokenmax', backend: 'cross-encoder', provider: topProvider,
});
const p4 = await topRerank.rank('reverse the head', rows, { topK: 3 });
console.log('P4 before:', ids(rows));
console.log('P4 after: ', ids(p4));
console.log('P4 provider documents:', topProvider.calls[0].documents.length, 'model=' + topProvider.calls[0].model);
ok(ids(p4) === 'r3 > r2 > r1 > r4 > r5', 'P4 only top 3 reordered; tail r4,r5 stays in relative order');
ok(topProvider.calls[0].documents.length === 3 && topProvider.calls[0].top_n === 3, 'P4 provider receives only requested top-N');
ok(topProvider.calls[0].model === DEFAULT_CROSS_ENCODER_MODEL, 'P4 default external model is zeroentropyai:zerank-2');

const manyRows = Array.from({ length: 23 }, (_, index) => ({ id: `m${index + 1}`, text: `document ${index + 1}` }));
const defaultTopProvider = reverseProvider('default-top-provider');
const defaultTop = createReranker({ mode: 'tokenmax', backend: 'cross-encoder', provider: defaultTopProvider });
const p4Default = await defaultTop.rank('default top window', manyRows);
console.log(`P4 default topK=${DEFAULT_RERANK_TOP_K}; provider=${defaultTopProvider.calls[0].documents.length}; tail=${ids(p4Default.slice(20))}`);
ok(defaultTopProvider.calls[0].documents.length === 20, 'P4 default rerank window is top 20');
ok(ids(p4Default.slice(20)) === 'm21 > m22 > m23', 'P4 entries beyond default top 20 pass through unchanged');

// ── P5 tokenmax mode gate ─────────────────────────────────────────────────
console.log('── P5 tokenmax mode gate ──');
const offProvider = reverseProvider('mode-off-provider');
const off = createReranker({ mode: 'balanced', backend: 'cross-encoder', provider: offProvider });
const offResult = await off.rank('mode gate', rows, { topK: 3 });
const onProvider = reverseProvider('mode-on-provider');
const on = createReranker({ mode: 'tokenmax', backend: 'cross-encoder', provider: onProvider });
const onResult = await on.rank('mode gate', rows, { topK: 3 });
console.log(`P5 OFF calls=${offProvider.calls.length} order=${ids(offResult)}`);
console.log(`P5 ON  calls=${onProvider.calls.length} order=${ids(onResult)}`);
ok(offProvider.calls.length === 0 && ids(offResult) === ids(rows), 'P5 tokenmax OFF: provider not called and order unchanged');
ok(onProvider.calls.length === 1 && ids(onResult) === 'r3 > r2 > r1 > r4 > r5', 'P5 tokenmax ON: injected provider called and head reranked');

// ── P6 determinism ─────────────────────────────────────────────────────────
console.log('── P6 determinism ──');
const deterministicProvider = reverseProvider('deterministic-provider');
const deterministic = createReranker({
  mode: 'tokenmax', backend: 'cross-encoder', provider: deterministicProvider,
});
const runA = JSON.stringify(await deterministic.rank('stable query', rows, { topK: 4 }));
const runB = JSON.stringify(await deterministic.rank('stable query', rows, { topK: 4 }));
console.log('P6 runA:', runA);
console.log('P6 runB:', runB);
ok(runA === runB, 'P6 same query + results + backend -> byte-identical');

console.log('');
console.log(`SCOPE E: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
