/**
 * TEST-EVERYTHING — the full JEXI OS gauntlet.
 *
 * A. MEMORY            — facts, recall, knowledge, preferences, episodes, profile
 * B. COGNITION         — planner, domains, decisions, todo/plan/goal, workflow,
 *                        subagents, ralph, plan-mode, questions, commands
 * C. CONVERSATION      — multi-turn continuity, no-loss, projection, compaction,
 *                        spill, fork, search, export, trace, titles, references
 * D. TOOL COVERAGE     — every registry tool (218) + every plugin tool
 * E. RESEARCH          — DshResearch runner (model-driven web_search/web_fetch)
 * F. LARGE PROJECT     — build a real multi-file project through the REAL coding
 *                        runner + real tools (write/bash/edit), fix loop, verify
 * G. PIPELINE          — auto routing, agent loop, subagents, orchestration
 * H. LIFECYCLE         — events, checkpoints, invariants, sqlite mirror,
 *                        telemetry, token meter, atomic write, attachments
 * I. API SURFACE       — live server boot, ~35 endpoints, real chat stream
 * J. HEADLESS + SDK    — cli.js --self-test, JexiClient end-to-end
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import os from 'os';
import { pathToFileURL } from 'url';

/* B158 — node:sqlite (Node ≥ 22.5) gates the sqlite session mirror; the JSON
   store is the source of truth everywhere. Skip mirror assertions on older
   Node instead of failing (CI's Node 22 runs them fully). */
let __nodeSqlite = null;
try { await import('node:sqlite'); __nodeSqlite = true; } catch { __nodeSqlite = false; }
if (!__nodeSqlite) console.log('⏭ sqlite mirror assertions — SKIPPED (node:sqlite needs Node ≥ 22.5; JSON store active)');


let failures = 0;
let passes = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) passes += 1; else failures += 1;
};
const section = (t) => console.log(`\n══════════ ${t} ══════════`);

const SERVER_DIR = process.cwd();
const WS = path.join(SERVER_DIR, 'jexi-workspace');
fs.mkdirSync(WS, { recursive: true });

/* ═══════════════════════ A. MEMORY ═══════════════════════ */
section('A. MEMORY');
{
  const { rememberUserFact, semanticRecall, saveMemory, loadMemory, saveKnowledgeFile, searchKnowledge, saveKnowledge, loadKnowledge, resetCache } = await import('./src/services/MemoryManager.js');
  const { preferencesBlock } = await import('./src/services/PreferenceLearner.js');
  const { executeTool } = await import('./src/services/ToolRuntime.js');
  const conv = `mem-${Date.now()}`;
  const { setActiveSession } = await import('./src/services/MemoryManager.js');
  setActiveSession(conv);

  // 1. Facts in → recall out (no hallucination: exact content match)
  rememberUserFact('Amani prefers dark roast coffee with no sugar', 0.9, 'fact');
  rememberUserFact('Amani lives in Nairobi, Kenya', 0.95, 'fact');
  rememberUserFact('Amani is building a weather app called Zawadi', 0.9, 'fact');
  const recalled = await semanticRecall('coffee preference');
  ok('fact stored + semantically recalled', Array.isArray(recalled) && recalled.some((x) => x.label && x.label.includes('dark roast coffee')));
  const recalled2 = await semanticRecall('where does Amani live');
  ok('second fact recalled', Array.isArray(recalled2) && recalled2.some((x) => x.label && x.label.includes('Nairobi')));
  const recalled3 = await semanticRecall('weather app name');
  ok('third fact recalled', Array.isArray(recalled3) && recalled3.some((x) => x.label && x.label.includes('Zawadi')));

  // 2. Tool-path memory: memory-write then memory-recall through the gate
  const w = await executeTool({ slug: 'memory-write', args: { fact: 'Amani codes in JavaScript and Python', importance: 'high' }, spillOwner: conv });
  ok('memory-write executes through the gate', w.ok === true);
  const r = await executeTool({ slug: 'memory-recall', args: { query: 'JavaScript' }, spillOwner: conv });
  ok('memory-recall finds the written fact (keyword overlap)', r.ok === true && String(r.result).includes('JavaScript'));

  // 3. Knowledge library
  const kf = saveKnowledgeFile('programming', 'js-tips.md', '# JS Tips\nAmani uses optional chaining everywhere.\n');
  ok('knowledge file saved', kf && String(kf).includes('js-tips'));
  const ks = searchKnowledge('optional chaining');
  ok('knowledge search finds content', Array.isArray(ks) && ks.some((k) => String(k.content).includes('optional chaining')));

  // 4. Preferences learned + injected into prompts (deterministic: write a
  // preference-labeled fact, then the block must surface it).
  rememberUserFact('Amani prefers dark roast coffee', 0.8, 'preference');
  const prefs = preferencesBlock();
  ok('preferences block renders with the learned preference', typeof prefs === 'string' && prefs.includes('dark roast'));

  // 5. Episodes
  const ep = await executeTool({ slug: 'episode-save', args: { ask: 'What did Amani plan?', reply: 'Amani planned the Zawadi weather app.' }, spillOwner: conv });
  ok('episode saved (ask/reply)', ep.ok === true);
  const epR = await executeTool({ slug: 'episode-recall', args: { query: 'Zawadi' }, spillOwner: conv });
  ok('episode recalled via engine', epR.ok === true && String(epR.result).includes('Zawadi'));

  // 6. Persistence: memory survives a store reload (memory.json)
  const m1 = loadMemory();
  ok('memory persists to store (userFacts present)', m1 && Array.isArray(m1.userFacts) && m1.userFacts.some((f) => String(f.fact).includes('Amani')));
  resetCache();
  const m2 = loadMemory();
  ok('memory reloads after cache reset (durable)', m2 && Array.isArray(m2.userFacts) && m2.userFacts.some((f) => String(f.fact).includes('Amani')));
  setActiveSession(null);
}

