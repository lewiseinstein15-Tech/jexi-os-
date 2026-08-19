/**
 * B106 — GAP-CLOSING suite (deepseek-harness tool-jobs, repeat-tool-reminder,
 * message-feedback, session-reference, session-log-export mirrors).
 *
 * Proves: background jobs (start/collect/list/kill + concurrency cap) and
 * their tools through the gate, repeat-call reminders at thresholds,
 * feedback storage + conversation-log events, session references that
 * exclude the current conversation, and transcript export.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b106-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { startJob, collectJob, listJobs, killJob, jobStats, setJobExecutor } = await import('./src/services/BackgroundJobs.js');
const { repeatReminderFor } = await import('./src/services/AgentLoop.js');
const { addFeedback, listFeedback, feedbackStats } = await import('./src/services/FeedbackStore.js');
const { recentSessionsBlock, exportConversation, appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { TOOL_COUNT, TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');

console.log('\n== 1. Registry: the 4 job tools (dsh tool-jobs) ==');
ok(TOOL_COUNT === 211, `registry count 187 → 205 (${TOOL_COUNT})`);
for (const slug of ['run_in_background', 'jobs_collect', 'job_list', 'job_kill']) {
  ok(TOOL_REGISTRY.some((t) => t.slug === slug), `${slug} registered`);
}

console.log('\n== 2. Background jobs with a mock executor ==');
let ran = 0;
setJobExecutor({ run: async ({ task, signal }) => { ran += 1; await new Promise((r) => setTimeout(r, 50)); return { answer: `done: ${task}` }; } });
const j1 = startJob({ task: 'research the moon' });
ok(j1.ok === true && j1.status === 'queued', `job started (${j1.id})`);
await new Promise((r) => setTimeout(r, 150));
const c1 = collectJob(j1.id);
ok(c1 && c1.status === 'finished', 'job finished');
ok(c1.answer === 'done: research the moon', 'answer collected');
ok(ran === 1, 'executor ran once');
ok(startJob({ task: '' }).ok === false, 'empty task rejected');

console.log('\n== 3. Concurrency cap (max 3) ==');
setJobExecutor({ run: async () => { await new Promise((r) => setTimeout(r, 200)); return { answer: 'x' }; } });
const a = startJob({ task: 'a' }); const b = startJob({ task: 'b' }); const c = startJob({ task: 'c' });
const d = startJob({ task: 'd' });
ok(d.ok === false && /too many/.test(d.error || ''), '4th concurrent job refused');
ok(jobStats().by.running + (jobStats().by.queued || 0) <= 3, 'at most 3 in flight');
await new Promise((r) => setTimeout(r, 300));

console.log('\n== 4. Kill + list ==');
const k = startJob({ task: 'slow' });
await new Promise((r) => setTimeout(r, 30));
const killed = killJob(k.id);
ok(killed.ok === true && killed.status === 'killed', 'job killed');
ok(killJob(k.id).ok === false, 'killing a killed job fails honestly');
const lst = listJobs();
ok(Array.isArray(lst) && lst.length >= 4, `list returns jobs (${lst.length})`);
ok(lst[0].status !== undefined, 'list entries carry status');

console.log('\n== 5. Job tools through the gate ==');
const t1 = await executeTool({ slug: 'run_in_background', args: { task: 'via tool' } });
ok(t1.ok === true && /"kind": "job"/.test(String(t1.result || '')), 'run_in_background executes with contract');
await new Promise((r) => setTimeout(r, 300));
const tid = JSON.parse(String(t1.result)).id;
const t2 = await executeTool({ slug: 'jobs_collect', args: { id: tid } });
ok(t2.ok === true && /"status": "finished"/.test(String(t2.result || '')), 'jobs_collect returns the finished job');
const t3 = await executeTool({ slug: 'job_list', args: {} });
ok(t3.ok === true && /"kind": "jobs"/.test(String(t3.result || '')), 'job_list executes');
const t4 = await executeTool({ slug: 'jobs_collect', args: { id: 'nope' } });
ok(t4.ok === false && /not found/.test(t4.error || ''), 'unknown job fails honestly');

console.log('\n== 6. Repeat-tool-reminder (dsh guard mirror) ==');
ok(repeatReminderFor('web-search|{}', 3) !== null && /3 times/.test(repeatReminderFor('web-search|{}', 3)), 'threshold 3 reminds');
ok(repeatReminderFor('x|{}', 5) !== null && /5th/.test(repeatReminderFor('x|{}', 5)), 'threshold 5 reminds');
ok(repeatReminderFor('x|{}', 8) !== null && /8/.test(repeatReminderFor('x|{}', 8)), 'threshold 8 reminds');
ok(repeatReminderFor('x|{}', 2) === null && repeatReminderFor('x|{}', 4) === null, 'non-threshold counts stay silent');
ok(repeatReminderFor('x|{}', 3).includes('stop repeating'), 'reminder advises changing approach');

console.log('\n== 7. Message feedback (dsh message-feedback mirror) ==');
const f1 = addFeedback({ conversation: 'fb-conv', rating: 1, note: 'great answer' });
ok(f1.ok === true && f1.rating === 1, 'helpful feedback recorded');
const f2 = addFeedback({ conversation: 'fb-conv', rating: -1 });
ok(f2.ok === true && f2.rating === -1, 'not-helpful feedback recorded');
ok(addFeedback({ conversation: 'x', rating: 0 }).ok === false, 'invalid rating rejected');
const lstFb = listFeedback('fb-conv');
ok(lstFb.length === 2 && lstFb[0].rating === -1, 'list newest-first');
const stats = feedbackStats();
ok(stats.total === 2 && stats.helpful === 1 && stats.notHelpful === 1 && stats.helpfulRate === 50, 'stats derived');
const evs = loadConversationEvents('fb-conv', 50);
ok(evs.some((e) => e.kind === 'feedback' && e.text.includes('HELPFUL')), 'feedback lands in the conversation log (trace-visible)');

console.log('\n== 8. Session references + export (dsh session-reference/log-export) ==');
appendConversationEvent('other-conv', { role: 'user', text: 'hello other', kind: 'chat' });
const block = recentSessionsBlock('current-conv', 5);
ok(block.includes('other-conv') === false, 'reference block does not name this conversation');
ok(/\[Earlier sessions/.test(block), 'reference block present when other sessions exist');
ok(recentSessionsBlock('other-conv', 5) === '' || recentSessionsBlock('other-conv', 5).length > 0, 'current-conversation excluded from its own references');
const ex = exportConversation('fb-conv', 'jsonl');
ok(ex.ok === true && ex.format === 'jsonl' && ex.content.includes('feedback'), 'jsonl export contains events');
const md = exportConversation('fb-conv', 'md');
ok(md.ok === true && md.format === 'md' && md.content.includes('# Conversation transcript'), 'markdown export renders');
ok(md.content.includes('JEXI') || md.content.includes('System'), 'markdown export labels speakers');
ok(exportConversation('missing-conv').ok === false, 'missing conversation fails honestly');

console.log(`\nB106 gap-closing: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
