/**
 * JEXI OS — Phase 28 Scope F live probe — fact taxonomy + hot memory.
 * P1 extraction · P2 today recall · P3 MCP meta · P4 decay ·
 * P5 supersession · P6 source isolation · P7 cosine path ·
 * P8 bounded queue · P9 determinism.
 */
import {
  createHotMemory, FACT_KINDS, HALFLIFE_DAYS,
  COSINE_FAST_PATH, CLASSIFIER_FALLBACK, HOT_QUEUE_CAP,
  RULE_BASED_EXTRACTION_LABEL,
} from '../brain/hot/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

// ── P1: extraction + taxonomy ──────────────────────────────────────────────
console.log('── P1 per-turn fact extraction ──');
const day = { value: 200 };
const hot = createHotMemory({ nowDay: () => day.value });
const turn = {
  sourceId: 'source-A',
  sessionId: 'session-1',
  opSeq: 10,
  daySeq: 200,
  text: [
    'Yesterday I attended the engine launch.',
    'I will send the design report.',
    'I prefer tea to coffee.',
    'I believe small teams move faster.',
    'Nairobi is the capital of Kenya.',
  ].join(' '),
};
const p1 = await hot.extract(turn);
console.log('P1 extractor:', JSON.stringify(hot.extractor()));
console.log('P1 declared kinds:', FACT_KINDS.join(', '));
for (const fact of p1) console.log(`P1 ${fact.kind}: ${fact.fact} | evidence="${fact.evidence}"`);
ok(hot.extractor().label === RULE_BASED_EXTRACTION_LABEL, 'P1 default extractor carries honest NOT VERIFIED label');
ok(p1.length === 5, 'P1 synthetic turn extracts five facts');
ok(JSON.stringify(p1.map((fact) => fact.kind).sort()) === JSON.stringify([...FACT_KINDS].sort()), 'P1 all five declared kinds classified exactly once');
ok(p1.every((fact) => fact.evidence && fact.source_id === 'source-A' && fact.op_seq === 10), 'P1 every fact carries evidence, source_id, and injected op_seq');

// ── P2: recall --today using operation sequence ────────────────────────────
console.log('── P2 recall --today (op-seq, no clock) ──');
await hot.record({
  fact: 'This fact predates injected midnight.', kind: 'fact', evidence: 'fixture:before-midnight',
  sourceId: 'source-A', sessionId: 'session-0', opSeq: 4, createdDay: 199,
});
const todayMarkdown = hot.recallToday({ midnightSeq: 10, sourceId: 'source-A' });
console.log(todayMarkdown);
ok(todayMarkdown.startsWith('## Hot Memory — Today'), 'P2 --today returns markdown');
ok(todayMarkdown.includes('[op 10]') && !todayMarkdown.includes('[op 4]'), 'P2 injected midnightSeq includes today and excludes older operation');

// ── P3: MCP _meta envelope ─────────────────────────────────────────────────
console.log('── P3 MCP _meta injection ──');
const envelope = hot.meta({ sessionId: 'session-1', sourceId: 'source-A', allowList: ['holder-b', 'holder-a'] });
console.log('P3 envelope:', JSON.stringify(envelope, null, 2));
ok(Object.keys(envelope).join(',') === 'brain_hot_memory' && Object.keys(envelope.brain_hot_memory).join(',') === 'facts', 'P3 exact { brain_hot_memory: { facts } } envelope');
ok(envelope.brain_hot_memory.facts.length === 5 && envelope.brain_hot_memory.facts.every((fact) => fact.source_id === 'source-A'), 'P3 envelope carries session facts from correct source');
const cached = hot.meta({ sessionId: 'session-1', sourceId: 'source-A', allowList: ['holder-a', 'holder-b'] });
ok(JSON.stringify(cached) === JSON.stringify(envelope), 'P3 sorted allowList hash gives deterministic cache identity');
ok(hot.metaCacheSize() === 1, 'P3 reordered equivalent allowList reuses one (sourceId, sessionId, hash) cache entry');

// ── P4: per-kind decay ─────────────────────────────────────────────────────
console.log('── P4 decay halflives ──');
const eventFact = { kind: 'event', created_day: 193, confidence: 1 };
const beliefFact = { kind: 'belief', created_day: 193, confidence: 1 };
const eventDecay = hot.decay(eventFact);
const beliefDecay = hot.decay(beliefFact);
console.log(`P4 event: halflife=${HALFLIFE_DAYS.event}d age=7d score=${eventDecay.score.toFixed(6)}`);
console.log(`P4 belief: halflife=${HALFLIFE_DAYS.belief}d age=7d score=${beliefDecay.score.toFixed(6)}`);
console.log('P4 declared table:', JSON.stringify(HALFLIFE_DAYS));
ok(HALFLIFE_DAYS.event === 7 && HALFLIFE_DAYS.commitment === 90 && HALFLIFE_DAYS.preference === 90 && HALFLIFE_DAYS.belief === 365 && HALFLIFE_DAYS.fact === 365, 'P4 exact per-kind halflife table pinned');
ok(eventDecay.score < beliefDecay.score, 'P4 event decays faster than belief at the same age/confidence');