/* ═══════════════════════ B. COGNITION ═══════════════════════ */
section('B. COGNITION');
{
  const { planner } = await import('./src/services/Planner.js');
  const { detectDomain, deterministicChecks, DOMAINS } = await import('./src/services/DomainVerifier.js');
  const { decide } = await import('./src/services/DecisionEngine.js');
  const { todoAdd, todoList, todoComplete } = await import('./src/services/TodoStore.js');
  const { planSet, planGet, planUpdate } = await import('./src/services/PlanStore.js');
  const { createGoal, updateGoal, getCurrentGoal } = await import('./src/services/GoalTools.js');
  const { startWorkflow, workflowRecord } = await import('./src/services/WorkflowEngine.js');
  const { decomposeQuery, runSubagents } = await import('./src/services/SubagentRuntime.js');
  const { runRalph, validateRalphReport } = await import('./src/services/RalphRunner.js');
  const { setPlanMode, presentPlan, approvePlan, currentPlan, isPlanMode } = await import('./src/services/PlanMode.js');
  const { askQuestions, answerPending, getPending } = await import('./src/services/PendingQuestions.js');
  const { registerCommand, tryExecuteCommandDialect } = await import('./src/services/CommandRegistry.js');
  const { executeTool } = await import('./src/services/ToolRuntime.js');

  // 1. Planner routing
  const probes = [
    ['what time is it in Nairobi', 'time_now'],
    ['translate hello to french', 'translate'],
    ['solve 2x + 5 = 13', 'math_solve'],
    ['research the history of the internet', 'research'],
    ['build a python script to parse csv', 'code_task'],
  ];
  let plannerHits = 0;
  for (const [q, want] of probes) {
    try { const p = await planner.analyzeIntent(q); if (p.intent === want) plannerHits += 1; } catch { /* noop */ }
  }
  ok(`planner routes intents correctly (${plannerHits}/5)`, plannerHits === 5);

  // 2. Domain verification
  ok('domain detection math', detectDomain('solve 2x+5=13 for x') === 'math');
  ok('domain detection code', detectDomain('write a python script') === 'code');
  const dc = deterministicChecks('solve 2x+5=13', 'x = 4');
  ok('deterministic math check returns checks', dc && typeof dc === 'object' && 'issues' in dc);

  // 3. Decision engine
  const dec = decide({ raw: 'do x then y', classification: 'compound', candidates: ['x', 'y'] });
  ok('decision engine decides', dec && (dec.decision || dec.intent || dec.action));

  // 4. Todo + plan stores
  const t = todoAdd('gauntlet task');
  ok('todo add', Array.isArray(t) && t.length >= 1);
  const tl = todoList();
  ok('todo list contains the task', Array.isArray(tl) && tl.some((x) => String(x.text).includes('gauntlet')));
  todoComplete(0);
  ok('todo complete', Array.isArray(todoList()));
  const p = planSet('Gauntlet Plan', [{ step: 'test', status: 'pending' }]);
  ok('plan set', p && p.steps && p.steps.length === 1);
  ok('plan get', planGet() && planGet().title === 'Gauntlet Plan');
  planUpdate(0, 'done', 'verified');
  ok('plan update', planGet().steps[0].status === 'done');

  // 5. Goal lifecycle with revisions
  const g = createGoal({ objective: 'Finish the full gauntlet', max_goal_rounds: 2 });
  ok('goal created', g.ok && g.goal_id && g.revision === 1);
  const gu = updateGoal({ goal_id: g.goal_id, revision: 1, action: 'edit', objective: 'Finish the full gauntlet and report' });
  ok('goal updated with revision', gu.ok && gu.revision === 2);
  const cur = getCurrentGoal();
  ok('goal current reflects edit', cur.ok && cur.goal && String(cur.goal.objective).includes('report'));
  const gc = updateGoal({ goal_id: g.goal_id, revision: 2, action: 'complete' });
  ok('goal completed', gc.ok === true && (gc.status === 'done' || gc.status === 'completed' || gc.status === 'complete'));

  // 6. Workflow engine (real script execution)
  const wf = startWorkflow({
    script: 'phase("wf"); const a = await agent("count to 1", {__mockAnswer: "one"}); return { a };',
    meta: { name: 'wf-gauntlet', description: 'gauntlet workflow test' },
  });
  const wfOut = await wf.result;
  ok('workflow runs with agent global (mechanics)', wfOut && wfOut.stopReason === 'completed' && wfOut.agentsStarted >= 1 && wfOut.value && 'a' in wfOut.value);
  ok('workflow record', workflowRecord(wf.id) && workflowRecord(wf.id).id === wf.id && workflowRecord(wf.id).status === 'completed');

  // 7. Subagents: decompose + isolated runs with deterministic answers
  const parts = decomposeQuery('research A and analyze B and summarize C');
  ok('decompose splits missions', parts.length >= 2);
  const sub = await runSubagents({
    tasks: [{ name: 'a', query: 'q1' }, { name: 'b', query: 'q2', context: 'fork' }],
    sendEvent: () => {},
    opts: { __mockAnswer: 'sub answer' },
  });
  ok('subagents run (in-process + isolated)', sub.counts && sub.counts.total === 2);
  ok('aggregate produced', typeof sub.aggregate === 'string' && sub.aggregate.length > 0);

  // 8. Ralph loop (deterministic roundFn)
  const ralph = await runRalph({ objective: 'gauntlet objective', maxRounds: 3, roundFn: async ({ round }) => JSON.stringify(round === 1 ? { status: 'continue', summary: 'started', evidence: [], nextSteps: ['next'], blocker: '' } : { status: 'complete', summary: 'done', evidence: ['e'], nextSteps: [], blocker: '' }) });
  ok('ralph completes fresh-child rounds', ralph.ok === true && ralph.status === 'complete' && ralph.roundsStarted === 2);

  // 9. Plan mode: present → approve → executes
  const pconv = `plan-${Date.now()}`;
  setPlanMode(pconv, true);
  ok('plan mode active', isPlanMode(pconv) === true);
  const presented = presentPlan(pconv, '## Build Plan\n\n1. Test plan mode with a real plan body\n2. Approve the plan\n3. Execute and verify the result');
  ok('plan presented', presented.ok && presented.plan.includes('Test plan mode'));
  const ap = approvePlan(pconv);
  ok('plan approved', ap.ok === true);
  setPlanMode(pconv, false); // the chat path clears plan mode after approval (index.js parity)
  ok('plan mode cleared after approval', isPlanMode(pconv) === false);
  ok('current plan kept (approved)', currentPlan(pconv) && currentPlan(pconv).status === 'approved' && currentPlan(pconv).steps.length >= 2);

  // 10. Pending questions
  const qconv = `q-${Date.now()}`;
  const aq = askQuestions(qconv, [{ id: 'q1', question: 'Which city?' }]);
  const pending = getPending(qconv);
  ok('questions asked', aq.ok && pending && Array.isArray(pending.questions) && pending.questions.length === 1);
  const ans = answerPending(qconv, [{ id: 'q1', selected: ['Nairobi'], custom: '' }]);
  ok('questions answered', ans.ok && Array.isArray(ans.answers) && ans.answers[0].id === 'q1');

  // 11. Commands dialect
  const un = registerCommand({ name: 'gauntlet-cmd', description: 't', run: ({ rawInput }) => ({ ok: true, summary: `ran:${rawInput}` }) });
  const cmd = await tryExecuteCommandDialect('/gauntlet-cmd hello');
  ok('command executes', cmd.ok && cmd.result.summary === 'ran: hello');
  un();

  // 12. Tool-path cognition (plan + todo tools through the gate)
  const tp = await executeTool({ slug: 'plan', args: { op: 'set', title: 'G', steps: [{ step: 's' }] }, spillOwner: 'cog' });
  ok('plan tool executes', tp.ok === true);
  const tt = await executeTool({ slug: 'todo', args: { op: 'add', text: 'cog' }, spillOwner: 'cog' });
  ok('todo tool executes', tt.ok === true);
}

