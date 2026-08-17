/**
 * B100 — COMPACTION + SPILL regression suite (deepseek-harness
 * `compaction-basic` + `spill-local`/`spill-policy` mirror).
 *
 * Proves: spill store (save/read/list + path safety), the ToolRuntime spill
 * policy (oversized results → bounded preview + locator), the spill-read
 * tool, compaction pressure/cut/checkpoint rewrite (dsh surfaceOp.replace),
 * compaction-aware history assembly, lock semantics, and idempotence.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-comp-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { saveText, readSpill, listSpills, spillStats, SPILL_THRESHOLD } = await import('./src/services/SpillStore.js');
const {
  maybeCompact, compactNow, compactionStatus, compactionAwareHistory,
  conversationPressure, hasLiveLock, isCompactionEvent, lastCheckpoint,
} = await import('./src/services/CompactionEngine.js');
const { appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');

const CONV = 'test-conv-100';

/* ---------------- fixtures: a long conversation ---------------- */
console.log('\n== Fixture: long conversation (60 exchanges) ==');
for (let i = 0; i < 60; i++) {
  appendConversationEvent(CONV, { role: 'user', text: `User question number ${i}: please explain topic ${i} in detail with examples and reasoning, including edge cases and practical applications.`, kind: 'chat' });
  appendConversationEvent(CONV, { role: 'jexi', text: `Answer ${i}: here is a detailed explanation of topic ${i} covering ${'the main ideas, worked examples, common pitfalls, caveats, and practical applications. '.repeat(35)}`, kind: 'chat' });
}

console.log('\n== 1. Spill store (dsh spill-local mirror) ==');
const big = 'x'.repeat(20000);
const sp = saveText({ owner: CONV, source: 'web-search', suggestedName: 'search-dump', content: big });
ok(sp.ok === true, 'saveText persists oversized text');
ok(sp.bytes === 20000, `exact bytes reported (${sp.bytes})`);
ok(/^spill:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.txt$/.test(sp.locator), 'locator is an opaque spill:// URI');
ok(sp.retrievalHint.includes('spill-read'), 'retrieval guidance names the spill-read tool');
const rd = readSpill(sp.locator);
ok(rd.ok && rd.content === big, 'readSpill returns the full body');
ok(readSpill('spill://../etc/passwd').ok === false, 'path traversal locator rejected');
ok(readSpill('spill://owner/../../evil.txt').ok === false, 'escaping locator rejected');
ok(readSpill('https://example.com/x.txt').ok === false, 'non-spill locator rejected');
ok(readSpill('spill://owner/missing-1.txt').ok === false, 'missing file fails honestly');
const lst = listSpills(CONV);
ok(lst.length === 1 && lst[0].locator === sp.locator, 'listSpills metadata only (no bodies)');
ok(spillStats(CONV).bytes === 20000, 'spillStats aggregates bytes');

console.log('\n== 2. ToolRuntime spill policy (dsh spill-policy mirror) ==');
// A plugin-mounted tool returning a huge payload goes through the gate.
const { createPluginContext, setActivePluginContext } = await import('./src/services/PluginContext.js');
const pctx = createPluginContext({ services: {} });
pctx.tools.register({
  slug: 'big-dump', name: 'Big Dump',
  handler: async () => ({ ok: true, data: 'L'.repeat(40000) }),
});
setActivePluginContext(pctx);
const bigRes = await executeTool({ slug: 'big-dump', args: {}, spillOwner: CONV });
ok(bigRes.ok === true, 'big tool result executes');
ok(String(bigRes.result).includes('spill://'), 'result carries a spill locator');
ok(String(bigRes.result).includes('📦 Result spilled'), 'spill notice present');
ok(String(bigRes.result).length < 4000, 'model-facing result is bounded (preview, not the dump)');
const spilled = listSpills(CONV);
ok(spilled.some((s) => s.bytes >= 40000), 'the oversized result landed in the spill store');

console.log('\n== 3. spill-read tool through the gate ==');
const bigSpill = spilled.find((x) => x.bytes >= 40000) || spilled[0];
const readBack = await executeTool({ slug: 'spill-read', args: { locator: bigSpill.locator } });
ok(readBack.ok && String(readBack.result).includes('"kind": "spill"'), 'spill-read returns kind=spill');
ok(String(readBack.result).includes('LLLL'), 'spill-read returns the body');
const unsafe = await executeTool({ slug: 'spill-read', args: { locator: 'spill://../evil' } });
ok(unsafe.ok === false, 'spill-read refuses unsafe locators');

console.log('\n== 4. Compaction pressure + status ==');
const p = conversationPressure(CONV);
ok(p.chars > 40000 && p.events === 120, `pressure detected (${p.chars} chars, ${p.events} events)`);
ok(p.approxTokens === Math.round(p.chars / 4), 'approxTokens derived');
const st0 = compactionStatus(CONV);
ok(st0.overThreshold === true, 'over the auto-compact threshold');
ok(hasLiveLock(CONV) === false, 'no live lock before compaction');

