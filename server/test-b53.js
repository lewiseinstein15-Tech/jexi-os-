// B53 — PRODUCT DELIVERY, TASK ISOLATION, MEMORY, UI, ZERO PROCESS GARBAGE.
// Proves each priority from FIXLOG-B53.md with machine-checkable assertions.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { planner } from './src/services/Planner.js';
import { sanitizeFinalAnswer, containsForbiddenNarration } from './src/services/AnswerSanitizer.js';
import { analyzeMessage } from './src/services/ConversationManager.js';
import { createTask, getTask, updateTask, deleteTask, clearTasks, setTaskCheckpoint, taskContextBlock, taskEpisodicSummary } from './src/services/TaskRegistry.js';
import { decide, applyDecision } from './src/services/DecisionEngine.js';
import { activateTaskWorkspace, archiveTaskWorkspace, taskWorkspaceDir } from './src/services/WorkspaceRuntime.js';
import { WORKSPACE_DIR, DATA_DIR } from './src/config.js';
import { saveCodingKnowledge, loadMemory, saveMemory, semanticRecall } from './src/services/MemoryManager.js';
import { runCodingLoop } from './src/services/CodingLoop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

// ===========================================================================
// P1 — FRONTEND: full-width chat + compact plan header.
// ===========================================================================
{
  const cc = read('../src/components/CommandCenter.jsx');
  check('P1 CommandCenter no longer constrains the chat to max-w-[680px]', !/max-w-\[680px\]/.test(cc));
  check('P1 CommandCenter main column spans the work surface', /w-full min-w-0/.test(cc) || /w-full/.test(cc));
  check('P1 plan header collapses stages by default', /COLLAPSED_STAGES/.test(cc));
  check('P1 collapsed plan shows an expand toggle', /\+\$\{hiddenCount\} MORE/.test(cc) || /hiddenCount/.test(cc));
  check('P1 smaller plan chips (8px mono)', /text-\[8px\] font-mono/.test(cc));
}

