#!/usr/bin/env node
/** Live probe — Phase 28 Scope K: BrainBench retrieval evals + static publish. */
import fs from 'node:fs';
import path from 'node:path';
import { createRepo } from '../brain/repo/index.js';
import {
  evals, loadCorpus, metricsAtK, precisionAtK, recallAtK,
} from '../brain/evals/index.js';
import { createPublisher } from '../brain/publish/index.js';

let passed = 0;
let total = 0;
function check(label, condition) {
  total += 1;
  if (!condition) throw new Error(`FAIL ${label}`);
  passed += 1;
  console.log(`PASS ${label}`);
}
function eq(a, b, epsilon = 1e-12) { return Math.abs(a - b) <= epsilon; }

const fixtureRoot = '/tmp/jexi-phase28-k-probe';
fs.rmSync(fixtureRoot, { recursive: true, force: true });
fs.mkdirSync(fixtureRoot, { recursive: true });

console.log('P1 CORPUS DECLARATION');
const corpus = loadCorpus();
console.log(JSON.stringify({ label: corpus.label, fixture: corpus.fixture, docs: corpus.docs.length, queries: corpus.queries.length }));
check('P1 declared fixture is labeled, never real-world performance', corpus.fixture === true && /NOT real-world performance/.test(corpus.label));
check('P1 corpus counts are deterministic', corpus.docs.length === 10 && corpus.queries.length === 4);
let missingRetrieverCode = null;
try { await evals.bench({ corpus }); } catch (error) { missingRetrieverCode = error.code; }
console.log(`injected-retrieval-required=${missingRetrieverCode}`);
check('P1 no retriever is bundled', missingRetrieverCode === 'E_INVALID_ARGUMENT');

console.log('\nP2 BRAINBENCH RETRIEVAL-ONLY RUN');
const rankings = Object.freeze({
  'q-founder': ['doc-alice', 'doc-noise', 'doc-acme'],
  'q-investor': ['doc-noise', 'doc-fund'],
  'q-retrieval': ['doc-graph', 'doc-noise', 'doc-budget', 'doc-index'],
  'q-timeline': ['doc-noise', 'doc-budget', 'doc-orphans', 'doc-private', 'doc-acme', 'doc-timeline'],
});
const retrieval = (query) => rankings[query.id];
const benchmark = await evals.bench({ corpus, retrieval });
console.log(JSON.stringify(benchmark));
check('P2 output says retrieval fixture, not end-to-end QA', /retrieval fixture/.test(benchmark.label) && /NOT end-to-end QA/.test(benchmark.label));
check('P2 macro p5 is 0.25', eq(benchmark.p5, 0.25));
check('P2 macro r5 is 0.75', eq(benchmark.r5, 0.75));
check('P2 emits one deterministic row per declared query', benchmark.perQuery.length === 4 && benchmark.perQuery.map((row) => row.queryId).join(',') === 'q-founder,q-investor,q-retrieval,q-timeline');

console.log('\nP3 KNOWN METRIC MATH');
const known = metricsAtK(['rel-a', 'noise', 'rel-b'], ['rel-a', 'rel-b'], 5);
console.log(`hits=${known.hits}; p@5=${known.hits}/5=${known.precision}; r@5=${known.hits}/${known.relevant}=${known.recall}`);
check('P3 precision denominator is declared k=5', eq(known.precision, 0.4));
check('P3 recall denominator is relevant-set size=2', eq(known.recall, 1));
check('P3 duplicate relevant hits count once', eq(precisionAtK(['rel-a', 'rel-a'], ['rel-a'], 5), 0.2) && eq(recallAtK(['rel-a', 'rel-a'], ['rel-a'], 5), 1));

console.log('\nP4 METRICS AT k=1/3/5/10');
const ranked = ['rel-a', 'noise', 'rel-b', 'n4', 'n5', 'n6'];
const relevant = ['rel-a', 'rel-b'];
const scorecard = [1, 3, 5, 10].map((k) => metricsAtK(ranked, relevant, k));
for (const score of scorecard) console.log(`k=${score.k} hits=${score.hits} precision=${score.precision} recall=${score.recall}`);
check('P4 p@1/r@1', eq(scorecard[0].precision, 1) && eq(scorecard[0].recall, 0.5));
check('P4 p@3/r@3', eq(scorecard[1].precision, 2 / 3) && eq(scorecard[1].recall, 1));
check('P4 p@5/r@5', eq(scorecard[2].precision, 0.4) && eq(scorecard[2].recall, 1));
check('P4 p@10/r@10 uses ten-slot denominator', eq(scorecard[3].precision, 0.2) && eq(scorecard[3].recall, 1));

console.log('\nP5 STATIC HTML: THREE PUBLIC PAGES');
const now = '2026-09-22T12:00:00Z';
const repo = createRepo(path.join(fixtureRoot, 'brain'));
repo.create('concepts', 'retrieval-evals', {
  title: 'Retrieval Evaluation',
  compiledTruth: 'This evaluates retrieval, not answer generation. [Methodology](https://example.test/brainbench).',
  tags: ['evaluation'], now,
});
repo.append('concepts', 'retrieval-evals', { entry: 'Declared the synthetic fixture.', when: '2026-09-22T12:01:00Z' });
repo.create('people', 'alice-example', {
  title: 'Alice Example',
  compiledTruth: 'Alice founded Acme Labs. [Profile](https://example.test/alice).',
  tags: ['public'], now,
});
repo.append('people', 'alice-example', { entry: 'Founded Acme Labs.', when: '2024-01-05T09:00:00Z' });
repo.create('companies', 'acme-labs', {
  title: 'Acme Labs',
  compiledTruth: 'Acme Labs builds deterministic retrieval tools. [Source: https://example.test/acme]',
  tags: ['public'], now,
});
repo.append('companies', 'acme-labs', { entry: 'Published its first retrieval fixture.', when: '2025-04-03T10:30:00Z' });
repo.create('originals', 'private-plan', {
  title: 'Private Plan', compiledTruth: 'PRIVATE-MARKER-MUST-NEVER-RENDER', tags: ['private'], now,
});
repo.create('originals', 'escaping', {
  title: 'Escaping Fixture', compiledTruth: 'Unsafe bytes: <script>alert(1)</script>', tags: ['public'], now,
});