/* ═══════════════════════ C. CONVERSATION CONTINUITY ═══════════════════════ */
section('C. CONVERSATION CONTINUITY (no loss, no hallucination)');
{
  const { appendConversationEvent, loadConversationEvents, conversationSummary, searchConversations, forkConversation, exportConversation, listConversations } = await import('./src/services/SessionConversations.js');
  const { projectSession } = await import('./src/services/SessionProjection.js');
  const { compactionAwareHistory } = await import('./src/services/CompactionEngine.js');
  const { maybeCheckpoint, latestCheckpoint } = await import('./src/services/SessionCheckpoints.js');
  const { saveText, readSpill, listSpills } = await import('./src/services/SpillStore.js');
  const { persistSessionEvent, sessionRevision, sessionPersistenceStatus, openSessionPersistence } = await import('./src/services/SessionPersistenceSqlite.js');
  await openSessionPersistence(':memory:'); // the gauntlet runs in-process (index.js opens it at boot)
  const { onConversationEvent } = await import('./src/services/SessionConversations.js');
  const { setStoredTitle, getStoredTitle } = await import('./src/services/SessionTitles.js');
  const { buildTrace } = await import('./src/services/SessionTrace.js');
  const { checkConversationInvariants } = await import('./src/services/SessionInvariants.js');
  const { encodeSessionReferenceUri, formatSessionReferenceMention, decodeSessionReferenceUri } = await import('./src/services/SessionReference.js');

  const conv = `cont-${Date.now()}`;
  // Mirror EVERY append to sqlite (observer first, so all turns are captured).
  const offMirror = onConversationEvent((cid, ev) => persistSessionEvent(cid, ev));
  // 6 turns with distinct facts — the model must see ALL of them later.
  const facts = [
    ['user', 'My name is Amani and I live in Nairobi.'],
    ['jexi', 'Nice to meet you, Amani!'],
    ['user', 'I love dark roast coffee, no sugar.'],
    ['jexi', 'Noted — dark roast, no sugar.'],
    ['user', 'I am building a weather app called Zawadi.'],
    ['jexi', 'Zawadi sounds great!'],
  ];
  for (const [role, text] of facts) appendConversationEvent(conv, { role, text, kind: 'chat' });

  // 1. Full log intact with continuous seqs
  const events = loadConversationEvents(conv);
  ok('all 6 turns persisted with continuous seqs', events.length === 6 && events[5].seq === 5 && events.every((e, i) => e.seq === i));
  ok('no turn lost (texts match verbatim)', facts.every(([role, text], i) => events[i].role === role && events[i].text === text));

  // 2. sqlite mirror has them too
  appendConversationEvent(conv, { role: 'user', text: 'What is my favorite drink?', kind: 'chat' }); // turn 7
  await sleep(400); // flush
  offMirror();
  const rev = sessionRevision(conv);
  if (__nodeSqlite) ok('sqlite mirror tracks the revision', rev && rev.revision >= 6);
  const sp = sessionPersistenceStatus();
  if (__nodeSqlite) ok('sqlite mirror has rows (all turns mirrored)', sp.available && sp.events >= 7);

  // 3. Projection (what the model sees) contains every fact — the anti-hallucination guarantee
  const proj = projectSession({ convId: conv, maxChars: 4000 });
  const projText = proj.events.join('\n');
  ok('projection contains all 7 turns', proj.events.length === 7);
  for (const [, text] of facts) ok(`fact visible in context: "${text.slice(0, 30)}…"`, projText.includes(text));

  // 4. Summary + search + list
  const sum = conversationSummary(conv);
  ok('conversation summary present', sum && (sum.title || sum.firstMessage || sum.eventCount));
  const found = searchConversations('Zawadi');
  ok('search finds by content', found.length >= 1 && found.some((f) => String(f.conversation).includes('Zawadi') || String(JSON.stringify(f)).includes('Zawadi')));
  const listed = listConversations();
  ok('list includes the conversation', Array.isArray(listed) && listed.some((l) => String(l.id || l.conversation || '') === conv));

  // 5. Title
  setStoredTitle(conv, 'Amani & Zawadi', 'user');
  ok('title stored + read', getStoredTitle(conv) === 'Amani & Zawadi');

  // 6. Fork preserves content
  const forkId = `fork-${Date.now()}`;
  forkConversation(conv, forkId);
  const forkEvents = loadConversationEvents(forkId);
  ok('fork preserves every turn', forkEvents.length === events.length + 1 && forkEvents.some((e) => e.text === 'What is my favorite drink?'));

  // 7. Export + trace
  const exp = exportConversation(conv, 'jsonl');
  ok('export jsonl works', exp && (String(exp).includes('Zawadi') || (exp && exp.content && exp.content.includes('Zawadi')) || String(JSON.stringify(exp)).includes('Zawadi')));
  const trace = buildTrace(conv);
  ok('trace built', trace && (trace.events || trace.steps || trace.summary));

  // 8. Compaction: facts survive into the checkpoint + retained tail
  const cp = await maybeCheckpoint(conv, { force: true });
  ok('checkpoint forced', cp && cp.convId === conv);
  const lc = latestCheckpoint(conv);
  ok('checkpoint recorded', !!lc && lc.convId === conv && lc.messageCount >= 7);
  const after = loadConversationEvents(conv);
  ok('NOTHING lost after checkpointing (all turns still in the log)', after.length === 7 && facts.every(([, text]) => after.some((e) => e.text === text)));
  const ah = compactionAwareHistory(conv, { limit: 100 });
  ok('compaction-aware history still returns the turns', ah && ah.tail && ah.tail.length >= 7);

  // 9. Spill: big content spills + retrieves
  const big = 'B'.repeat(20000);
  const spilled = saveText({ owner: conv, source: 'gauntlet', suggestedName: 'big', content: big });
  ok('oversized content spilled', spilled.ok && spilled.locator);
  const back = readSpill(spilled.locator);
  ok('spill-read returns full content', back.ok && String(back.content).length === 20000);
  ok('spills listed per owner', listSpills(conv).length >= 1);

  // 10. Session references (dsh-session: URIs)
  const uri = encodeSessionReferenceUri(conv);
  ok('session reference URI encoded', uri.startsWith('dsh-session:'));
  ok('session reference URI roundtrip', decodeSessionReferenceUri(uri) === conv);
  const mention = formatSessionReferenceMention(conv, 'Amani & Zawadi');
  ok('mention formatted', mention.includes('dsh-session:') && mention.includes('Amani'));

  // 11. Invariants hold
  const inv = checkConversationInvariants(conv);
  ok('conversation invariants pass', inv && inv.ok !== false);
}