// ===========================================================================
// P2 — HARD TASK / PRODUCT ISOLATION (calculator → calendar must not bleed).
// ===========================================================================
{
  // Hermetic scenario: no stale persisted tasks may affect classification.
  clearTasks();

  const task1 = createTask({ title: 'Build me a calculator web app', objective: 'Build me a calculator web app', plan: ['plan', 'code', 'ship'], status: 'active' });
  check('P2 task1 created', !!task1.id && task1.title.includes('calculator'));

  // New product objective → NEW task (never continue).
  const a1 = await analyzeMessage('Build an app that tracks my calendar events', { currentTaskId: task1.id });
  check('P2 calendar request classifies as new (not continue)', a1.classification === 'new' && a1.taskId === null);

  // Modification language on the active product → same task, continue.
  const a2 = await analyzeMessage('add dark mode to the calculator', { currentTaskId: task1.id });
  check('P2 "add dark mode to the calculator" stays on the same task', a2.classification === 'continue' && a2.taskId === task1.id);
  const a3 = await analyzeMessage('change the button color', { currentTaskId: task1.id });
  check('P2 "change the button color" stays on the same task', a3.classification === 'continue' && a3.taskId === task1.id);
  const a4 = await analyzeMessage('go back to the calculator', { currentTaskId: task1.id });
  check('P2 "go back to the calculator" resolves to the calculator task', ['continue', 'switch'].includes(a4.classification) && a4.taskId === task1.id);

  // Decision engine: new classification → applyDecision creates a DIFFERENT task.
  const decision = decide({ raw: 'Build an app that tracks my calendar events', classification: a1, taskId: null, candidates: [], currentTaskId: task1.id });
  const applied = applyDecision(decision, { title: 'Build an app that tracks my calendar events', objective: 'Build an app that tracks my calendar events', plan: ['plan', 'code', 'ship'] });
  const task2 = applied.task;
  check('P2 calendar objective got its OWN taskId', !!task2 && task2.id !== task1.id);
  check('P2 task2 context block does NOT list task1 files', !taskContextBlock(task2).includes(task1.filesChanged.join(',') || 'index.html'));

  // Workspace isolation: a new task's staging area must not contain the old
  // task's artifacts; switching back restores them.
  const wsBackup = path.join(DATA_DIR, 'b53-ws-backup');
  fs.rmSync(wsBackup, { recursive: true, force: true });
  fs.mkdirSync(wsBackup, { recursive: true });
  if (fs.existsSync(WORKSPACE_DIR)) {
    for (const ent of fs.readdirSync(WORKSPACE_DIR)) {
      const from = path.join(WORKSPACE_DIR, ent);
      const to = path.join(wsBackup, ent);
      try { if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true }); else fs.copyFileSync(from, to); } catch (e) {}
    }
  }

  try {
    activateTaskWorkspace(task1.id);
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(path.join(WORKSPACE_DIR, 'calculator.html'), '<h1>calc</h1>', 'utf-8');
    archiveTaskWorkspace(task1.id);

    // New product task: activate its (empty) workspace → calculator gone.
    const act2 = activateTaskWorkspace(task2.id);
    const files2 = fs.existsSync(WORKSPACE_DIR) ? fs.readdirSync(WORKSPACE_DIR) : [];
    check('P2 calendar task workspace is fresh (no calculator.html)', act2.fresh === true && !files2.includes('calculator.html'));
    fs.writeFileSync(path.join(WORKSPACE_DIR, 'calendar.html'), '<h1>cal</h1>', 'utf-8');
    archiveTaskWorkspace(task2.id);

    // Switch back to the calculator → its artifacts restored, calendar absent.
    const act1 = activateTaskWorkspace(task1.id);
    const files1 = fs.readdirSync(WORKSPACE_DIR);
    check('P2 switching back restores calculator.html', act1.restored === true && files1.includes('calculator.html'));
    check('P2 calculator workspace does not contain calendar.html', !files1.includes('calendar.html'));
  } finally {
    // Restore the original workspace state.
    fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    for (const ent of fs.readdirSync(wsBackup)) {
      const from = path.join(wsBackup, ent);
      const to = path.join(WORKSPACE_DIR, ent);
      try { if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true }); else fs.copyFileSync(from, to); } catch (e) {}
    }
    fs.rmSync(wsBackup, { recursive: true, force: true });
    for (const id of [task1.id, task2.id]) {
      try { fs.rmSync(taskWorkspaceDir(id), { recursive: true, force: true }); } catch (e) {}
      try { deleteTask(id); } catch (e) {}
    }
  }
}

// ===========================================================================
// P3 — MODIFICATION PATH: apply the edit, never research the word.
// ===========================================================================
{
  const m1 = await planner.analyzeIntent('change the button color', { activeTaskId: 'TASK-903' });
  check('P3 "change the button color" + active task → code_task', m1.intent === 'code_task');
  const m2 = await planner.analyzeIntent('add dark mode to the calculator app', { activeTaskId: 'TASK-903' });
  check('P3 "add dark mode…" + active task → code_task', m2.intent === 'code_task');
  const m3 = await planner.analyzeIntent('now also add a settings page', { activeTaskId: 'TASK-903' });
  check('P3 "now also add…" + active task → code_task', m3.intent === 'code_task');
  const m4 = await planner.analyzeIntent('change the button color');
  check('P3 no active task → never research (no web-search of the word)', m4.intent !== 'research' && m4.intent !== 'direct_answer');
}