console.log('\n== 5. CompactNow with injected summarizer (dsh compactNow mirror) ==');
const injected = () => Promise.resolve('<compacted-summary>\n## Primary Request and Intent\n- user asked 30 questions about topics 0..29\n## Key Technical Concepts\n- topics explained with examples\n## Files and Code\n- (none)\n## Errors and Fixes\n- (none)\n## Pending Jobs\n- (none)\n## Decisions and Preferences\n- (none)\n</compacted-summary>');
const r = await compactNow(CONV, { summarizer: injected });
ok(r && r.compacted === true, 'compaction performed');
const events = loadConversationEvents(CONV, 2000);
ok(events.some((e) => e.kind === 'compaction/start') && events.some((e) => e.kind === 'compaction/end'), 'compaction/start + compaction/end markers bracket the operation (dsh lock)');
const cp = events.find((e) => e.kind === 'compaction');
ok(!!cp && cp.meta && cp.meta.op === 'replace', 'checkpoint event carries surfaceOp.replace metadata');
ok(cp.meta.shadowed.events >= 30, `shadowed range recorded (${cp.meta.shadowed.events} events)`);
ok(events[0].kind === 'compaction/start' && events[1].kind === 'compaction', 'checkpoint lands at the shadowed range position (surface order preserved)');
ok(events[events.length - 1].kind === 'compaction/end', 'end marker is the last event');
ok(events.some((e) => e.kind === 'chat'), 'retained tail survives verbatim');
const p2 = conversationPressure(CONV);
ok(p2.chars < p.chars / 2, `pressure dropped after compaction (${p2.chars} < ${p.chars / 2})`);
ok(hasLiveLock(CONV) === false, 'lock released after compaction');

console.log('\n== 6. Compaction-aware history + status ==');
const h = compactionAwareHistory(CONV);
ok(h.checkpoint && h.checkpoint.kind === 'compaction', 'history exposes the checkpoint');
ok(h.checkpoint.text.includes('## Primary Request and Intent'), 'checkpoint keeps the structured summary');
ok(h.tail.length > 0 && h.tail.every((e) => !isCompactionEvent(e)), 'tail is the retained events, markers filtered');
const st = compactionStatus(CONV);
ok(st.lastCheckpoint && st.lastCheckpoint.shadowed.events >= 30, 'status reports the last checkpoint');
ok(st.overThreshold === false, 'no longer over threshold');

console.log('\n== 7. Idempotence + locks ==');
// After a compaction the conversation is under the auto threshold — a
// NON-forced check is a no-op (dsh compactIfNeeded under pressure only).
const r2 = await maybeCompact(CONV);
ok(r2 === null, 'below threshold after compaction → maybeCompact is a no-op');
// Simulate a slow in-flight FORCED compaction on a FRESH large conversation
// → a second attempt refuses with busy (dsh durable-bracket lock).
for (let i = 0; i < 60; i++) {
  appendConversationEvent('lock-conv', { role: 'user', text: `lock q ${i}: ${'question about systems and architecture '.repeat(12)}`, kind: 'chat' });
  appendConversationEvent('lock-conv', { role: 'jexi', text: `lock a ${i}: ${'detailed answer with examples and caveats '.repeat(30)}`, kind: 'chat' });
}
const slowCp = () => new Promise((res) => setTimeout(() => res('<compacted-summary>\n## Primary Request and Intent\n- x\n## Key Technical Concepts\n- x\n## Files and Code\n- x\n## Errors and Fixes\n- x\n## Pending Jobs\n- x\n## Decisions and Preferences\n- x\n</compacted-summary>'), 700));
const inflight = compactNow('lock-conv', { summarizer: slowCp });
await new Promise((res) => setTimeout(res, 150));
ok(hasLiveLock('lock-conv') === true, 'lock held while compaction is in flight');
const during = await compactNow('lock-conv', { summarizer: slowCp });
ok(during && during.compacted === false && /in progress/.test(during.error || ''), 'concurrent compaction refused (dsh busy)');
await inflight;
ok(hasLiveLock('lock-conv') === false, 'lock released after in-flight compaction settles');

console.log('\n== 8. Auto path: under threshold → null, over → compacts ==');
const small = await maybeCompact('small-conv');
ok(small === null, 'empty/absent conversation → null');
for (let i = 0; i < 6; i++) {
  appendConversationEvent('med-conv', { role: 'user', text: `medium question ${i} about data science and machine learning models`, kind: 'chat' });
  appendConversationEvent('med-conv', { role: 'jexi', text: `medium answer ${i} explaining the concepts in detail ${'with examples and caveats. '.repeat(6)}`, kind: 'chat' });
}
const med = await maybeCompact('med-conv');
ok(med === null, 'below-threshold conversation does NOT auto-compact');
// push it over the threshold
for (let i = 0; i < 40; i++) {
  appendConversationEvent('med-conv', { role: 'user', text: `overflow question ${i}: explain ${'a long topic with many details and examples '.repeat(6)}`, kind: 'chat' });
  appendConversationEvent('med-conv', { role: 'jexi', text: `overflow answer ${i}: ${'detailed explanation with examples, caveats, and practical applications '.repeat(22)}`, kind: 'chat' });
}
const auto = await maybeCompact('med-conv', { summarizer: () => Promise.resolve('<compacted-summary>\n## Primary Request and Intent\n- (none)\n## Key Technical Concepts\n- (none)\n## Files and Code\n- (none)\n## Errors and Fixes\n- (none)\n## Pending Jobs\n- (none)\n## Decisions and Preferences\n- (none)\n</compacted-summary>') });
ok(auto && auto.compacted === true, 'over-threshold conversation auto-compacts');

console.log(`\nB100 compaction+spill: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
