/**
 * M5 — CODING RECOVERY LESSONS regression suite.
 *
 * Proves the build-teaches-build loop: a build whose tools error with no
 * files delivered records a `failure` lesson; a build that hits tool
 * errors but still delivers records a `recovery` lesson; clean builds and
 * provider-outage runs record nothing; recorded lessons are retrievable
 * by similar queries and injected into the next matching brief (visible
 * as a 📚 event); identical repeats dedupe instead of flooding the store.
 * Fully offline (mocked completions + deterministic executor).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m5-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');
const { retrieveLessons, lessonCount } = await import('./src/services/director/Lessons.js');

const writeOk = (c) => ({ tool_call_id: c.id, content: JSON.stringify({ ok: true, kind: 'write-result', path: 'app.js', operation: 'create', size: 9 }) });
const writeErr = (c, why = 'disk quota exceeded') => ({ tool_call_id: c.id, content: `ERROR: ${why}` });

console.log('\n== 1. Failed build (errors, no files) records a failure lesson ==');
const ev1 = [];
const fail = await runAutonomousCoding({
  query: 'build a flaky widget',
  sendEvent: (t, d) => ev1.push(`${t}:${(d && d.message) || ''}`),
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"app.js","content":"x"}' }] },
    { text: 'I gave up.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => writeErr(c)),
});
ok(fail.statistics.lesson === 'failure', `statistics.lesson = failure (${fail.statistics.lesson})`);
ok(lessonCount() === 1, `one lesson stored (${lessonCount()})`);
ok(ev1.some((e) => e.includes('📚 Failure lesson recorded')), 'failure-lesson event emitted');
const found1 = retrieveLessons('flaky widget build', 3);
ok(found1.length === 1 && found1[0].kind === 'failure' && found1[0].failure.includes('disk quota'), 'failure lesson retrievable with the real error');

console.log('\n== 2. Recovered build (errors, files delivered) records recovery ==');
const ev2 = [];
const rec = await runAutonomousCoding({
  query: 'build a sturdy gadget',
  sendEvent: (t, d) => ev2.push(`${t}:${(d && d.message) || ''}`),
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"app.js","content":"x"}' }] },
    { toolCalls: [{ id: 'c2', name: 'write', arguments: '{"file_path":"app.js","content":"y"}' }] },
    { text: 'Delivered after a retry.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => (c.id === 'c1' ? writeErr(c, 'timeout writing file') : writeOk(c))),
});
ok(rec.statistics.lesson === 'recovery', `statistics.lesson = recovery (${rec.statistics.lesson})`);
ok(rec.files.length === 1, 'file delivery recorded');
ok(lessonCount() === 2, `second lesson stored (${lessonCount()})`);
ok(ev2.some((e) => e.includes('📚 Recovery lesson recorded')), 'recovery-lesson event emitted');

console.log('\n== 3. Clean builds and outage runs record nothing ==');
const clean = await runAutonomousCoding({
  query: 'build a tiny trinket',
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"app.js","content":"x"}' }] },
    { text: 'Done, no errors.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => writeOk(c)),
});
ok(clean.statistics.lesson === null && lessonCount() === 2, 'clean build: no lesson');
const outage = await runAutonomousCoding({ query: 'build an intriguing thing', __mockCompletions: [{ toolCalls: [] }] });
ok(outage.statistics.lesson === null && lessonCount() === 2, 'provider-outage run: no lesson');

console.log('\n== 4. Past lessons inject into the next matching brief ==');
const ev4 = [];
const again = await runAutonomousCoding({
  query: 'try a flaky widget variant',
  sendEvent: (t, d) => ev4.push(`${t}:${(d && d.message) || ''}`),
  __mockCompletions: [
    { toolCalls: [{ id: 'c9', name: 'write', arguments: '{"file_path":"b.js","content":"z"}' }] },
    { text: 'Done.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => writeOk(c)),
});
ok(ev4.some((e) => e.includes('past build lesson(s) inform this run')), '📚 injection event emitted');
ok(again.statistics.lessonsInjected === 1, `statistics.lessonsInjected = 1 (${again.statistics.lessonsInjected})`);
ok(again.statistics.lesson === null, 'clean rerun still records nothing');

console.log('\n== 5. Identical repeats dedupe (no store flooding) ==');
await runAutonomousCoding({
  query: 'build a flaky widget',
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"app.js","content":"x"}' }] },
    { text: 'Gave up again.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => writeErr(c)),
});
ok(lessonCount() === 2, `store not flooded (${lessonCount()})`);
const twin = retrieveLessons('flaky widget build', 3)[0];
ok(twin && (twin.times || 1) >= 2, `repeat bumps recurrence (times=${twin && twin.times})`);

console.log(`\nM5 recovery-lessons: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