// ===========================================================================
// P4 — PRODUCT-ONLY FINAL ANSWERS (zero process garbage).
// ===========================================================================
{
  const dirty = 'Completed: Product → Designer → Engineer → Coder → QA → Reviewer → Security → Shipper\n\n' +
    'Team: Product → Designer → Engineer\n' +
    'This was a bug I corrected in the render loop.\n' +
    'Reflector notes: the team worked well together.\n' +
    'The full agent team worked together to ship this.\n' +
    '### ✅ Calculator web app is ready.\n\n' +
    '✓ Runs clean.\n\n' +
    '**🔗 Live preview:** [Open index.html](/preview/index.html)\n\n' +
    '**Files:**\n- [index.html](/api/files/index.html)\n- [styles.css](/api/files/styles.css)';
  const clean = sanitizeFinalAnswer(dirty);
  check('P4 pipeline completion list stripped', !/Completed: Product/.test(clean));
  check('P4 team org-chart line stripped', !/Team: Product/.test(clean));
  check('P4 "this was a bug I corrected" stripped', !/this was a bug I corrected/.test(clean));
  check('P4 reflector essay line stripped', !/Reflector notes/.test(clean));
  check('P4 agent-team narration stripped', !/The full agent team worked together/.test(clean));
  check('P4 product content survives (status + preview + files)', /Calculator web app is ready/.test(clean) && /Live preview/.test(clean) && /index\.html/.test(clean));
  check('P4 containsForbiddenNarration flags pipeline lists', containsForbiddenNarration('Completed: Product → Designer → Coder → QA'));
  check('P4 containsForbiddenNarration flags critic essays', containsForbiddenNarration('Critic notes: this was a bug I corrected'));
  // The build shipper must produce the product-first template, not the old report.
  const orch = read('src/services/Orchestrator.js');
  check('P4 shipper uses the product-first template', /PRODUCT-FIRST final message/.test(orch) && /is ready\./.test(orch));
  check('P4 old build-report header gone', !/BUILD READY/.test(orch));
  check('P4 QA/REVIEW essay sections gone from the final message', !/\*\*🧪 QA REPORT\*\*/.test(orch) && !/\*\*🛠 BUILD PLAN\*\*/.test(orch));
}

// ===========================================================================
// P5 — MEMORY SCOPES: working / episodic / semantic separation.
// ===========================================================================
{
  // Semantic recall with noCode must NEVER return another task's code bodies.
  const topic = 'B53-ISOLATION-PROBE-7741';
  const mem = loadMemory();
  const before = mem.codingKnowledge.length;
  saveCodingKnowledge(topic, 'code', 'const calculator = 42; // B53 probe file body', ['probe.html']);
  const withCode = await semanticRecall(topic, { limit: 5 });
  const withoutCode = await semanticRecall(topic, { limit: 5, noCode: true });
  check('P5 semantic recall (with code) can find the probe', withCode.some((r) => r.kind === 'code'));
  check('P5 noCode semantic recall excludes product code bodies', !withoutCode.some((r) => r.kind === 'code'));
  // Cleanup the probe entry.
  const mem2 = loadMemory();
  mem2.codingKnowledge = mem2.codingKnowledge.filter((e) => e.topic !== topic);
  while (mem2.codingKnowledge.length > before) mem2.codingKnowledge.pop();
  saveMemory();

  // Episodic/working state is task-scoped via taskEpisodicSummary.
  const t = createTask({ title: 'B53 memory task', objective: 'build a notes app', plan: ['a', 'b'] });
  updateTask(t.id, { filesChanged: ['notes.html'], result: 'shipped notes app', completedSteps: ['a'] });
  const epi = taskEpisodicSummary(t.id);
  check('P5 episodic summary carries only THIS task state', epi.taskId === t.id && epi.filesChanged.includes('notes.html'));
  check('P5 episodic summary excludes other tasks', !JSON.stringify(epi).includes('calculator'));
  const other = taskEpisodicSummary('TASK-999-nope');
  check('P5 unknown task has no episodic state', other === null);
  try { deleteTask(t.id); } catch (e) {}
}

