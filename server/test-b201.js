/**
 * B201 — DeliverableContinuation: counted file deliverables that come up
 * short get continuation passes before the answer ships.
 */
import fs from 'fs';

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
};

const { parseRequestedCount, continueDeliverable } = await import('./src/services/DeliverableContinuation.js');
const { extractFileBlocks } = await import('./src/services/FileBlockWriter.js');

// ── count parsing ──────────────────────────────────────────────────────────
ok(parseRequestedCount('Build me a guide: 10 lessons, one file per lesson (lesson-01.md through lesson-10.md)') === 10, '"10 lessons" → 10');
ok(parseRequestedCount('write 3 files about sloths') === 3, '"3 files" → 3');
ok(parseRequestedCount('lesson-01 through lesson-08 please') === 8, '"lesson-01 through lesson-08" → 8');
ok(parseRequestedCount('give me twenty chapters of sci-fi') === 20, '"twenty chapters" → 20');
ok(parseRequestedCount('make me a nice guide about coffee') === null, 'no explicit count → null (no continuation)');
ok(parseRequestedCount('write 999 files') === 40, 'absurd counts are capped at 40');

// ── continuation loop (mocked generator) ───────────────────────────────────
const lessonBlock = (n, word) => `**swahili-lessons/lesson-${String(n).padStart(2, '0')}.md**\n\`\`\`markdown\n# Lesson ${n}\n\n${word}\n\`\`\``;
const shortDraft = `Here is your guide:\n\n${lessonBlock(1, 'Habari')}\n\n${lessonBlock(2, 'Mama')}\n\nEnjoy!`;

// generator: round 1 adds lessons 3-4, round 2 adds 5 (then complete = 5).
// NOTE: match the "Write <files>." request line, NOT bare names — the
// already-written list legitimately contains earlier lesson names.
const gen = async (prompt) => {
  if (/Write .*lesson-03/.test(prompt)) return `${lessonBlock(3, 'Chakula')}\n\n${lessonBlock(4, 'Soko')}`;
  if (/Write .*lesson-05/.test(prompt)) return lessonBlock(5, 'Saa');
  return 'I could not continue.';
};
const narrations = [];
const out = await continueDeliverable({
  query: 'Build me a Swahili guide: 5 lessons, one file per lesson',
  summary: shortDraft, generate: gen,
  sendEvent: (t, d) => narrations.push(d && d.text),
});
ok(out.rounds === 2, 'continuation ran exactly enough rounds (2)');
ok(extractFileBlocks(out.summary).length === 5, 'final summary holds all 5 lesson blocks');
ok(out.delivered === 5 && out.requested === 5, 'delivered === requested (5/5)');
ok(narrations.some((n) => /2 of 5/.test(String(n))) && narrations.some((n) => /4 of 5/.test(String(n))), 'each round narrates the gap live');

// ── no-op paths ────────────────────────────────────────────────────────────
const complete = await continueDeliverable({
  query: 'write 2 files', summary: `**a.md**\n\`\`\`\nx\n\`\`\`\n\n**b.md**\n\`\`\`\ny\n\`\`\``,
  generate: async () => { throw new Error('should not be called'); },
});
ok(complete.rounds === 0 && complete.delivered === 2, 'complete deliverable → zero rounds, no generator call');

const uncounted = await continueDeliverable({
  query: 'write me a nice guide', summary: shortDraft,
  generate: async () => { throw new Error('should not be called'); },
});
ok(uncounted.rounds === 0 && uncounted.summary === shortDraft, 'uncounted deliverable → untouched');

const dead = await continueDeliverable({
  query: 'write 5 files', summary: shortDraft,
  generate: async () => 'no blocks here at all',
  maxRounds: 3,
});
ok(dead.rounds === 1 && dead.delivered === 2, 'a model that adds nothing stops after 1 round (no infinite loop)');

// ── wiring ────────────────────────────────────────────────────────────────
const idx = fs.readFileSync('./index.js', 'utf-8');
ok(idx.includes('continueDeliverable({ query, summary: results.summary, sendEvent })'), 'index.js wires the completeness pass before done()');

console.log(failures === 0 ? '\n🎉 ALL B201 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
