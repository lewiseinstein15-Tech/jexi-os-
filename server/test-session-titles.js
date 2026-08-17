/**
 * B108 — SESSION TITLES + STATS regression suite
 * (deepseek-harness session-title + session-stats mirror).
 *
 * Proves: fallback titles from the first message, LLM/manual titles win and
 * persist, one-shot auto-title (no re-generation, no retry loops), the
 * injected generator seam, rename + regenerate, conversation stats (tool
 * calls, tokens, duration, compactions), title cleanup on delete, and the
 * title flowing into recent-sessions references + search results.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-title-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const {
  getStoredTitle, setStoredTitle, clearStoredTitle, maybeAutoTitle,
  setTitleGenerator, cleanTitle, userMessageCount, titleUntitledSweep,
} = await import('./src/services/SessionTitles.js');
const { appendConversationEvent, conversationSummary, listConversations, recentSessionsBlock, searchConversations, deleteConversation } = await import('./src/services/SessionConversations.js');
const { appendEvent } = await import('./src/services/EventLog.js');
const { compactNow } = await import('./src/services/CompactionEngine.js');

const CONV = 'title-conv';

console.log('\n== 1. Fallback title = first message ==');
appendConversationEvent(CONV, { role: 'user', text: 'help me build a todo app with dark mode please', kind: 'chat' });
const s1 = conversationSummary(CONV);
ok(s1.title.includes('help me build a todo app'), 'fallback title is the first user message');
ok(s1.titleSource === 'fallback', 'source reported as fallback');
ok(getStoredTitle(CONV) === undefined, 'no stored title yet');

console.log('\n== 2. Auto-title fires once (injected generator) ==');
let genCalls = 0;
setTitleGenerator(async (excerpt) => { genCalls += 1; return 'Todo App With Dark Mode'; });
// Only 1 user message so far — no auto-title yet.
ok(await maybeAutoTitle(CONV) === false, 'not enough content yet (no auto-title)');
for (let i = 1; i < 5; i++) appendConversationEvent(CONV, { role: 'user', text: `question number ${i} about the todo app features`, kind: 'chat' });
ok(userMessageCount(CONV) === 5, 'five user messages now');
const auto = await maybeAutoTitle(CONV);
ok(auto === true, 'auto-title generated once threshold reached');
ok(genCalls === 1, 'generator called exactly once');
ok(getStoredTitle(CONV) === 'Todo App With Dark Mode', 'LLM title stored clean');
ok(conversationSummary(CONV).title === 'Todo App With Dark Mode', 'summary uses the stored title');
ok(conversationSummary(CONV).titleSource === 'llm', 'source reported as llm');
ok(await maybeAutoTitle(CONV) === false, 'second auto-title is a no-op (already titled)');
ok(genCalls === 1, 'generator NOT called again');

console.log('\n== 3. Failure is one-shot (no retry loops) ==');
setTitleGenerator(async () => { throw new Error('no keys'); });
appendConversationEvent('fail-conv', { role: 'user', text: 'a', kind: 'chat' });
appendConversationEvent('fail-conv', { role: 'user', text: 'b', kind: 'chat' });
appendConversationEvent('fail-conv', { role: 'user', text: 'c', kind: 'chat' });
appendConversationEvent('fail-conv', { role: 'user', text: 'd', kind: 'chat' });
ok(await maybeAutoTitle('fail-conv') === false, 'failed generation returns false');
ok(await maybeAutoTitle('fail-conv') === false, 'retry after failure is suppressed (attempted)');
ok(getStoredTitle('fail-conv') === undefined, 'no title stored on failure');

console.log('\n== 4. Rename + regenerate ==');
const rn = setStoredTitle(CONV, '  My Custom Title!!  ');
ok(rn.ok === true && rn.title === 'My Custom Title!!', 'rename stores the cleaned title');
ok(getStoredTitle(CONV) === 'My Custom Title!!', 'rename persisted');
ok(setStoredTitle(CONV, '   ').ok === false, 'empty rename rejected');
setTitleGenerator(async () => 'Regenerated Title');
const rg = await maybeAutoTitle('title-conv');
ok(rg === false, 'regenerate on an already-titled conversation is a no-op');
clearStoredTitle(CONV);
setTitleGenerator(async () => 'Fresh Title');
ok(await maybeAutoTitle(CONV) === true, 'after clearing, auto-title works again');
ok(getStoredTitle(CONV) === 'Fresh Title', 'fresh title stored');

console.log('\n== 5. cleanTitle sanitizes ==');
ok(cleanTitle('"Quoted Title"') === 'Quoted Title', 'strips wrapping quotes');
ok(cleanTitle('  spaced   out  ') === 'spaced out', 'collapses whitespace');
ok(cleanTitle('Too long. '.repeat(20)).length <= 60, 'caps length at 60 chars');
ok(cleanTitle('trailing period.') === 'trailing period', 'strips trailing period');
ok(cleanTitle('Keep the Title!') === 'Keep the Title!', 'keeps meaningful punctuation');

console.log('\n== 6. Stats (dsh session-stats mirror) ==');
appendEvent('tool_call', { tool: 'web-search', args: {} }, CONV);
appendEvent('tool_call', { tool: 'deep-read', args: {} }, CONV);
appendEvent('tool_result', { tool: 'web-search', ok: true }, CONV);
const stats = conversationSummary(CONV);
ok(stats.toolCalls === 2, `tool calls counted from the event log (${stats.toolCalls})`);
ok(stats.approxTokens > 0, 'approx tokens derived');
ok(stats.durationMs >= 0 && stats.messageCount > 0, 'duration + message count present');
// compaction count
for (let i = 0; i < 50; i++) {
  appendConversationEvent('comp-conv', { role: 'user', text: `cc q ${i}: ${'long question about the system and its architecture '.repeat(8)}`, kind: 'chat' });
  appendConversationEvent('comp-conv', { role: 'jexi', text: `cc a ${i}: ${'long detailed answer with examples and caveats and notes '.repeat(30)}`, kind: 'chat' });
}
const injected = () => Promise.resolve('<compacted-summary>\n## Primary Request and Intent\n- x\n## Key Technical Concepts\n- x\n## Files and Code\n- x\n## Errors and Fixes\n- x\n## Pending Jobs\n- x\n## Decisions and Preferences\n- x\n</compacted-summary>');
await compactNow('comp-conv', { summarizer: injected });
ok(conversationSummary('comp-conv').compactions === 1, 'compaction count in stats');

console.log('\n== 7. Titles flow everywhere ==');
const refs = recentSessionsBlock('other-conv', 5);
ok(refs.includes('Fresh Title') || refs.includes('My Custom Title') || refs.includes('help me build'), 'recent-sessions references carry titles');
const results = searchConversations('todo app');
ok(results.some((r) => r.conversation.includes('Todo App') || r.conversation.includes('help me build') || r.conversation.includes('Fresh Title')), 'search results carry titles');
const list = listConversations();
ok(list.some((c) => c.title === 'Fresh Title'), 'list shows the stored title');
ok(list.some((c) => typeof c.toolCalls === 'number'), 'list entries carry tool-call stats');

console.log('\n== 8. Delete cleans the title ==');
deleteConversation('title-conv');
ok(getStoredTitle('title-conv') === undefined, 'deleting a conversation removes its stored title');

console.log('\n== 9. Boot sweep titles untitled conversations (bounded) ==');
setTitleGenerator(async () => 'Sweep Title');
const sw = await titleUntitledSweep({ max: 5 });
ok(sw.titled >= 0 && typeof sw.titled === 'number', 'boot sweep ran without error');

console.log(`\nB108 session-titles: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