const publisher = createPublisher({ repo, title: 'Scope K Public Pages' });
const publicIds = ['concepts/retrieval-evals', 'people/alice-example', 'companies/acme-labs'];
const outA = path.join(fixtureRoot, 'public-a.html');
const outB = path.join(fixtureRoot, 'public-b.html');
const published = publisher.html(publicIds, { outPath: outA });
publisher.html(publicIds, { outPath: outB });
const htmlA = fs.readFileSync(outA, 'utf8');
const htmlB = fs.readFileSync(outB, 'utf8');
console.log(JSON.stringify({ path: published.path, pages: 3, compiledTruthSections: (htmlA.match(/class="compiled-truth"/g) ?? []).length, timelineSections: (htmlA.match(/class="timeline-section"/g) ?? []).length, citationLinks: (htmlA.match(/<a href="https:\/\/example\.test\//g) ?? []).length, byteIdenticalReplay: htmlA === htmlB }));
console.log('snippet=<h3>Compiled Truth</h3> | <h3>Timeline</h3> | <a href="https://example.test/brainbench"');
check('P5 publish.html returns the output path', published.path === outA && fs.existsSync(outA));
check('P5 renders all three compiled-truth sections', (htmlA.match(/class="compiled-truth"/g) ?? []).length === 3);
check('P5 renders all three timeline sections', (htmlA.match(/class="timeline-section"/g) ?? []).length === 3);
check('P5 preserves safe citation links', (htmlA.match(/<a href="https:\/\/example\.test\//g) ?? []).length === 3);
check('P5 private page bytes are not present', !htmlA.includes('PRIVATE-MARKER-MUST-NEVER-RENDER'));
check('P5 identical page inputs produce byte-identical HTML', htmlA === htmlB);

console.log('\nP6 RENDER-TIME PRIVACY REFUSAL');
const privateOut = path.join(fixtureRoot, 'private-refused.html');
let privateCode = null;
try { publisher.html(['originals/private-plan'], { outPath: privateOut }); }
catch (error) { privateCode = error.code; }
const factSecret = 'PRIVATE-FACT-MUST-NEVER-RENDER';
const factPublisher = createPublisher({ pages: [{
  id: 'public-shell', title: 'Public Shell', compiledTruth: `Compiled text cannot leak ${factSecret}`,
  timeline: [], facts: [{ fact: factSecret, private: true }],
}] });
const privateFactOut = path.join(fixtureRoot, 'private-fact-refused.html');
let privateFactCode = null;
try { factPublisher.html(['public-shell'], { outPath: privateFactOut }); }
catch (error) { privateFactCode = error.code; }
console.log(JSON.stringify({ declaredBehavior: publisher.privateIdBehavior, privatePage: privateCode, privateFact: privateFactCode, pageFileWritten: fs.existsSync(privateOut), factFileWritten: fs.existsSync(privateFactOut) }));
check('P6 private-ID behavior is declared', publisher.privateIdBehavior === 'E_PRIVACY_VIOLATION');
check('P6 private page fails closed with E_PRIVACY_VIOLATION', privateCode === 'E_PRIVACY_VIOLATION');
check('P6 private fact fails closed with E_PRIVACY_VIOLATION', privateFactCode === 'E_PRIVACY_VIOLATION');
check('P6 refused private bytes are never written', !fs.existsSync(privateOut) && !fs.existsSync(privateFactOut));

console.log('\nP7 BYTE-IDENTICAL BENCHMARK REPLAY');
const benchmarkReplay = await evals.bench({ corpus, retrieval });
const benchmarkBytesA = JSON.stringify(benchmark);
const benchmarkBytesB = JSON.stringify(benchmarkReplay);
console.log(`bytes=${Buffer.byteLength(benchmarkBytesA)} identical=${benchmarkBytesA === benchmarkBytesB}`);
check('P7 identical inputs produce byte-identical metrics', benchmarkBytesA === benchmarkBytesB);

console.log('\nP8 HTML ESCAPING');
const escapedOut = path.join(fixtureRoot, 'escaped.html');
publisher.html(['originals/escaping'], { outPath: escapedOut });
const escapedHtml = fs.readFileSync(escapedOut, 'utf8');
const escapedNeedle = '&lt;script&gt;alert(1)&lt;/script&gt;';
console.log(`escaped-bytes=${escapedNeedle} raw-script-present=${escapedHtml.includes('<script>alert(1)</script>')}`);
check('P8 hostile script bytes are escaped', escapedHtml.includes(escapedNeedle));
check('P8 hostile raw script bytes do not render', !escapedHtml.includes('<script>alert(1)</script>'));

console.log(`\nRESULT ${passed}/${total} PASS`);