// ===========================================================================
// P6 — DURABLE CHECKPOINTS + RESUME.
// ===========================================================================
{
  const t = createTask({ title: 'B53 checkpoint task', objective: 'build a timer app', plan: ['plan', 'code'] });
  const cp = setTaskCheckpoint(t.id, { node: 'debugger', attempt: 3, lastError: 'ReferenceError: x is not defined', files: ['timer.js'] });
  check('P6 checkpoint write returns the checkpoint', cp.node === 'debugger' && cp.attempt === 3);
  const t2 = getTask(t.id);
  check('P6 checkpoint persisted on the task', t2.checkpoint && t2.checkpoint.node === 'debugger' && t2.checkpoint.lastError.includes('ReferenceError'));
  check('P6 resume context exposes the checkpoint', taskContextBlock(t2).includes('Checkpoint: debugger'));
  const resume = taskEpisodicSummary(t.id);
  check('P6 resume does not re-inject unrelated artifacts', !JSON.stringify(resume).includes('calculator'));
  try { deleteTask(t.id); } catch (e) {}
}

// ===========================================================================
// P7 — GRAPH + LOOP: exact failures fed back, bounded, scope-disciplined.
// ===========================================================================
{
  // The fixer receives the EXACT previous error + the failure-history tail.
  let fixerSeen = [];
  let runs = 0;
  await runCodingLoop({
    goal: 'make it pass', entryPoint: 'a.js',
    runCommand: async () => { runs++; return runs === 1 ? { exitCode: 1, output: 'ReferenceError: boom' } : { exitCode: 0, output: 'DONE' }; },
    writeFiles: async () => {},
    fixer: async (o) => { fixerSeen.push(o); return { files: [{ name: 'a.js', code: 'fixed' }], entryPoint: 'a.js' }; },
    successCriterion: 'exit-zero-no-error-text', maxAttempts: 3, sendEvent: () => {},
  });
  check('P7 second iteration received the first error text', fixerSeen.length === 1 && fixerSeen[0].errorOutput.includes('ReferenceError: boom'));
  check('P7 fixer received the failure-history tail', fixerSeen.length === 1 && String(fixerSeen[0].failureHistory || '').includes('attempt 1'));

  // Scope discipline is IN the retry prompt.
  const loopSrc = read('src/services/CodingLoop.js');
  check('P7 retry prompt forbids scope expansion', /do not expand scope/i.test(loopSrc));
  check('P7 retry prompt names the exact error', /EXACT ERROR FROM THE LAST RUN/.test(loopSrc));

  // Identical repeated failure stops/escalates (bounded, no infinite loop).
  const same = await runCodingLoop({
    goal: 'x', entryPoint: 'a.js',
    runCommand: async () => ({ exitCode: 1, output: 'Error: same problem' }),
    writeFiles: async () => {},
    fixer: async () => ({ files: [{ name: 'a.js', code: 'y' }], entryPoint: 'a.js' }),
    successCriterion: 'exit-zero', maxAttempts: 10, sendEvent: () => {},
  });
  check('P7 identical failure escalates instead of looping forever', same.escalated === true && same.attempts === 3);
}

// ===========================================================================
// P8 — RESPONSE AGENT RULES (product first, no org-chart narration).
// ===========================================================================
{
  const jexi = read('knowledge/JEXI.md');
  check('P8 JEXI.md has task-isolation rule', /Task isolation/.test(jexi) && /never inherits the previous product/i.test(jexi));
  check('P8 JEXI.md has product-first rule', /Product-first answers/.test(jexi));
  const voice = read('src/services/RESPONSE_VOICE.md');
  check('P8 RESPONSE_VOICE.md has product-first delivery', /Product-first delivery/.test(voice));
  check('P8 RESPONSE_VOICE.md bans pipeline play-by-play', /Completed: Product → Designer/.test(voice));
  const g = read('src/services/Groundedness.js');
  check('P8 VOICE_RULES embeds PRODUCT-FIRST', /PRODUCT-FIRST/.test(g));
  check('P8 VOICE_RULES bans org-chart narration', /agent organization chart/.test(g) || /organization chart/.test(g));
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
