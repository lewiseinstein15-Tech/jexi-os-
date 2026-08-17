/**
 * B119 — FULL LIFECYCLE PARITY suite (DeepSeek Harness
 * agent-loop/session/system-prompt mirror).
 *
 * Proves: the DSH session-event vocabulary lands in the conversation log in
 * order (turn/start → step/start → tool/call → tool/result → step/end →
 * turn/end), lifecycle events are excluded from counts/titles, and prompt
 * assembly composes DSH-style ordered sections (time, session references,
 * skill catalog, todo/plan/goal state, SDK, flavor, preferences, policy)
 * without duplication.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-lc-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const {
  lifecycleTurnStart, lifecycleStepStart, lifecycleToolCall, lifecycleToolResult,
  lifecycleStepEnd, lifecycleTurnEnd, lifecycleUserMessage, lifecycleAssistantMessage, isLifecycleEvent,
} = await import('./src/services/SessionLifecycle.js');
const { assemblePrompt, todoStateBlock, planStateBlock, goalStateBlock, setGoalEngine } = await import('./src/services/PromptAssembly.js');
const { appendConversationEvent, loadConversationEvents, conversationSummary } = await import('./src/services/SessionConversations.js');
const { todoAdd, todoClear } = await import('./src/services/TodoStore.js');
const { planSet } = await import('./src/services/PlanStore.js');

const CONV = 'lifecycle-conv';

console.log('\n== 1. DSH session-event vocabulary in order ==');
lifecycleTurnStart(CONV, 1);
lifecycleUserMessage(CONV, 1, 'hello');
lifecycleStepStart(CONV, 1, 1);
lifecycleToolCall(CONV, 1, 1, 'call-1', 'web-search', { query: 'x' });
lifecycleToolResult(CONV, 1, 1, 'call-1', 'web-search', true, null, 812);
lifecycleStepEnd(CONV, 1, 1);
lifecycleAssistantMessage(CONV, 1, 1, 'the answer', { toolCalls: 1 });
lifecycleTurnEnd(CONV, 1, 'completed');
const evs = loadConversationEvents(CONV, 200);
const kinds = evs.map((e) => e.kind);
ok(kinds[0] === 'turn/start', 'first event is turn/start (DSH order)');
ok(kinds[1] === 'user/message', 'then user/message');
ok(kinds[2] === 'step/start', 'then step/start');
ok(kinds[3] === 'tool/call', 'then tool/call');
ok(kinds[4] === 'tool/result', 'then tool/result');
ok(kinds[5] === 'step/end', 'then step/end');
ok(kinds[6] === 'assistant/message', 'then assistant/message');
ok(kinds[7] === 'turn/end', 'then turn/end');
const tc = evs.find((e) => e.kind === 'tool/call');
ok(tc.meta && tc.meta.callId === 'call-1' && tc.meta.name === 'web-search', 'tool/call carries callId + name (DSH tool/call contract)');
const tr = evs.find((e) => e.kind === 'tool/result');
ok(tr.meta && tr.meta.ok === true && tr.meta.durationMs === 812, 'tool/result cites ok + duration (DSH tool/result contract)');
const te = evs.find((e) => e.kind === 'turn/end');
ok(te.meta && te.meta.reason === 'completed', 'turn/end carries the reason (DSH turn/end)');
ok(isLifecycleEvent(tc) && isLifecycleEvent(te), 'isLifecycleEvent detects markers');

console.log('\n== 2. Lifecycle events excluded from counts/titles ==');
const sum = conversationSummary(CONV);
ok(sum.messageCount === 0, `messageCount excludes lifecycle events (${sum.messageCount})`);
appendConversationEvent(CONV, { role: 'user', text: 'real question about the moon', kind: 'chat' });
appendConversationEvent(CONV, { role: 'jexi', text: 'real answer', kind: 'chat' });
const sum2 = conversationSummary(CONV);
ok(sum2.messageCount === 2, `messageCount counts only chat events (${sum2.messageCount})`);
ok(sum2.title.includes('real question'), 'title comes from the real user message, not lifecycle noise');

console.log('\n== 3. Prompt assembly — DSH ordered sections ==');
// Seed another conversation (session references) + a user skill (catalog).
appendConversationEvent('other-lifecycle', { role: 'user', text: 'the moon landing archives', kind: 'chat' });
const { createUserSkill } = await import('./src/services/SkillDiscovery.js');
createUserSkill({ name: 'test-skill', description: 'A test skill for the assembly suite with enough length.', body: '# Test Skill\n\nInstructions for the test skill body with plenty of words.' });
const assembled = await assemblePrompt({ convId: CONV, codeMode: true, codeTools: [{ slug: 'todo', name: 'Todo', desc: 'todo list' }], presetFlavor: 'CREATOR FLAVOR', planMode: true });
ok(assembled.includes('You are **JEXI OS**'), 'persona/identity section present');
ok(assembled.includes('Current date and time:'), 'time-context section present');
ok(/Earlier sessions/.test(assembled), 'session-references section present (other conversations listed)');
ok(assembled.includes('## Available skills') && assembled.includes('test-skill'), 'skill catalog section present with the discovered skill');
ok(assembled.includes('## Writing code for run_code'), 'code-mode SDK section present');
ok(assembled.includes('CREATOR FLAVOR'), 'preset flavor section present');
ok(assembled.includes('## PLAN MODE'), 'plan-mode policy section present');
ok((assembled.match(/Current date and time:/g) || []).length === 1, 'time context NOT duplicated');
ok((assembled.match(/You are \*\*JEXI OS\*\*/g) || []).length === 1, 'persona not duplicated');

console.log('\n== 4. Live-state sections (todo/plan/goal — dsh injection) ==');
todoAdd('build the calculator');
todoAdd('test it');
const todo = todoStateBlock();
ok(todo.includes('## Current todo list') && todo.includes('build the calculator'), 'todo state renders into the prompt');
planSet('Ship the app', ['Scaffold', 'Build']);
const plan = planStateBlock();
ok(plan.includes('## Current plan') && plan.includes('Ship the app') && plan.includes('Scaffold'), 'plan state renders with title + steps');
class FakeGoals { listGoals() { return [{ query: 'research AI', status: 'active', createdAt: Date.now() }]; } }
setGoalEngine(new FakeGoals());
const goal = goalStateBlock();
ok(goal.includes('## Active goals') && goal.includes('research AI'), 'goal state renders (dsh goal section)');
setGoalEngine(null);
ok(goalStateBlock() === '', 'no engine → empty goal block (safe)');
const assembledState = await assemblePrompt({ convId: CONV, includeSkills: false });
ok(assembledState.includes('## Current todo list'), 'assembly includes todo state by default');
ok(!assembledState.includes('## Available skills'), 'includeSkills=false drops the catalog');

console.log('\n== 5. AgentLoop uses the assembly + lifecycle ==');
const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');
ok(al.includes("assemblePrompt({"), 'AgentLoop assembles prompts via PromptAssembly');
ok(al.includes('lifecycleTurnStart') && al.includes('lifecycleToolCall') && al.includes('lifecycleTurnEnd'), 'AgentLoop writes lifecycle events');
const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');
ok(st.includes("assemblePrompt({"), 'SimpleTask assembles prompts via PromptAssembly');
const idx = fs.readFileSync('./index.js', 'utf-8');
ok(idx.includes('setGoalEngine(goalEngine)'), 'index wires the goal engine into assembly');
ok(idx.includes('lifecycleUserMessage'), 'chat route writes the user/message lifecycle event');

console.log(`\nB119 lifecycle-parity: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