// ── P5: supersession never deletes ─────────────────────────────────────────
console.log('── P5 supersession audit ──');
const supersedeHot = createHotMemory({ nowDay: () => 300 });
const factA = await supersedeHot.record({
  fact: 'The project office is in Nairobi.', kind: 'fact', evidence: 'turn A',
  sourceId: 'source-A', sessionId: 's-old', opSeq: 20, createdDay: 299,
});
const factB = await supersedeHot.record({
  fact: 'The project office is now in Mombasa.', kind: 'fact', evidence: 'turn B contradicts A',
  sourceId: 'source-A', sessionId: 's-new', opSeq: 21, createdDay: 300,
  contradicts: factA.id,
});
const retained = supersedeHot.recall({ sourceId: 'source-A' });
const links = supersedeHot.supersessions(factA.id);
console.log('P5 retained facts:', JSON.stringify(retained, null, 2));
console.log('P5 supersessions(A):', JSON.stringify(links, null, 2));
ok(retained.length === 2 && retained.some((fact) => fact.id === factA.id) && retained.some((fact) => fact.id === factB.id), 'P5 old and replacement facts both retained');
ok(retained.find((fact) => fact.id === factA.id)?.superseded_by === factB.id, 'P5 old fact points to replacement without deletion');
ok(links.length === 1 && links[0].fact_id === factA.id && links[0].superseded_by === factB.id, 'P5 supersessions(A) returns auditable B link');

// ── P6: cross-source isolation ─────────────────────────────────────────────
console.log('── P6 cross-source isolation ──');
const isolated = createHotMemory({ nowDay: () => 400 });
await isolated.record({ fact: 'Only source A may see this.', kind: 'fact', sourceId: 'A', sessionId: 's', opSeq: 1, createdDay: 400 });
await isolated.record({ fact: 'Only source B may see this.', kind: 'fact', sourceId: 'B', sessionId: 's', opSeq: 2, createdDay: 400 });
const sourceA = isolated.recall({ sourceId: 'A' });
const sourceB = isolated.recall({ sourceId: 'B' });
console.log('P6 recall source A:', sourceA.map((fact) => fact.fact).join(' | '));
console.log('P6 recall source B:', sourceB.map((fact) => fact.fact).join(' | '));
ok(sourceA.length === 1 && sourceA[0].source_id === 'A' && !sourceA[0].fact.includes('source B'), 'P6 source A cannot read source B fact');
ok(sourceB.length === 1 && sourceB[0].source_id === 'B' && !sourceB[0].fact.includes('source A'), 'P6 source B cannot read source A fact');
const metaA = isolated.meta({ sourceId: 'A', sessionId: 's' });
console.log('P6 MCP source A facts:', metaA.brain_hot_memory.facts.map((fact) => fact.fact).join(' | '));
ok(metaA.brain_hot_memory.facts.length === 1 && metaA.brain_hot_memory.facts[0].source_id === 'A', 'P6 MCP meta query also enforces source_id');

// ── P7: cosine fast-path and classifier threshold ──────────────────────────
console.log('── P7 cosine fast-path ──');
const vectorByText = {
  existing: [1, 0],
  near: [0.96, Math.sqrt(1 - 0.96 ** 2)],
  mid: [0.93, Math.sqrt(1 - 0.93 ** 2)],
  far: [0, 1],
};
const controlledEmbedder = { async embed(texts) { return texts.map((text) => vectorByText[text]); } };
const extractorProvider = {
  name: 'fixture-extractor',
  async extract(turnInput) { return [{ fact: turnInput.text, kind: 'fact', evidence: `evidence:${turnInput.text}` }]; },
};
let classifierCalls = 0;
const classifier = {
  available: () => true,
  async classify() { classifierCalls += 1; return { decision: 'independent' }; },
};
const cosineHot = createHotMemory({
  backend: 'provider', provider: extractorProvider, embedder: controlledEmbedder,
  classifier, nowDay: () => 500,
});
await cosineHot.record({ fact: 'existing', kind: 'fact', sourceId: 'A', sessionId: 's', opSeq: 1, createdDay: 500 });
const nearFacts = await cosineHot.extract({ text: 'near', sourceId: 'A', sessionId: 's', opSeq: 2, daySeq: 500 });
const nearDecision = cosineHot.lastExtraction().decisions[0];
const callsAfterNear = classifierCalls;
const farFacts = await cosineHot.extract({ text: 'far', sourceId: 'A', sessionId: 's', opSeq: 3, daySeq: 500 });
const farDecision = cosineHot.lastExtraction().decisions[0];
console.log(`P7 thresholds: fast=${COSINE_FAST_PATH} fallback=${CLASSIFIER_FALLBACK}`);
console.log(`P7 near cosine=${nearDecision.similarity.toFixed(4)} decision=${nearDecision.decision}/${nearDecision.reason} classifierCalls=${callsAfterNear}`);
console.log(`P7 far cosine=${farDecision.similarity.toFixed(4)} decision=${farDecision.decision}/${farDecision.reason} classifierCalls=${classifierCalls}`);
ok(nearDecision.similarity >= 0.95 && nearFacts.length === 0 && callsAfterNear === 0, 'P7 >=0.95 cosine skips classifier and duplicate insert');
ok(farDecision.similarity < 0.92 && farFacts.length === 1 && classifierCalls === 1, 'P7 <0.92 cosine invokes classifier');

