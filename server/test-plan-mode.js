/**
 * B110 — PLAN MODE + ASK USER regression suite
 * (deepseek-harness plan-mode + tool-ask-user/user-questions mirror).
 *
 * Proves: plan-mode state is log-backed and last-wins, the policy section
 * appends only while active, exit_plan_mode presents a plan for review
 * (pending_review → approve), /plan on|off semantics, ask_user_question
 * parks questions per conversation, answers record + inject into the next
 * turn, clearing works, and both tools execute through the gated runtime
 * with output contracts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-pm-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { isPlanMode, setPlanMode, planModePromptSection, presentPlan, approvePlan, currentPlan, PLAN_POLICY_SECTION } = await import('./src/services/PlanMode.js');
const { askQuestions, getPending, answerPending, takeAnswers, clearPending, formatAnswers } = await import('./src/services/PendingQuestions.js');
const { appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { TOOL_COUNT, TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');
const { planGet } = await import('./src/services/PlanStore.js');

console.log('\n== 1. Registry: the two new tools ==');
ok(TOOL_COUNT === 193, `registry count 191 → 193 (${TOOL_COUNT})`);
ok(TOOL_REGISTRY.some((t) => t.slug === 'ask_user_question'), 'ask_user_question registered');
ok(TOOL_REGISTRY.some((t) => t.slug === 'exit_plan_mode'), 'exit_plan_mode registered');

console.log('\n== 2. Plan mode: log-backed state, last wins (dsh plan/mode) ==');
ok(isPlanMode('pm-conv') === false, 'inactive by default');
setPlanMode('pm-conv', true);
ok(isPlanMode('pm-conv') === true, 'turns on');
const evs = loadConversationEvents('pm-conv', 50);
ok(evs.some((e) => e.kind === 'plan/mode' && e.text.includes('ON')), 'plan/mode event logged (dsh log-backed)');
setPlanMode('pm-conv', false);
ok(isPlanMode('pm-conv') === false, 'last one wins → off');
ok(planModePromptSection('pm-conv') === '', 'no policy section when off');
setPlanMode('pm-conv', true);
const section = planModePromptSection('pm-conv');
ok(section.includes('PLAN MODE') && section.includes('exit_plan_mode'), 'policy section present while active');
ok(section.includes(PLAN_POLICY_SECTION), 'section is the DSH plan:policy guidance');

console.log('\n== 3. exit_plan_mode presents a plan for review ==');
const conv = 'pm-conv';
const p = presentPlan(conv, '# Build the calculator\n\n1. Scaffold the app\n2. Implement add/subtract\n3. Test it\n4. Ship it');
ok(p.ok === true && p.kind === 'plan-review' && p.status === 'pending_review', 'plan presented as pending_review');
ok(p.plan.includes('Build the calculator'), 'plan markdown carried');
const stored = planGet();
ok(stored && stored.title === 'Build the calculator' && Array.isArray(stored.steps) && stored.steps.length === 4, 'plan stored with title + steps');
ok(currentPlan(conv) && currentPlan(conv).status === 'pending_review', 'plan is pending review');
ok(presentPlan(conv, 'too short').ok === false, 'too-short plan rejected');
const ap = approvePlan(conv);
ok(ap.approved === true && currentPlan(conv).status === 'approved', 'approval flips the plan to approved');

console.log('\n== 4. ask_user_question parks questions (dsh user-questions) ==');
const aq = askQuestions('ask-conv', [
  { id: 'mode', question: 'Which mode do you want?', header: 'Choose Mode', options: [{ label: 'Fast (Recommended)', description: 'Quickest result' }, { label: 'Deep' }] },
  { id: 'color', question: 'What color?', multi_select: true, options: [{ label: 'Red' }, { label: 'Blue' }] },
]);
ok(aq.ok === true && aq.questions.length === 2, 'questions parked');
ok(aq.questions[0].id === 'mode' && aq.questions[0].header === 'Choose Mode', 'id + header preserved');
ok(aq.questions[0].options.length === 2 && aq.questions[0].multiSelect === false, 'options + multiSelect mapped (dsh snake→camel)');
ok(aq.questions[1].multiSelect === true, 'multi_select mapped to multiSelect');
ok(askQuestions('ask-conv', []).ok === false, 'empty questions rejected');
const pend = getPending('ask-conv');
ok(pend && pend.questions.length === 2, 'pending retrievable');
ok(getPending('other-conv') === null, 'no pending for other conversations');

console.log('\n== 5. Answers record + inject into the next turn ==');
const ans = answerPending('ask-conv', [{ id: 'mode', selected: ['Fast (Recommended)'] }, { id: 'color', selected: ['Red'], custom: 'also teal' }]);
ok(ans.ok === true && ans.answers.length === 2, 'answers recorded');
ok(ans.answers[0].selected[0] === 'Fast (Recommended)', 'option selection kept');
ok(ans.answers[1].custom === 'also teal', 'custom text kept');
ok(getPending('ask-conv') === null, 'pending clears once answered (dsh: answer consumes)');
ok(answerPending('ask-conv', []).ok === false, 'answering with nothing pending fails honestly');
const injected = formatAnswers(ans.answers);
ok(injected.includes('Fast (Recommended)') && injected.includes('also teal'), 'answers render as injected context');
ok(injected.includes('[User answers to your pending questions:'), 'injection wrapper present');
// takeAnswers is one-shot
askQuestions('ask-conv', [{ id: 'q1', question: 'One more?' }]);
answerPending('ask-conv', [{ id: 'q1', selected: ['yes'] }]);
ok(takeAnswers('ask-conv') !== null, 'takeAnswers returns recorded answers');
ok(takeAnswers('ask-conv') === null, 'takeAnswers is one-shot (injected once)');
clearPending('ask-conv');
ok(getPending('ask-conv') === null, 'clearPending removes parked questions');

console.log('\n== 6. Tools through the gated runtime with contracts ==');
const t1 = await executeTool({ slug: 'ask_user_question', args: { questions: [{ id: 'x', question: 'Proceed?' }] } });
ok(t1.ok === true && /"kind": "ask-user"/.test(String(t1.result || '')), 'ask_user_question executes with kind=ask-user');
const t2 = await executeTool({ slug: 'exit_plan_mode', args: { plan: '# Plan\n\n1. Step one\n2. Step two' } });
ok(t2.ok === true && /"kind": "plan-review"/.test(String(t2.result || '')), 'exit_plan_mode executes with kind=plan-review');
ok(currentPlan('default') !== null, 'plan stored for the default session');
const t3 = await executeTool({ slug: 'exit_plan_mode', args: { plan: 'short' } });
ok(t3.ok === false, 'too-short plan fails honestly through the gate');

console.log(`\nB110 plan-mode+ask-user: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