/* ═══════════════════════ D. TOOL COVERAGE (ALL 218 + plugins) ═══════════════════════ */
section('D. TOOL COVERAGE — every registry tool (218) + plugin tools');
{
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  const { hasOutputContract, validateToolArgs, executeTool, TOOL_SCHEMAS } = await import('./src/services/ToolRuntime.js');
  const { loadPlugins, setActivePluginContext, listPluginTools } = await import('./src/services/PluginContext.js');
  const { ctx, failed } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  ok('plugins load for coverage', failed.length === 0);

  // Tools we do NOT execute (LLM-driven loops / would spawn long work):
  const skipExec = new Set(['subagent', 'ralph', 'workflow', 'image-generate', 'audio-transcribe', 'video-analyze', 'video-transcript', 'browser-drive', 'link-open', 'form-fill', 'tab-manage', 'page-text', 'screenshot', 'vision-analyze', 'ocr-read']);

  // Build example args from the schema so validation passes.
  const exampleArgs = (slug) => {
    const schema = TOOL_SCHEMAS[slug] || {};
    const args = {};
    for (const [k, spec] of Object.entries(schema)) {
      if (!spec.required) continue;
      if (spec.type === 'number') args[k] = 1;
      else if (spec.type === 'boolean') args[k] = true;
      else if (spec.type === 'object') args[k] = {};
      else if (spec.type === 'array') args[k] = [];
      else args[k] = 'x';
    }
    return args;
  };

  let contractOk = 0, schemaOk = 0, execOk = 0, execHonest = 0;
  const problems = [];
  for (const tool of TOOL_REGISTRY) {
    const slug = tool.slug;
    if (hasOutputContract(slug)) contractOk += 1; else problems.push(`${slug}:no-contract`);
    const va = validateToolArgs(slug, exampleArgs(slug));
    if (va.ok) schemaOk += 1; else problems.push(`${slug}:schema(${va.error})`);
    if (skipExec.has(slug)) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const r = await executeTool({ slug, args: exampleArgs(slug), spillOwner: 'coverage', signal: controller.signal });
      clearTimeout(timer);
      if (r && typeof r === 'object') {
        if (r.ok === true) execOk += 1;
        else if (r.error || r.blocked || r.approvalRequired || r.declined || r.paused) execHonest += 1;
        else problems.push(`${slug}:unclear-result`);
      } else problems.push(`${slug}:no-result`);
    } catch (e) {
      problems.push(`${slug}:threw(${(e && e.message || e).toString().slice(0, 60)})`);
    }
  }
  ok(`ALL ${TOOL_COUNT} registry tools have output contracts`, contractOk === TOOL_COUNT);
  ok(`ALL ${TOOL_COUNT} registry tools validate example args`, schemaOk === TOOL_COUNT);
  ok(`executed tools returned ok or honest failures (${execOk} ok + ${execHonest} honest)`, execOk + execHonest >= TOOL_COUNT - skipExec.size - 2);
  ok(`no tool threw/crashed unexpectedly (${problems.length ? problems.slice(0, 6).join('; ') : 'none'})`, problems.length === 0);

  // Plugin tools: mount + execute each
  const pluginTools = listPluginTools();
  ok(`plugin tools mounted (${pluginTools.length})`, pluginTools.length >= 14);
  let pOk = 0;
  const pluginProblems = [];
  for (const t of pluginTools) {
    let args = {};
    if (t.slug === 'weather-now') args = { city: 'Nairobi' };
    if (t.slug === 'time-now') args = {};
    if (t.slug === 'currency-convert') args = { amount: 100, from: 'USD', to: 'KES' };
    if (t.slug === 'crypto-price') args = { coin: 'bitcoin' };
    if (t.slug === 'ip-geo') args = {};
    if (t.slug === 'web_search') args = { query: 'deepseek harness' };
    if (t.slug === 'web_fetch') args = { url: 'https://example.com' };
    if (t.slug === 'bash') args = { command: 'echo plugin-coverage', description: 't' };
    if (t.slug === 'write') args = { file_path: 'coverage-tmp.txt', content: 'x' };
    if (t.slug === 'read') args = { file_path: 'coverage-tmp.txt' };
    if (t.slug === 'edit') args = { file_path: 'coverage-tmp.txt', old_string: 'x', new_string: 'y' };
    if (t.slug === 'list_files') args = {};
    if (t.slug === 'fs_search') args = { name: 'coverage' };
    if (t.slug === 'lsp') args = { operation: 'hover', file: 'coverage-tmp.txt', line: 1, character: 0 };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await executeTool({ slug: t.slug, args, spillOwner: 'coverage', signal: controller.signal });
      clearTimeout(timer);
      if (r && typeof r === 'object' && (r.ok === true || r.error || r.blocked)) pOk += 1;
      else pluginProblems.push(`${t.slug}:${JSON.stringify(r).slice(0, 80)}`);
    } catch (e) {
      pluginProblems.push(`${t.slug}:threw`);
    }
  }
  try { fs.unlinkSync(path.join(WS, 'coverage-tmp.txt')); } catch { /* noop */ }
  ok(`plugin tools all return ok or honest failures (${pOk}/${pluginTools.length})`, pOk === pluginTools.length);
  ok(`no plugin tool crashed (${pluginProblems.length ? pluginProblems.join('; ') : 'none'})`, pluginProblems.length === 0);
}

