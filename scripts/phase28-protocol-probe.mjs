/**
 * JEXI OS — Phase 28 Scope H live probe — frozen MEMORY_VERBS v1.
 * P1 five verbs/envelopes · P2 errors · P3 version · P4 additive guard ·
 * P5 conformance · P6 unknown verb · P7 determinism.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepo } from '../mind/brain/repo/index.js';
import { createIndex } from '../mind/brain/index/index.js';
import { createHybridSearch } from '../mind/brain/search/index.js';
import { createHotMemory } from '../mind/brain/hot/index.js';
import { extract } from '../mind/brain/kg/index.js';
import {
  createMemoryProtocol, enforceEnvelope, inspectEnvelope,
  assertConformantEnvelope, runConformance, VERB_NAMES,
} from '../mind/brain/protocol/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const NOW = '2026-09-22T12:00:00Z';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28h-'));
const repo = createRepo(root);
repo.create('people', 'alice-example', {
  title: 'Alice Example',
  compiledTruth: 'Alice Example founded Acme Labs. Alice Example advises Bob Stone.',
  now: NOW,
});
repo.create('companies', 'acme-labs', {
  title: 'Acme Labs',
  compiledTruth: 'Acme Labs builds analytical engines with Alice Example.',
  now: NOW,
});
const index = createIndex({ repo });
await index.rebuild();
const edges = repo.list().flatMap((page) => extract(page).edges);
const search = createHybridSearch({ index, repo, edges, now: NOW });
const hot = createHotMemory({ nowDay: () => 42 });
let operationSequence = 10;
const protocol = createMemoryProtocol({
  search,
  hot,
  repo,
  now: () => NOW,
  opSeq: () => operationSequence++,
  daySeq: () => 42,
  sessionId: 'scope-h-probe',
});

const exactSuccess = (envelope, verb) =>
  envelope.verb === verb && envelope.version === '1.0' && envelope.ok === true &&
  envelope.data && typeof envelope.data === 'object' && !('error' in envelope) &&
  Object.keys(envelope).join(',') === 'verb,version,ok,data' && inspectEnvelope(envelope) === null;
const exactFailure = (envelope, verb) =>
  envelope.verb === verb && envelope.version === '1.0' && envelope.ok === false &&
  envelope.error && typeof envelope.error.retryable === 'boolean' && !('data' in envelope) &&
  Object.keys(envelope).join(',') === 'verb,version,ok,error' &&
  Object.keys(envelope.error).join(',') === 'code,message,retryable' && inspectEnvelope(envelope) === null;

// ── P1: exactly five calls, one frozen envelope ─────────────────────────────
console.log('── P1 five frozen verbs ──');
const rememberEnvelope = await protocol.remember({
  content: 'I prefer concise launch reports.',
  kind: 'preference',
  sourceId: 'people/alice-example',
});
const recallEnvelope = await protocol.recall({
  query: 'Alice Example launch reports',
  opts: { sourceId: 'people/alice-example', topK: 5, budgetTokens: 500 },
});
const entityEnvelope = await protocol.entity({ name: 'Alice Example' });
const synthesizeEnvelope = await protocol.synthesize({ query: 'What do we know about Alice Example and Acme Labs?' });
const forgetEnvelope = await protocol.forget({ id: rememberEnvelope.data?.facts?.[0]?.id ?? 'fact-scope-h' });
const p1 = {
  remember: rememberEnvelope,
  recall: recallEnvelope,
  entity: entityEnvelope,
  synthesize: synthesizeEnvelope,
  forget: forgetEnvelope,
};
for (const verb of VERB_NAMES) console.log(`P1 ${verb}:`, JSON.stringify(p1[verb], null, 2));
ok(VERB_NAMES.join(',') === 'recall,remember,entity,synthesize,forget', 'P1 v1 registry contains exactly five ordered verbs');
ok(VERB_NAMES.every((verb) => exactSuccess(p1[verb], verb)), 'P1 all five calls return the exact success-envelope shape');
ok(rememberEnvelope.data?.page?.action === 'appended' && rememberEnvelope.data?.facts?.length === 1, 'P1 remember delegates to hot.extract + repo.append');
ok(Array.isArray(recallEnvelope.data?.results) && Array.isArray(recallEnvelope.data?.facts), 'P1 recall delegates to search.hybrid + hot.recall');
ok(entityEnvelope.data?.page?.slug === 'alice-example' && Array.isArray(entityEnvelope.data?.edges), 'P1 entity delegates to repo.read + kg.extract');
ok(Array.isArray(synthesizeEnvelope.data?.sources) && Array.isArray(synthesizeEnvelope.data?.edges), 'P1 synthesize delegates to repo.compile + kg.extract');
ok(forgetEnvelope.data?.status === 'marked_for_deletion' && forgetEnvelope.data?.pendingScope === 'J', 'P1 forget uses declared Scope J soft-delete marker stub');

// ── P2: uniform errors ──────────────────────────────────────────────────────
console.log('── P2 frozen error contract ──');
const errorCases = {
  recall: await protocol.recall({}),
  remember: await protocol.remember({ kind: 'fact', sourceId: 'default' }),
  entity: await protocol.entity({ name: 'No Such Entity' }),
  synthesize: await protocol.synthesize({}),
  forget: await protocol.forget({}),
};
for (const verb of VERB_NAMES) console.log(`P2 ${verb} failure:`, JSON.stringify(errorCases[verb]));
const unavailable = await createMemoryProtocol().recall({ query: 'valid query without delegates' });
console.log('P2 unavailable delegate:', JSON.stringify(unavailable));
ok(VERB_NAMES.every((verb) => exactFailure(errorCases[verb], verb)), 'P2 every failing verb returns the exact frozen error envelope');
ok(errorCases.recall.error.code === 'E_INVALID_ARGUMENT' && errorCases.recall.error.retryable === false, 'P2 missing recall query is typed and non-retryable');
ok(errorCases.entity.error.code === 'E_UNKNOWN_ENTITY' && errorCases.entity.error.message.includes('No Such Entity'), 'P2 unknown entity is typed and names the missing entity');
ok(unavailable.error.code === 'E_DELEGATE_UNAVAILABLE' && unavailable.error.retryable === true, 'P2 unavailable delegate is typed and retryable');

// ── P3: version + surfaces ──────────────────────────────────────────────────
console.log('── P3 protocol version ──');
const version = protocol.version();
console.log('P3 version:', JSON.stringify(version, null, 2));
ok(version.protocolVersion === '1.0', 'P3 protocol version is frozen at 1.0');
ok(JSON.stringify(version.surfaces) === JSON.stringify(['verbs', 'starter', 'full']), 'P3 version reports all declared surfaces');

// ── P4: additive-forever/top-level guard ────────────────────────────────────
console.log('── P4 additive-forever guard ──');
const contaminated = { ...recallEnvelope, rogueTopLevel: 'not allowed' };
console.log('P4 candidate:', JSON.stringify(contaminated));
const refused = enforceEnvelope(contaminated);
console.log('P4 guard result:', JSON.stringify(refused, null, 2));
ok(refused.ok === false && refused.error.code === 'E_ENVELOPE_SHAPE_VIOLATION', 'P4 unknown top-level key is refused');
ok(refused.error.message.includes('rogueTopLevel') && inspectEnvelope(refused) === null, 'P4 guard names the field and returns a conformant error envelope');

// ── P5: live conformance + forced mutation ──────────────────────────────────
console.log('── P5 conformance certification ──');
const certification = await runConformance(protocol, {
  cases: {
    recall: { query: 'Alice Example launch reports', opts: { sourceId: 'people/alice-example', topK: 3, budgetTokens: 300 } },
    remember: { content: 'We will preserve the frozen five-verb protocol.', kind: 'commitment', sourceId: 'concepts/protocol-conformance' },
    entity: { name: 'people/alice-example' },
    synthesize: { query: 'Alice Example and Acme Labs' },
    forget: { id: 'fact-conformance' },
  },
});
console.log('P5 conformance:', JSON.stringify(certification, null, 2));
ok(certification.passed === 5 && certification.total === 5 && certification.envelope === 'PASS', 'P5 conformance passes 5/5 verbs + envelope');
const mutated = { ...recallEnvelope, version: '9.0' };
let conformanceFailure;
try { assertConformantEnvelope(mutated, 'recall'); }
catch (error) { conformanceFailure = { code: error.code, message: error.message }; }
console.log('P5 forced failure:', JSON.stringify(conformanceFailure, null, 2));
ok(conformanceFailure?.code === 'E_CONFORMANCE_FAIL', 'P5 forced envelope mutation raises E_CONFORMANCE_FAIL');
ok(conformanceFailure?.message.includes('recall.version'), 'P5 conformance failure names the specific mutated field');

// ── P6: unknown verb ────────────────────────────────────────────────────────
console.log('── P6 unknown verb ──');
const unknown = await protocol.call('archive', { id: 'x' });
console.log('P6 unknown:', JSON.stringify(unknown, null, 2));
ok(exactFailure(unknown, 'archive'), 'P6 unknown verb still uses the frozen envelope');
ok(unknown.error.code === 'E_UNKNOWN_VERB' && unknown.error.retryable === false, 'P6 unknown verb -> E_UNKNOWN_VERB');

// ── P7: deterministic read ──────────────────────────────────────────────────
console.log('── P7 determinism ──');
const deterministicArgs = {
  query: 'Alice Example launch reports',
  opts: { sourceId: 'people/alice-example', topK: 5, budgetTokens: 500 },
};
const deterministicA = JSON.stringify(await protocol.recall(deterministicArgs));
const deterministicB = JSON.stringify(await protocol.recall(deterministicArgs));
console.log('P7 recall A:', deterministicA);
console.log('P7 recall B:', deterministicB);
console.log('P7 byte-identical:', deterministicA === deterministicB);
ok(deterministicA === deterministicB, 'P7 same verb + same args twice -> byte-identical envelope');

console.log('');
console.log(`SCOPE H: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
