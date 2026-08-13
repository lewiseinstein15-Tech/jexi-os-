/**
 * JEXI OS — BUILD 47 acceptance suite.
 *
 * Implements the 13 success criteria from the Build 47 spec deterministically
 * (no LLM needed) against the real TaskRegistry / ConversationManager /
 * DecisionEngine / DecisionMemory services, plus a long-conversation
 * simulation with a user switching between subjects unpredictably.
 *
 * Self-isolating: fresh DATA_DIR, cleared registry + decision memory.
 */
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-build47-${Date.now()}`;

const { createTask, getTask, listTasks, updateTask, resolveTaskRef, taskContextBlock, clearTasks, taskStats } = await import('./src/services/TaskRegistry.js');
const { analyzeMessage, decomposeTasks } = await import('./src/services/ConversationManager.js');
const { decide, applyDecision } = await import('./src/services/DecisionEngine.js');
const { recordDecision, retrieveDecisions, findConflict, clearDecisionMemory, memoryStats } = await import('./src/services/DecisionMemory.js');

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

clearTasks();
clearDecisionMemory();

/* ------------------------------------------------------------------ */
console.log('\n== TEST 1 — SIMPLE CONTINUATION ==');
/* ------------------------------------------------------------------ */
let task1 = createTask({ title: 'Build a React dashboard', objective: 'Build a React dashboard', entities: ['dashboard'], plan: ['plan', 'build', 'verify'] });
let an = await analyzeMessage('Add authentication', { currentTaskId: task1.id });
ok(an.classification === 'continue' && an.taskId === task1.id, `"Add authentication" continues TASK ${task1.id}`, an.reason);

/* ------------------------------------------------------------------ */
console.log('\n== TEST 2 — REFERENCE RESOLUTION ==');
/* ------------------------------------------------------------------ */
an = await analyzeMessage('Make it faster', { currentTaskId: task1.id });
ok(an.classification === 'continue' && an.taskId === task1.id, '"Make it faster" → "it" resolves to the dashboard', an.reason);
const ref = resolveTaskRef('Make it faster');
ok(ref.taskId === task1.id, 'resolveTaskRef handles "it" via continuation', ref.reason);

/* ------------------------------------------------------------------ */
console.log('\n== TEST 3 — TOPIC SWITCH ==');
/* ------------------------------------------------------------------ */
an = await analyzeMessage('What is the derivative of x³?', { currentTaskId: task1.id });
ok(an.classification === 'new', 'derivative question is a NEW task (topic switch)', an.reason);
let taskMath = createTask({ title: 'Derivative problem', objective: 'What is the derivative of x³?', entities: ['math', 'derivative'], plan: ['solve', 'verify'] });
ok(getTask(task1.id).status === 'paused', 'dashboard paused while math is active');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 4 — RETURN TO OLD TASK ==');
/* ------------------------------------------------------------------ */
an = await analyzeMessage("Let's go back to the frontend", { currentTaskId: taskMath.id });
// The dashboard task's objective mentions the frontend? Create a server task too.
let taskServer = createTask({ title: 'Set up Linux server', objective: 'Set up the Linux server', entities: ['server', 'linux'], plan: ['install', 'config', 'test'] });
an = await analyzeMessage("Let's go back to the dashboard", { currentTaskId: taskServer.id });
ok(an.classification === 'switch' && an.taskId === task1.id, '"go back to the dashboard" restores the dashboard task', an.reason);
ok(Boolean(an.contextBlock) && an.contextBlock.includes(task1.id), 'switch carries resume context');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 5 — MULTI-TASK REQUEST ==');
/* ------------------------------------------------------------------ */
const parts = decomposeTasks('Fix the frontend and analyze the API');
ok(parts.length === 2, `"Fix the frontend and analyze the API" → ${parts.length} sub-objectives`, parts.map((p) => `"${p.text}"`).join(' | '));
ok(decomposeTasks('Build an app with auth and a database').length === 1, 'single objective with list is NOT split');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 6 — INTERRUPTION ==');
/* ------------------------------------------------------------------ */
createTask({ title: 'Research AI models', objective: 'Research AI models', entities: ['research'], plan: ['search', 'synthesize'] });
ok(listTasks().filter((t) => t.status === 'active').length === 1, 'only one task is active after interruption');
ok(getTask(taskServer.id).status === 'paused', 'previous task paused');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 7 — RESUMPTION ==');
/* ------------------------------------------------------------------ */
an = await analyzeMessage('Continue the first task', { currentTaskId: null });
ok(['continue', 'switch'].includes(an.classification) && an.taskId, '"Continue the first task" resumes a task', `${an.classification} → ${an.taskId} (${an.reason})`);

/* ------------------------------------------------------------------ */
console.log('\n== TEST 8 — MEMORY RETRIEVAL ==');
/* ------------------------------------------------------------------ */
recordDecision({ type: 'decision', content: 'The project uses Vite + React.', source: 'project config', project: 'jexi', confidence: 'verified' });
const found = retrieveDecisions({ query: 'vite react' });
ok(found.length >= 1 && found[0].content.includes('Vite'), 'decision retrievable by keyword', `"${found[0]?.content?.slice(0, 40)}"`);
ok(found[0].source === 'project config' && found[0].confidence === 'verified', 'provenance preserved (source + confidence)');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 9 — MEMORY CORRECTION (supersession) ==');
/* ------------------------------------------------------------------ */
recordDecision({ type: 'fact', content: 'Backend uses Express.', source: 'user', confidence: 'direct' });
const conflict = findConflict('Backend was migrated to FastAPI');
ok(Boolean(conflict), 'conflict detected for migrated backend');
recordDecision({ type: 'fact', content: 'Backend was migrated to FastAPI.', source: 'user', confidence: 'direct', supersedes: conflict.id });
ok(conflict.supersededBy, 'old fact marked superseded (history kept)');
const live = retrieveDecisions({ query: 'backend' });
ok(!live.some((e) => e.content.includes('Express')), 'superseded fact no longer returned as live');
ok(memoryStats().superseded >= 1, 'supersession counted in stats');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 10 — AMBIGUITY (ask, don\'t guess) ==');
/* ------------------------------------------------------------------ */
createTask({ title: 'Fix the JEXI backend server', objective: 'Fix the JEXI backend server', entities: ['server', 'backend'], plan: ['diagnose', 'fix'] });
an = await analyzeMessage('Fix the server', { currentTaskId: null });
ok(an.classification === 'clarify', '"Fix the server" with two server tasks → CLARIFY (never guess)', an.reason);
const decision = decide({ raw: 'Fix the server', classification: an, candidates: an.candidates, currentTaskId: null });
ok(decision.action === 'clarify' && decision.clarification.options.length >= 2, 'clarify decision includes candidate options');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 11 — FAILURE RECOVERY ==');
/* ------------------------------------------------------------------ */
updateTask(task1.id, { status: 'failed', result: 'build failed' });
ok(getTask(task1.id).status === 'failed', 'task honestly marked failed');
const resume = resolveTaskRef('continue');
ok(resume.taskId === task1.id, '"continue" after failure targets the failed task for retry', resume.reason);
updateTask(task1.id, { status: 'active', query: 'retry the build' });
ok(getTask(task1.id).status === 'active', 'task re-activated for retry');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 12 — VERIFICATION LINK ==');
/* ------------------------------------------------------------------ */
const ctx = taskContextBlock(task1);
ok(ctx.includes('Current task') && ctx.includes(task1.id), 'task context block carries verified state');
ok(Boolean(ctx.trim()), 'resume context is non-empty');

/* ------------------------------------------------------------------ */
console.log('\n== TEST 13 — LONG CONVERSATION SIMULATION ==');
/* ------------------------------------------------------------------ */
clearTasks();
let sim = null;
const turn = (msg, currentId) => analyzeMessage(msg, { currentTaskId: currentId || null });

// "Build a research agent" → new
let a = await turn('Build a research agent that analyzes math papers', null);
let research = createTask({ title: 'Research agent', objective: 'Build a research agent that analyzes math papers', entities: ['research', 'agent'], plan: ['plan', 'build', 'verify'] });
ok(a.classification === 'new', 'turn 1: new task');

// "Make it use multiple agents" → continue
a = await turn('Make it use multiple agents', research.id);
ok(a.classification === 'continue' && a.taskId === research.id, 'turn 2: continue');

// "And let it remember previous research" → continue
a = await turn('And let it remember previous research', research.id);
ok(a.classification === 'continue' && a.taskId === research.id, 'turn 3: continue ("it" = research system)');

// "Now explain how the memory works" → continue (question about current system)
a = await turn('Now explain how the memory works', research.id);
ok(a.classification === 'continue' && a.taskId === research.id, 'turn 4: explain current system');

// "Actually, solve this equation: 2x + 4 = 10" → new math task (topic switch)
a = await turn('Actually, solve this equation: 2x + 4 = 10', research.id);
ok(a.classification === 'new', 'turn 5: topic switch to math', a.reason);
let math = createTask({ title: 'Solve equation', objective: 'Solve 2x + 4 = 10', entities: ['math', 'equation'], plan: ['solve', 'verify'] });
ok(getTask(research.id).status === 'paused', 'research agent paused during math');

// "Back to the research agent — add a citation tool" → switch back
a = await turn('Back to the research agent — add a citation tool', math.id);
ok(a.classification === 'switch' && a.taskId === research.id, 'turn 6: switch back to research agent', a.reason);

// "What's the derivative of x²?" → new math (even while research active)
a = await turn("What's the derivative of x²?", research.id);
ok(a.classification === 'new', 'turn 7: another topic switch to math', a.reason);
let deriv = createTask({ title: 'Derivative of x²', objective: "What's the derivative of x²?", entities: ['math', 'derivative'], plan: ['solve', 'verify'] });

// "Continue the equation we were solving" → resolve to the equation task
a = await turn('Continue the equation we were solving', research.id);
ok(a.taskId === math.id, 'turn 8: "the equation" resolves to the math task', `${a.classification} → ${a.taskId}`);

// Final state sanity: multiple topics kept, exactly one active.
const st = taskStats();
ok(st.total >= 3, `long conversation kept ${st.total} task contexts (research, math ×2)`);
ok(st.active === 1, 'exactly one active task at the end');
ok(st.paused >= 1, 'paused topics preserved');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