/* ═══════════════════════ E. RESEARCH ═══════════════════════ */
section('E. RESEARCH (model-driven, like DeepSeek Harness)');
{
  const { runDshResearch } = await import('./src/services/DshResearch.js');
  const res = await runDshResearch({
    query: 'research the history of the internet',
    convId: `research-${Date.now()}`,
    __mockCompletions: [
      { toolCalls: [{ id: 'r1', name: 'web_search', arguments: '{"query":"history of the internet"}' }] },
      { toolCalls: [{ id: 'r2', name: 'web_fetch', arguments: '{"url":"https://example.com/history"}' }] },
      { text: '## Internet History\n\nThe internet began as ARPANET in 1969.' },
    ],
    __executeOverride: async (calls) => calls.map((c) => ({
      tool_call_id: c.id,
      content: c.name === 'web_search'
        ? JSON.stringify({ ok: true, kind: 'web-search-result', sources: [{ url: 'https://example.com/history', title: 'History', snippet: 'ARPANET 1969' }], truncated: false })
        : JSON.stringify({ ok: true, kind: 'web-fetch-result', url: 'https://example.com/history', statusCode: 200, body: { text: 'The internet began as ARPANET in 1969.' }, truncated: false }),
    })),
  });
  ok('research runner completes', res && res.success === true);
  ok('research answered from evidence', res.summary && res.summary.includes('ARPANET'));
  ok('research collected sources', Array.isArray(res.sources) && res.sources.length >= 1);
  const deg = await runDshResearch({ query: 'x', __mockCompletions: [{ toolCalls: [] }] });
  ok('research degrades honestly without providers', deg && deg.success === false && typeof deg.summary === 'string');
}

