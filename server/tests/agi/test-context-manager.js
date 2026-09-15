/**
 * AGI Phase 6 Scope C — CONTEXT MANAGER.
 *
 * Real behavior, no mocks:
 *
 *   C1  sources: register, collect, fail-soft on a throwing source.
 *   C2  budget: priority split across weighted sections.
 *   C3  clip: an over-long section is clipped, not dropped.
 *   C4  drop: lowest-priority sections are shed until the budget fits.
 *   C5  keep: a `keep` section is never dropped.
 *   C6  packing: system + context + live instruction, instruction last.
 *   C7  exhaustive pack: greedy item packing under a token cap.
 *   C8  compaction: deterministic extractive range keeps head/tail anchors.
 *   C9  pressure: state thresholds (cool/warm/hot/over).
 *   C10 build(): end-to-end report — kept/clipped/dropped/skipped/allocations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { build, buildFromSections, packItems, compact, compactRange, contextPressure } = await import('../../src/context/index.js');
const { registerSource, collectSources, listSources } = await import('../../src/context/sources/index.js');
const { clipToBudget, allocateBudget } = await import('../../src/context/budget/allocator.js');
const { packMessages } = await import('../../src/context/packing/prompt.js');
const { registerCompactor } = await import('../../src/context/compaction/summarize.js');

test('C1 — sources: register, collect, fail-soft on a throwing source', async () => {
  const un = registerSource('c1-good', { priority: 5, produce: async () => 'good-content' });
  const un2 = registerSource('c1-bad', { priority: 5, produce: async () => { throw new Error('boom'); } });
  const rows = await collectSources({}, {}, { only: ['c1-good', 'c1-bad'] });
  const good = rows.find((r) => r.name === 'c1-good');
  const bad = rows.find((r) => r.name === 'c1-bad');
  assert.equal(good.content, 'good-content');
  assert.equal(bad.content, '');
  assert.match(bad.skipped, /boom/);
  un(); un2();
  assert.ok(listSources().some((s) => s.name === 'instruction'), 'built-in sources missing');
});

test('C2 — allocateBudget: pro-rata by weight', () => {
  const alloc = allocateBudget([{ name: 'a', weight: 1 }, { name: 'b', weight: 3 }], 1000);
  assert.equal(alloc.find((a) => a.name === 'a').share, 250);
  assert.equal(alloc.find((a) => a.name === 'b').share, 750);
});

test('C3 — an over-long section is clipped, not dropped', () => {
  const out = clipToBudget([{ name: 'big', content: 'x'.repeat(5000) }], { maxChars: 20000, maxTokens: 100000, perSectionChars: 100 });
  assert.equal(out.sections.length, 1);
  assert.ok(out.clipped.includes('big'));
  assert.ok(out.sections[0].content.length <= 101); // 100 + ellipsis
});

test('C4 — lowest-priority sections are shed until the budget fits', () => {
  const sections = [
    { name: 'top', content: 'a'.repeat(500), priority: 10 },
    { name: 'mid', content: 'b'.repeat(500), priority: 5 },
    { name: 'low', content: 'c'.repeat(500), priority: 1 },
  ];
  const out = clipToBudget(sections, { maxChars: 1100, maxTokens: 100000, perSectionChars: 5000 });
  assert.ok(out.dropped.includes('low'), `dropped=${out.dropped.join(',')}`);
  assert.ok(out.sections.some((s) => s.name === 'top'));
  assert.ok(out.chars <= 1100);
});

test('C5 — a `keep` section is never dropped', () => {
  const sections = [
    { name: 'keepme', content: 'k'.repeat(900), priority: 0, keep: true },
    { name: 'other', content: 'o'.repeat(900), priority: 0 },
  ];
  const out = clipToBudget(sections, { maxChars: 950, maxTokens: 100000, perSectionChars: 5000 });
  assert.ok(out.sections.some((s) => s.name === 'keepme'), 'keep section was dropped');
});

test('C6 — packing: system, context, then live instruction last', () => {
  const packed = packMessages(
    [{ name: 'mission', content: 'MISSION' }, { name: 'instruction', content: 'DO THE THING' }],
    { system: 'SYS', instruction: 'DO THE THING', maxTokens: 8000 },
  );
  assert.equal(packed.messages[0].role, 'system');
  assert.equal(packed.messages[0].content, 'SYS');
  assert.equal(packed.messages.at(-1).content, 'DO THE THING');
  assert.match(packed.messages[1].content, /MISSION/);
});

test('C7 — exhaustive pack: greedy under a token cap', () => {
  const items = [
    { id: 'a', text: 'x'.repeat(400), score: 9 },
    { id: 'b', text: 'y'.repeat(400), score: 5 },
    { id: 'c', text: 'z'.repeat(400), score: 1 },
  ];
  const packed = packItems(items, { maxTokens: 110, maxItems: 10 });
  assert.ok(packed.items.length >= 1);
  assert.ok(packed.tokens <= 110);
  assert.equal(packed.overflowed, true);
  assert.equal(packed.considered, 3);
  // highest score kept first
  assert.equal(packed.items[0].id, 'a');
});

test('C8 — compaction: head/tail anchors, middle sampled out', () => {
  const events = Array.from({ length: 40 }, (_, i) => `event-${i}`);
  const out = compactRange(events, { maxChars: 200, headCount: 3, tailCount: 3 });
  assert.match(out.summary, /event-0/);
  assert.match(out.summary, /event-39/);
  assert.match(out.summary, /compacted/);
  assert.ok(out.omitted > 0);
  assert.ok(out.summary.length <= 200);

  const small = compactRange(['a', 'b'], { maxChars: 200 });
  assert.equal(small.omitted, 0);
  assert.equal(small.summary, 'a\nb');
});

test('C9 — pressure state thresholds', () => {
  assert.equal(contextPressure(10, 100).state, 'cool');
  assert.equal(contextPressure(70, 100).state, 'warm');
  assert.equal(contextPressure(90, 100).state, 'hot');
  assert.equal(contextPressure(120, 100).state, 'over');
});

test('C10 — build(): end-to-end budgeted report', async () => {
  const un = registerSource('c10-volatile', {
    priority: 1, weight: 1,
    produce: () => 'v'.repeat(6000),
  });
  try {
    const report = await build({
      mission: { title: 'Ship Phase 6', goal: 'build all subsystems' },
      memories: ['prefers SQLite', 'works late'],
      history: [{ role: 'user', content: 'start' }, { role: 'assistant', content: 'on it' }],
      instruction: 'Implement Scope C',
    }, { budget: { maxChars: 3000, maxTokens: 1000, perSectionChars: 20000 } });

    assert.equal(report.messages.at(-1).content, 'Implement Scope C');
    assert.ok(report.usage.tokens <= 1000, `over token budget: ${report.usage.tokens}`);
    assert.ok(Array.isArray(report.allocations) && report.allocations.length >= 4);
    assert.ok(report.sections.includes('mission'));
    assert.ok(report.dropped.length >= 1, 'volatile section should have been dropped');
    assert.ok(['cool', 'warm', 'hot', 'over'].includes(report.pressure.state));
  } finally {
    un();
  }
});

test('C11 — a registered compactor takes precedence over the deterministic path', async () => {
  const un = registerCompactor(async () => ({ summary: 'MODEL SUMMARY', omitted: 99, kept: 0 }));
  try {
    const out = await compact(['a', 'b', 'c']);
    assert.equal(out.summary, 'MODEL SUMMARY');
  } finally { un(); }
  const fallback = await compact(['a', 'b']);
  assert.equal(fallback.summary, 'a\nb');
});

test('C12 — buildFromSections is synchronous and budget-capped', () => {
  const out = buildFromSections(
    [{ name: 'ctx', content: 'c'.repeat(9000), priority: 1 }, { name: 'instruction', content: 'hi', keep: true, priority: 5 }],
    { budget: { maxChars: 2000, maxTokens: 100000, perSectionChars: 2000 } },
  );
  assert.ok(out.usage.chars <= 2000 + 32);
  assert.equal(out.messages.at(-1).content, 'hi');
});