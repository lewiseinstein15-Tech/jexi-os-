/**
 * JEXI OS — intent classification regression tests (Phase 2A).
 *
 * Guards two substring-matching defects confirmed against the live classifier:
 *
 *   1. The legal_task rule matched the bare substring "lease", so any sentence
 *      containing "release" ("the latest Node.js release") was classified as a
 *      legal task and routed to the legal team with no web tool.
 *   2. The academic DomainRegistry rules contained short bare alternatives —
 *      "ode" inside applied-mathematics and "wes" inside genetics-genomics —
 *      which matched inside unrelated words ("Node", "newest").
 *
 * The tests use the REAL production classifier (`Planner.analyzeIntent`) with
 * no provider keys, so only the deterministic cascade runs. They assert both
 * directions: false positives are gone AND genuine legal / genetics / biology /
 * mathematics / NLP questions still classify correctly.
 *
 * The DomainRegistry assertions run the real matcher directly, so a future
 * regression in the abbreviation handling fails fast and locally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-intent-'));

const { Planner } = await import('../../src/services/Planner.js');
const { matchDomains } = await import('../../src/services/DomainRegistry.js');

const planner = new Planner();
const classify = (q) => planner.analyzeIntent(q);

/* ── the two confirmed false positives ──────────────────────────────────── */

test('classification: "release" does not trigger a legal-task classification', async () => {
  // The bare word, and the word inside a sentence that also names a release.
  const bare = await classify('release');
  assert.notEqual(bare.intent, 'legal_task', `"release" must not be legal_task, got ${bare.intent}`);

  const node = await classify('search the web for the latest Node.js release');
  assert.notEqual(node.intent, 'legal_task', `"…Node.js release" must not be legal_task, got ${node.intent}`);
});

test('classification: "newest React version" is not a genetics match', async () => {
  const r = await classify('what is the newest React version');
  assert.notEqual(r.intent, 'domain:genetics-genomics',
    `"newest" must not match the genetics rule, got ${r.intent}`);
});

test('classification: a file-summarize request is not routed to NLP by "summarize"', async () => {
  const r = await classify('read the file package.json and summarize it');
  assert.notEqual(r.intent, 'domain:nlp',
    `a file action must not collapse into the NLP field, got ${r.intent}`);
});

/* ── genuine matches must survive ───────────────────────────────────────── */

test('classification: a genuine lease-agreement question stays legal', async () => {
  const r = await classify('review this lease agreement for unfair clauses');
  assert.equal(r.intent, 'legal_task', `a real lease question must be legal_task, got ${r.intent}`);
});

test('classification: a genuine genetics question keeps its field', async () => {
  const r = await classify('explain CRISPR gene editing in eukaryotes');
  assert.equal(r.intent, 'domain:biology', `CRISPR must route to a life-science field, got ${r.intent}`);
});

test('classification: genuine mathematics stays mathematical', async () => {
  const r = await classify('solve the differential equation dy/dx = 2x using an ODE solver');
  assert.ok(/math/.test(r.intent) || r.intent.startsWith('domain:applied-mathematics'),
    `an ODE question must stay mathematical, got ${r.intent}`);
});

/* ── the registry matcher itself: token boundaries, both directions ─────── */

test('domain matcher: bare "ode"/"wes" no longer match inside unrelated words', () => {
  assert.equal(matchDomains('search the web for the latest Node.js release').some((d) => d.id === 'applied-mathematics'), false,
    '"Node" must not match applied-mathematics');
  assert.equal(matchDomains('what is the newest React version').some((d) => d.id === 'genetics-genomics'), false,
    '"newest" must not match genetics-genomics');
});

test('domain matcher: the abbreviations still match as real tokens', () => {
  // "ODE" is a real mathematics token and must still be recognised.
  assert.ok(matchDomains('solve the ODE dy/dx = 2x').some((d) => d.id === 'applied-mathematics'),
    'a standalone ODE must still match applied-mathematics');
  // "WES" (whole exome sequencing) is a real genetics token.
  assert.ok(matchDomains('whole exome sequencing wes pipeline').some((d) => d.id === 'genetics-genomics'),
    'a standalone wes must still match genetics-genomics');
});

/* ── Phase 2B: the remaining unbounded short tokens ─────────────────────── */

const matches = (q, id) => matchDomains(q).some((d) => d.id === id);

test('domain matcher: "4g" does not match inside "4GB"/"4GHz" (false positive)', () => {
  // The audit's concrete case: "a 4GB file" used to route to telecommunications
  // because the bare alternative "4g" matched the "4G" prefix of "4GB".
  assert.equal(matches('a 4GB file', 'telecommunications'), false,
    '"a 4GB file" must not match telecommunications');
  assert.equal(matches('the 4GHz clock', 'telecommunications'), false,
    '"4GHz" must not match telecommunications');
});

test('domain matcher: genuine 4G / SS7 / M2M / 3DoF / 6DoF / Cas9 / GSM8K still match', () => {
  assert.ok(matches('4G network deployment', 'telecommunications'), 'a real 4G query must still match');
  assert.ok(matches('4g lte', 'telecommunications'), 'lowercase 4g lte must still match');
  assert.ok(matches('ss7 signaling', 'telecommunications'), 'SS7 must still match telecommunications');
  assert.ok(matches('SS7 protocol', 'telecommunications'), 'uppercase SS7 must still match');
  assert.ok(matches('m2m device', 'internet-of-things'), 'M2M must still match internet-of-things');
  assert.ok(matches('3DoF tracking', 'virtual-reality'), '3DoF must still match virtual-reality');
  assert.ok(matches('6DoF headset', 'virtual-reality'), '6DoF must still match virtual-reality');
  assert.ok(matches('Cas9 nuclease', 'molecular-biology'), 'Cas9 must still match molecular-biology');
  assert.ok(matches('crispr-cas9 editing', 'molecular-biology'), 'crispr-cas9 must still match');
  assert.ok(matches('GSM8K benchmark', 'ai-for-mathematics'), 'GSM8K must still match ai-for-mathematics');
});

test('domain matcher: bounded tokens do not match glued into unrelated strings', () => {
  // Whole-token boundaries: a digit/letter glued on must not match.
  assert.equal(matches('4gb', 'telecommunications'), false, '"4gb" must not match');
  assert.equal(matches('cas9x', 'molecular-biology'), false, '"cas9x" must not match');
  assert.equal(matches('xcas9', 'molecular-biology'), false, '"xcas9" must not match');
  assert.equal(matches('m2m2', 'internet-of-things'), false, '"m2m2" must not match');
  assert.equal(matches('ss77', 'telecommunications'), false, '"ss77" must not match');
});