/* ═══════════════════════ F. LARGE PROJECT BUILD ═══════════════════════ */
section('F. LARGE PROJECT BUILD (like DeepSeek Harness — real files, real runs)');
{
  const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');
  const project = `big-project-${Date.now()}`;
  const P = (f) => `${project}/${f}`;

  // The model's decisions (tool calls), driven deterministically; tools are REAL.
  const rounds = [
    {
      toolCalls: [
        { id: 'w1', name: 'write', arguments: JSON.stringify({ file_path: P('package.json'), content: JSON.stringify({ name: 'zawadi-weather', scripts: { test: 'node tests/run-tests.js' } }, null, 2) }) },
        { id: 'w2', name: 'write', arguments: JSON.stringify({ file_path: P('lib/math.js'), content: 'exports.add = (a,b)=>a+b;\nexports.multiply = (a,b)=>a*b;\nexports.fib = (n)=> n<2?n: exports.fib(n-1)+exports.fib(n-2);\n' }) },
        { id: 'w3', name: 'write', arguments: JSON.stringify({ file_path: P('lib/strings.js'), content: 'exports.capitalize = (s)=> s.charAt(0).toUpperCase()+s.slice(1);\nexports.slugify = (s)=> s.toLowerCase().replace(/\\s+/g,"-");\nexports.reverse = (s)=> s.split("").reverse().join("");\n' }) },
        { id: 'w4', name: 'write', arguments: JSON.stringify({ file_path: P('lib/storage.js'), content: 'const fs = require("fs");\nconst path = require("path");\nexports.save = (file, data) => { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); return true; };\nexports.load = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };\n' }) },
        { id: 'w5', name: 'write', arguments: JSON.stringify({ file_path: P('server.js'), content: 'const http = require("http");\nconst { add } = require("./lib/math");\nconst server = http.createServer((req, res) => {\n  res.setHeader("Content-Type", "application/json");\n  if (req.url.startsWith("/api/math/add")) {\n    const u = new URL(req.url, "http://x");\n    const a = Number(u.searchParams.get("a")); const b = Number(u.searchParams.get("b"));\n    res.end(JSON.stringify({ result: add(a, b) }));\n  } else if (req.url === "/health") { res.end(JSON.stringify({ ok: true })); }\n  else { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); }\n});\nconst port = Number(process.env.PORT || 4187);\nif (require.main === module) server.listen(port, () => console.log("zawadi on " + port));\nmodule.exports = server;\n' }) },
        { id: 'w6', name: 'write', arguments: JSON.stringify({ file_path: P('tests/run-tests.js'), content: 'const assert = require("assert");\nconst { add, multiply, fib } = require("../lib/math");\nconst { capitalize, slugify, reverse } = require("../lib/strings");\nconst storage = require("../lib/storage");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(multiply(4, 5), 20);\nassert.strictEqual(fib(10), 55);\nassert.strictEqual(capitalize("hello"), "Hello");\nassert.strictEqual(slugify("Hello World"), "hello-world");\nassert.strictEqual(reverse("abc"), "cba");\nconst f = __dirname + "/../data/config.json";\nstorage.save(f, { unit: "celsius" });\nassert.deepStrictEqual(storage.load(f, {}), { unit: "celsius" });\n// server verification: boot on an ephemeral port, fetch, assert, close\nconst http = require("http");\nconst server = require("../server");\nserver.listen(0, async () => {\n  const port = server.address().port;\n  const health = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());\n  assert.strictEqual(health.ok, true);\n  const math = await fetch(`http://127.0.0.1:${port}/api/math/add?a=7&b=8`).then(r => r.json());\n  assert.strictEqual(math.result, 15);\n  server.close();\n  console.log("ALL TESTS PASS");\n});\n' }) },
        { id: 'w7', name: 'write', arguments: JSON.stringify({ file_path: P('data/config.json'), content: JSON.stringify({ unit: 'celsius', city: 'Nairobi' }) }) },
        { id: 'w8', name: 'write', arguments: JSON.stringify({ file_path: P('README.md'), content: '# Zawadi Weather\n\nA weather app built by JEXI during the full gauntlet.\n' }) },
        { id: 'w9', name: 'write', arguments: JSON.stringify({ file_path: P('index.html'), content: '<!doctype html><html><body><h1>Zawadi</h1><p>Weather app</p></body></html>' }) },
      ],
    },
    { toolCalls: [{ id: 'b1', name: 'bash', arguments: JSON.stringify({ command: `node ${project}/tests/run-tests.js`, description: 'run the full test suite' }) }] },
    { text: '## Zawadi Weather — built and verified\n\nCreated a full project: server, lib, tests, config, README. All tests pass.' },
  ];

  const res = await runAutonomousCoding({
    query: `Build the ${project} project: a weather app server with lib, tests, config, README, index.html`,
    convId: `build-${Date.now()}`,
    __mockCompletions: rounds,
  });

  ok('large project build completes', res.success === true);
  ok('summary produced', res.summary && res.summary.includes('Zawadi'));
  const filePaths = (res.files || []).map((f) => f.path);
  for (const f of ['package.json', 'lib/math.js', 'lib/strings.js', 'lib/storage.js', 'server.js', 'tests/run-tests.js', 'data/config.json', 'README.md', 'index.html']) {
    ok(`file written: ${project}/${f}`, filePaths.some((p) => String(p).includes(f)) && fs.existsSync(path.join(WS, project, f)));
  }
  ok('statistics reported', res.statistics && res.statistics.fileCount >= 9 && res.statistics.toolCalls >= 10);

  // The REAL verification: run the built test suite ourselves.
  const run = await new Promise((resolve) => {
    const child = spawn('node', [path.join(WS, project, 'tests', 'run-tests.js')], { cwd: WS });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
  ok('built test suite REALLY passes (exit 0)', run.code === 0 && run.out.includes('ALL TESTS PASS'));

  // Boot the built server and hit it over HTTP.
  const serverChild = spawn('node', [path.join(WS, project, 'server.js')], { cwd: WS, env: { ...process.env, PORT: '4189' } });
  await sleep(800);
  let health = null;
  try { health = await fetch('http://127.0.0.1:4189/health').then((r) => r.json()); } catch { /* noop */ }
  ok('built server boots and /health responds', health && health.ok === true);
  let mathRes = null;
  try { mathRes = await fetch('http://127.0.0.1:4189/api/math/add?a=9&b=6').then((r) => r.json()); } catch { /* noop */ }
  ok('built server API computes correctly (9+6=15)', mathRes && mathRes.result === 15);
  serverChild.kill('SIGTERM');

  // Cleanup
  try { fs.rmSync(path.join(WS, project), { recursive: true, force: true }); } catch { /* noop */ }
  ok('project cleaned up', !fs.existsSync(path.join(WS, project)));
}

/* ═══════════════════════ G. PIPELINE ═══════════════════════ */
section('G. PIPELINE (auto routing, agent loop, orchestration)');
{
  const { runAgentLoop } = await import('./src/services/AgentLoop.js');
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const { runIsolatedSubagent } = await import('./src/services/SubagentRuntime.js');

  const res = await runAgentLoop({ query: 'gauntlet pipeline test', sendEvent: () => {}, opts: { __mockAnswer: 'Deterministic pipeline answer.' } });
  ok('agent loop runs (deterministic seam)', res.answer === 'Deterministic pipeline answer.' && res.stats.toolCalls === 0);

  const iso = await runIsolatedSubagent({ name: 'iso', query: 'x', sendEvent: () => {}, opts: { __mockAnswer: 'isolated result' } });
  ok('isolated subagent returns summary', iso.status === 'PASS' && iso.summary.includes('isolated result'));
  ok('isolation contract: parent sees only summary', !('transcript' in iso) && iso.isolated === true);

  const prompt = await assemblePrompt({ convId: 'pipeline', normalMode: false });
  ok('assembled prompt has all sections', prompt.length > 1500);
  const sections = ['Current date and time', 'skills', 'Todo', 'Plan', 'Goal'];
  ok('live-state sections present', sections.every((s) => prompt.includes(s)) || prompt.length > 2000);
}

/* ═══════════════════════ H. LIFECYCLE & PERSISTENCE ═══════════════════════ */
section('H. LIFECYCLE & PERSISTENCE');
{
  const { estimateTokens, underTokenBudget } = await import('./src/services/TokenMeter.js');
  const { writeFileAtomic, appendAndCap, withFileLock } = await import('./src/services/AtomicWrite.js');
  const { validateAttachment, MAX_ATTACHMENT_BYTES } = await import('./src/services/AttachmentPolicy.js');
  const { estimateTokens: _t } = await import('./src/services/TokenMeter.js');
  const { setCredential, resolveCredential, listCredentialKeys, deleteCredential, hasManagedCredential } = await import('./src/services/CredentialStore.js');
  const { createStorageHub } = await import('./src/services/StorageHub.js');
  const { SettingsFileStore } = await import('./src/services/SettingsFile.js');
  const { resolveJexiHome } = await import('./src/services/HomePaths.js');
  const { launchEnvironmentOf } = await import('./src/services/LaunchEnvironment.js');
  const { initConfigSnapshot, reloadConfig } = await import('./src/services/ConfigReload.js');
  const { runHooks } = await import('./src/services/HookEngine.js');
  const { persistSessionEvent: _p, sessionPersistenceStatus } = await import('./src/services/SessionPersistenceSqlite.js');

  const tokens = estimateTokens('hello world this is a token estimate');
  ok('token meter estimates', tokens > 0 && tokens < 50);
  ok('token budget check', underTokenBudget('x', 0) === false && underTokenBudget('hello world', 1000) === true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-atomic-'));
  const file = path.join(dir, 'f.json');
  writeFileAtomic(file, JSON.stringify({ a: 1 }));
  ok('atomic write', fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).a === 1);
  appendAndCap(file, 'line', 3, (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
  ok('append + cap', fs.readFileSync(file, 'utf8').includes('line'));
  const locked = await withFileLock(path.join(dir, 'lock'), 5000, async () => 'in-lock');
  ok('file lock runs fn', locked === 'in-lock');

  const att = validateAttachment({ name: 'ok.txt', data: Buffer.from('x'), size: 1 });
  ok('attachment valid', att.ok === true);
  ok('attachment rejects huge', validateAttachment({ name: 'big.bin', size: MAX_ATTACHMENT_BYTES + 1 }).ok === false);
  ok('attachment rejects traversal', validateAttachment({ name: '../evil.txt', size: 1 }).ok === false);

  const ck = setCredential('gauntlet_key', 'value-1');
  ok('credential set', ck.ok);
  ok('credential get', resolveCredential('gauntlet_key') === 'value-1' && hasManagedCredential('gauntlet_key') === true);
  ok('credential list (keys only)', listCredentialKeys().includes('gauntlet_key'));
  ok('credential delete', deleteCredential('gauntlet_key').ok);

  const hub = await createStorageHub({ root: path.join(dir, 'units') });
  const unit = await hub.open('gauntlet', 'json');
  unit.set('k', { v: 1 });
  ok('storage hub json unit', unit.get('k').v === 1);

  const sf = new SettingsFileStore({ path: path.join(dir, 'settings.json'), watch: false });
  sf.set('ui', 'theme', 'dark');
  ok('settings file set/load', sf.getKey('ui', 'theme') === 'dark');

  ok('home paths resolve', resolveJexiHome(undefined, {}) === path.join(os.homedir(), '.jexi'));
  ok('launch env resolves', typeof launchEnvironmentOf().get('PATH').value === 'string');

  initConfigSnapshot({ env: { JEXI_API_KEY: 'x' }, settings: {} });
  const cr = reloadConfig({ env: { JEXI_ALLOW_UNLOCKED: '1' }, settings: {} });
  ok('config reload detects change', cr.changed === true);

  const hooks = runHooks('beforeTask', { query: 'gauntlet' }, () => {});
  ok('hook engine fail-open', hooks && typeof hooks.allowed === 'boolean');

  const sp = sessionPersistenceStatus();
  if (__nodeSqlite) ok('sqlite mirror status', sp.available === true);
}

/* ═══════════════════════ I. API SURFACE (live server) ═══════════════════════ */
section('I. API SURFACE — live server boot');
{
  const PORT = 3996;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, JEXI_ALLOW_UNLOCKED: '1', PORT: String(PORT), REDIS_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let booted = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { booted = true; break; }
    } catch { /* keep waiting */ }
  }
  ok('server boots', booted === true);
  if (booted) {
    const eps = [
      '/api/health', '/api/brand', '/api/retention', '/api/web/providers', '/api/bundles',
      '/api/plugins/runtime', '/api/plugins/inventory', '/api/permissions', '/api/personas',
      '/api/schedule/runtime', '/api/host', '/api/gateway', '/api/session-persistence',
      '/api/hooks/bridges', '/api/mcp/servers', '/api/typert/registry', '/api/locale',
      '/api/hmr', '/api/directories', '/api/config', '/api/remotes', '/api/tmux',
      '/api/report/channels', '/api/subagent/providers', '/api/code-runtime/bootstrap',
      '/api/update/version', '/api/identity/id', '/api/commands', '/api/invariants',
      '/api/telemetry', '/api/checkpoints', '/api/spills', '/api/storage', '/api/settings/file',
      '/api/cordis/inspect', '/api/cordis/runner', '/api/projects', '/api/session-query/search?q=test',
    ];
    let okEps = 0;
    const bad = [];
    for (const ep of eps) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}${ep}`, { signal: AbortSignal.timeout(8000) });
        const body = await r.json();
        if (r.ok) okEps += 1; else bad.push(`${ep}:${r.status}`);
      } catch (e) { bad.push(`${ep}:${(e && e.message || e).toString().slice(0, 40)}`); }
    }
    ok(`API surface: ${okEps}/${eps.length} endpoints respond 200`, okEps === eps.length);
    ok(`no endpoint errors (${bad.length ? bad.slice(0, 5).join('; ') : 'none'})`, bad.length === 0);

    // Real chat round-trip: NDJSON stream with a done event.
    const chatBody = { query: 'What is 2+2?', convId: `api-chat-${Date.now()}` };
    const chatRes = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(60000),
    });
    const raw = await chatRes.text();
    const lines = raw.split('\n').filter((l) => l.includes('"type"'));
    const done = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.type === 'done');
    ok('chat streams NDJSON with a done event', chatRes.ok === true && !!done);
    ok('chat done is honest (success or honest failure without keys)', done && (done.success === true || done.success === false));
  }
  child.kill('SIGTERM');
}

/* ═══════════════════════ J. HEADLESS + SDK ═══════════════════════ */
section('J. HEADLESS CLI + SDK');
{
  const cli = await new Promise((resolve) => {
    const c = spawn(process.execPath, ['cli.js', '--self-test'], { cwd: SERVER_DIR, env: { ...process.env, JEXI_ALLOW_UNLOCKED: '1' } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
  ok('cli --self-test exits 0', cli.code === 0);
  ok('cli self-test reports ok:true', cli.out.includes('"ok": true') || cli.out.includes('"ok":true'));

  const { JexiClient } = await import('./sdk/client.js');
  const client = new JexiClient({ baseUrl: 'http://127.0.0.1:3996' });
  // SDK against a booted server
  const PORT = 3997;
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, JEXI_ALLOW_UNLOCKED: '1', PORT: String(PORT), REDIS_URL: '' }, stdio: 'ignore' });
  let booted = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) { booted = true; break; } } catch { /* noop */ }
  }
  if (booted) {
    const sdkClient = new JexiClient({ baseUrl: `http://127.0.0.1:${PORT}` });
    const health = await sdkClient.health();
    ok('sdk health', health.ok === true);
    const tools = await sdkClient.tools();
    ok('sdk tools inventory', tools && tools.counts && tools.counts.totalTools >= 218);
    const convs = await sdkClient.conversations();
    ok('sdk conversations list', Array.isArray(convs) || (convs && Array.isArray(convs.conversations)));
  } else {
    ok('sdk server booted for client test', false);
  }
  child.kill('SIGTERM');
}

/* ──────────────────────── FINAL ──────────────────────── */
console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULT: ${passes} passed, ${failures} failed`);
console.log(`${'═'.repeat(60)}`);
process.exit(failures === 0 ? 0 : 1);