let failingClassifierCalls = 0;
const fallbackHot = createHotMemory({
  backend: 'provider', provider: extractorProvider, embedder: controlledEmbedder,
  classifier: {
    available: () => true,
    async classify() { failingClassifierCalls += 1; throw new Error('fixture classifier timeout'); },
  },
  nowDay: () => 500,
});
await fallbackHot.record({ fact: 'existing', kind: 'fact', sourceId: 'A', sessionId: 's', opSeq: 1, createdDay: 500 });
const midFacts = await fallbackHot.extract({ text: 'mid', sourceId: 'A', sessionId: 's', opSeq: 2, daySeq: 500 });
const midDecision = fallbackHot.lastExtraction().decisions[0];
console.log(`P7 mid cosine=${midDecision.similarity.toFixed(4)} decision=${midDecision.decision}/${midDecision.reason} classifierCalls=${failingClassifierCalls}`);
ok(midDecision.similarity >= 0.92 && midDecision.similarity < 0.95 && midFacts.length === 0 && midDecision.reason === 'cosine_fallback', 'P7 classifier failure at >=0.92 falls back to duplicate');

// ── P8: bounded pending-fact queue ─────────────────────────────────────────
console.log('── P8 bounded queue ──');
const queueProvider = {
  name: 'queue-fixture',
  async extract() {
    return Array.from({ length: 101 }, (_, index) => ({
      fact: `queue fact ${index}`, kind: 'fact', evidence: `queue evidence ${index}`,
    }));
  },
};
const oneHotEmbedder = {
  async embed(texts) {
    return texts.map((text) => {
      const index = Number(text.match(/(\d+)$/)?.[1] ?? 0);
      const vector = new Array(101).fill(0);
      vector[index] = 1;
      return vector;
    });
  },
};
const queueHot = createHotMemory({
  backend: 'provider', provider: queueProvider, embedder: oneHotEmbedder,
  nowDay: () => 600, queueCap: HOT_QUEUE_CAP,
});
const queuedFacts = await queueHot.extract({ text: 'queue batch', sourceId: 'Q', sessionId: 'q', opSeq: 1, daySeq: 600 });
const dropped = queueHot.lastExtraction().dropped;
console.log(`P8 pushed=101 cap=${HOT_QUEUE_CAP} recorded=${queuedFacts.length} dropped=${dropped.length}`);
console.log('P8 dropped fact:', JSON.stringify(dropped[0]));
ok(queuedFacts.length === 100 && queueHot.size === 100, 'P8 101 pending facts are bounded to cap 100');
ok(dropped.length === 1 && dropped[0].fact === 'queue fact 0' && !queuedFacts.some((fact) => fact.fact === 'queue fact 0'), 'P8 oldest pending fact dropped before durable recording');

// ── P9: determinism ────────────────────────────────────────────────────────
console.log('── P9 determinism ──');
const deterministicTurn = {
  sourceId: 'D', sessionId: 'same', opSeq: 77, daySeq: 700,
  text: 'Yesterday I attended a demo. I prefer concise notes. The demo used a mechanical engine.',
};
const d1 = createHotMemory({ nowDay: () => 700 });
const d2 = createHotMemory({ nowDay: () => 700 });
const runA = JSON.stringify(await d1.extract(deterministicTurn));
const runB = JSON.stringify(await d2.extract(deterministicTurn));
console.log('P9 runA:', runA);
console.log('P9 runB:', runB);
ok(runA === runB, 'P9 same turn + same backend -> byte-identical');

console.log('');
console.log(`SCOPE F: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
