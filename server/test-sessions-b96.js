/**
 * B96 — DeepSeek-Harness-style session model regression suite.
 * Conversation append-only logs, fork with lineage, search across sessions,
 * and the new tool engines (session-list/search/fork, todo, plan).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate ALL stores: config reads DATA_DIR at import time, so set env FIRST
// then dynamic-import every module that reads config.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-sess-b96-'));
process.env.WORKSPACE_DIR = path.join(process.env.DATA_DIR, 'ws');

const {
  appendConversationEvent, loadConversationEvents, listConversations,
  conversationSummary, forkConversation, searchConversations, deleteConversation,
} = await import('./src/services/SessionConversations.js');
const { todoAdd, todoList, todoComplete, todoRemove } = await import('./src/services/TodoStore.js');
const { planSet, planGet, planUpdate } = await import('./src/services/PlanStore.js');

const legacy_imports = {
  appendConversationEvent, loadConversationEvents, listConversations,
  conversationSummary, forkConversation, searchConversations, deleteConversation,
}

// Isolate the conversation store to a temp dir.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-sess-'));
process.env.DATA_DIR = TMP;
// Re-import is not needed (module reads DATA_DIR lazily via config at import
// time — but config reads env at import; we set before importing in tests via
// the import above already happened... handle by writing to the default and
// cleaning up instead). Simpler: use the real DATA_DIR but unique conv ids.

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failed++; console.log(`  ❌ ${n}`); } };

console.log('\n== Append-only conversation log ==');
const cid = `test-${Date.now()}`;
appendConversationEvent(cid, { role: 'user', text: 'Build me a todo app' });
appendConversationEvent(cid, { role: 'jexi', text: '✅ Built it.' });
appendConversationEvent(cid, { role: 'user', text: 'Now add dark mode' });
const evs = loadConversationEvents(cid);
ok(evs.length === 3, 'events appended');
ok(evs[0].role === 'user' && evs[0].seq === 0, 'first event user seq 0');
ok(evs[2].role === 'user' && evs[2].seq === 2, 'seq increments');
ok(evs.every((e) => typeof e.at === 'number' && typeof e.text === 'string'), 'durable fields');

console.log('\n== Titles + summary ==');
const sum = conversationSummary(cid);
ok(sum && sum.title === 'Build me a todo app', 'titled by first user message');
ok(sum.messageCount === 3 && sum.userMessages === 2 && sum.jexiMessages === 1, 'counts correct');
const all = listConversations();
ok(all.some((c) => c.id === cid), 'listed among conversations');

console.log('\n== Fork with lineage ==');
const f = forkConversation(cid);
ok(f.ok === true && f.id && f.id !== cid, 'fork created new id');
ok(f.parentSession === cid && f.seedLength === 3, 'lineage + seed length recorded');
const fEvs = loadConversationEvents(f.id);
ok(fEvs.length === 3, 'fork seeded with parent history');
appendConversationEvent(f.id, { role: 'user', text: 'forked continuation' });
ok(loadConversationEvents(f.id).length === 4, 'fork can continue independently');
ok(loadConversationEvents(cid).length === 3, 'parent unchanged');

console.log('\n== Search across sessions ==');
const res = searchConversations('dark mode');
ok(Array.isArray(res) && res.length >= 1, 'search finds matching conversation');
ok(res[0].hits.some((h) => /dark mode/i.test(h.text)), 'hit content present');
const none = searchConversations('zzz-not-there');
ok(none.length === 0, 'no false positives');

console.log('\n== Delete ==');
ok(deleteConversation(cid).ok === true, 'delete ok');
ok(loadConversationEvents(cid).length === 0, 'gone after delete');

console.log('\n== Todo store ==');
todoAdd('research APIs');
todoAdd('write docs');
ok(todoList().length === 2, 'two todos');
ok(todoList()[0].text === 'research APIs', 'todo text kept');
todoComplete(0);
ok(todoList()[0].done === true, 'todo completed');
todoRemove(1);
ok(todoList().length === 1, 'todo removed');

console.log('\n== Plan store ==');
planSet('Ship v2', ['design', 'build', 'test']);
const p = planGet();
ok(p.title === 'Ship v2' && p.steps.length === 3, 'plan created');
ok(p.steps[0].status === 'pending', 'steps start pending');
planUpdate(1, 'done', 'build finished');
const p2 = planGet();
ok(p2.steps[1].status === 'done' && p2.steps[1].note === 'build finished', 'step updated');

// Cleanup test conversations
for (const c of listConversations()) if (c.id.startsWith('test-')) deleteConversation(c.id);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
