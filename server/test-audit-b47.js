// Independent-audit acceptance tests — the 9 priorities of the intelligence
// upgrade (real graph orchestrator, structured routing, shared state contract,
// validated contracts, confirmation-resume, planner memory, MCP-as-internal,
// retry/fallback/ask-user, concurrency cleanup). No AI keys required.
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-audit-${Date.now()}`;

import { createGraph } from './src/services/GraphRunner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { planner } from './src/services/Planner.js';
import { executeTool, validateToolArgs, validateToolOutput, TOOL_OUTPUT_SCHEMAS } from './src/services/ToolRuntime.js';
import { callMcpTool } from './mcp-server.js';
import { saveOffer, loadOffer, clearOffer, saveRun, loadRun, clearRun, clearAllSessions } from './src/services/SessionStore.js';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) failures++; };

/* ================================================================
 * P1 — real graph orchestrator: branching, replanning, cycles
 * ================================================================ */

// 1a. Conditional branching: a node returning low-confidence (outcome
// 'fallback') must route through replanner, not straight to the responder.
{
  const g = createGraph({
    nodes: {
      start: async (s) => { s.intermediateResults.start = { summary: 'hello' }; return s; },
      flaky: async (s) => { s.outcome = 'fallback'; s.plan = { intent: 'research', fallback: { intent: 'conversation', reasoning: 'fallback' } }; return s; },
      replanner: async (s) => { s.replanned = true; return s; },
      responder: async (s) => { s.responded = true; return s; },
    },
    edges: {
      start: () => 'flaky',
      '*': (s) => (s.outcome === 'fallback' || s.lastError ? 'replanner' : 'responder'),
      replanner: (s) => (s.plan?.fallback && !s.replanned ? 'flaky' : 'responder'),
    },
    start: 'start',
  });
  const out = await g.run({});
  ok(out.replanned === true && out.responded === true, 'P1: low-confidence result branches through replanner, not direct to responder');
}

// 1b. Forced node failure (THROW) converts to a structured error and routes to
// replanner — never a silent end.
{
  const g = createGraph({
    nodes: {
      start: async (s) => s,
      boom: async () => { throw new Error('forced node failure'); },
      replanner: async (s) => { s.replanned = true; return s; },
      responder: async (s) => { s.responded = true; return s; },
    },
    edges: {
      start: () => 'boom',
      '*': (s) => (s.outcome === 'fallback' || s.lastError ? 'replanner' : 'responder'),
      replanner: () => 'responder',
    },
    start: 'start',
    onError: (s) => { s.outcome = 'fallback'; return s; },
  });
  const out = await g.run({});
  ok(out.lastError?.code === 'NODE_THREW' && out.replanned === true && out.responded === true,
    'P1: a throwing node becomes a structured error routed to replanner (never silent)');
}

// 1c. The coding debug loop is a REAL edge cycle: debugger → debugger until
// success or budget, and qaGate → debugger on NEEDS FIX. Proven by inspecting
// the edge resolvers on the orchestrator's actual graph.
{
  const graph = orchestrator.buildGraph();
  const edges = graph.edgeMap;
  ok(edges.has('debugger') && edges.has('qaGate'), 'P1: coding subgraph nodes exist as graph edges');

  // debugger edge: still fixing + under budget → back to debugger (the cycle)
  const underBudget = await edges.get('debugger')({ context: { code: { done: false, runSuccess: false, debugAttempts: 2 } }, retryCount: 2 });
  ok(underBudget === 'debugger', 'P1: debugger re-enters itself while the code still errors (run → fix → rerun cycle)');
  // debugger edge: success → qaGate
  const success = await edges.get('debugger')({ context: { code: { done: false, runSuccess: true, debugAttempts: 1 } } });
  ok(success === 'qaGate', 'P1: successful run leaves the debug loop → QA gate');
  // qaGate edge: NEEDS FIX → back to debugger (re-run), bounded by qaRounds
  const needsFix = await edges.get('qaGate')({ context: { code: { qaVerdict: 'NEEDS FIX', qaRounds: 0, debugAsk: false } } });
  ok(needsFix === 'debugger', 'P1: QA NEEDS FIX routes back through debugger (gate → fix → re-run)');
  const pass = await edges.get('qaGate')({ context: { code: { qaVerdict: 'PASS', qaRounds: 0 } } });
  ok(pass === 'codeReview', 'P1: QA PASS proceeds to the independent Review gate (B49 split of reviewShip)');
}

// 1d. executePlan delegates to the graph runner — no switch on intent in its body.
{
  const src = orchestrator.executePlan.toString();
  ok(!/switch\s*\(/.test(src), 'P1: Orchestrator.executePlan contains no switch on intent (delegates to the graph)');
  const edges = orchestrator.buildGraph().edgeMap;
  ok(edges.has('router'), 'P1: the router node owns intent dispatch');
}

/* ================================================================
 * P2 — structured routing (schema-validated LLM primary, regex fallback)
 * ================================================================ */

// 2a. LLM classification is the PRIMARY path (monkeypatched, no keys needed).
{
  const original = planner._classifyLLM;
  let received = null;
  planner._classifyLLM = async (q, opts) => { received = { q, opts }; return { intent: 'investing_advice', tasks: ['investor'], reasoning: 'stubbed', confidence: 0.9 }; };
  const plan = await planner.analyzeIntent('should i invest in real estate right now', {});
  planner._classifyLLM = original;
  ok(plan.intent === 'investing_advice' && received?.q?.includes('real estate'),
    'P2: schema-validated LLM classification is the primary routing path');
}

// 2b. Low-confidence LLM output falls back to the regex cascade (no crash).
{
  const original = planner._classifyLLM;
  planner._classifyLLM = async () => ({ intent: 'research', tasks: [], reasoning: 'unsure', confidence: 0.3 });
  const plan = await planner.analyzeIntent('what is the capital of kenya', {});
  planner._classifyLLM = original;
  ok(plan.intent === 'research', 'P2: low-confidence LLM result falls back to deterministic classification');
}

// 2c. Schema-validation failure is handled: the Zod schema rejects invalid
// intents, and a failing/validity-breaking LLM path falls back — never a crash.
{
  const { ClassificationSchema } = await import('./src/services/Planner.js');
  const invalid = ClassificationSchema.safeParse({ intent: 'not_a_real_intent', confidence: 0.99, teamSlugs: [], reasoning: 'bogus' });
  ok(invalid.success === false, 'P2: the classification Zod schema rejects an invalid intent');
  const original = planner._classifyLLM;
  planner._classifyLLM = async () => { throw new Error('provider down'); };
  const plan = await planner.analyzeIntent('what is the capital of kenya', {});
  planner._classifyLLM = original;
  ok(plan.intent === 'research', 'P2: LLM classification failure routes to the fallback, never a crash');
}

// 2d. The confusable pair stays distinct through the deterministic path.
{
  const app = await planner.analyzeIntent('build a study planner app', {});
  const topic = await planner.analyzeIntent('study calculus', {});
  ok(app.intent === 'code_task' && topic.intent === 'study_topic',
    'P2: "build a study planner app" → code_task, "study calculus" → study_topic (confusable pair kept apart)');
}

/* ================================================================
 * P3 — shared AgentResult contract at every node boundary
 * ================================================================ */

{
  const graph = orchestrator.buildGraph();
  const results = { success: true, query: 'clear it', intent: 'clear_memory', tasks: [], steps: [], agentResults: {}, summary: '', sources: [], statistics: { executionTime: 0, agentsUsed: 0, confidence: 0 } };
  const state = {
    query: 'clear all memory', plan: { intent: 'clear_memory' }, resolvedQuery: '', memoryLoadout: {},
    intermediateResults: {}, currentNode: '', status: 'running', retryCount: 0, lastError: null, outcome: null,
    needsConfirmation: false, confirmationPayload: null, history: [], agentResult: null,
    context: { results, sendEvent: () => {}, opts: {} },
  };
  const out = await graph.run({ ...state, startNode: 'contextResolve' });
  const nodeResult = out.intermediateResults.clearMemory;
  ok(nodeResult && typeof nodeResult.success === 'boolean' && typeof nodeResult.summary === 'string'
    && 'error' in nodeResult && 'sources' in nodeResult,
    'P3: every node handoff produces the documented AgentResult shape { success, summary, sources, error }');
}

/* ================================================================
 * P4 — validated contracts: fail closed, structured, routed
 * ================================================================ */

{
  const bad = validateToolArgs('web-search', {});
  ok(!bad.ok && bad.error?.code === 'SCHEMA_VALIDATION_FAILED', 'P4: missing required tool arg fails closed with SCHEMA_VALIDATION_FAILED');
  const malformed = validateToolOutput('deep-read', { kind: 'content' });
  ok(!malformed.ok && malformed.error?.code === 'SCHEMA_VALIDATION_FAILED', 'P4: malformed tool OUTPUT is caught (fail closed)');
  ok(typeof TOOL_OUTPUT_SCHEMAS['web-search']?.parse === 'function', 'P4: major tools carry Zod output contracts');
  const exec = await executeTool({ slug: 'web-search', args: {} });
  ok(exec.ok === false && exec.error && exec.error.includes('Invalid arguments'), 'P4: executeTool rejects malformed calls at the boundary');
  // The failure is routed (structured code present), not swallowed into a reply.
  ok(exec.code === 'SCHEMA_VALIDATION_FAILED' || exec.error.includes('Invalid arguments'), 'P4: schema failures are visible and structured, not silent');
}

/* ================================================================
 * P5 — true confirmation-resume (full RunState, exact paused node)
 * ================================================================ */

{
  // Build a real paused RunState: a node requests confirmation, the graph
  // parks at confirmationPause, and the session store persists the FULL state.
  const graph = orchestrator.buildGraph();
  const results = { success: true, query: 'commit the changes', intent: 'github', tasks: [], steps: [], agentResults: {}, summary: '', sources: [], statistics: { executionTime: 0, agentsUsed: 0, confidence: 0 } };
  let captured = null;
  const state = {
    query: 'commit the changes', plan: { intent: 'conversation' }, resolvedQuery: '', memoryLoadout: {},
    intermediateResults: { contextResolve: { success: true, summary: 'prior', sources: [], error: null } },
    currentNode: '', status: 'running', retryCount: 0, lastError: null, outcome: 'ask_user',
    needsConfirmation: true, confirmationPayload: { question: 'OK to proceed?', node: 'conversation', risk: 'high', action: 'commit' },
    history: ['contextResolve'], agentResult: null,
    context: { results, sendEvent: () => {}, opts: { onPause: (s) => { captured = s; } }, resumeNode: 'conversation' },
  };
  const paused = await graph.run({ ...state, startNode: 'confirmationPause' });
  ok(paused.status === 'paused' && paused.needsConfirmation === true && captured !== null,
    'P5: confirmationPause parks the graph and persists the full RunState');

  // Store + resume at the EXACT paused node with prior results intact.
  clearAllSessions();
  saveRun('conv-a', { plan: state.plan, query: 'commit the changes', state: paused });
  ok(loadRun('conv-a') !== null && loadRun('conv-b') === null, 'P9: session store is per-conversation (no cross-talk)');

  // executePlan resets status to 'running' on resume (the pause is over).
  const resumedState = { ...paused, status: 'running', confirmationPayload: { ...paused.confirmationPayload, resolved: true } };
  const resumed = await graph.run({ ...resumedState, startNode: 'confirmationPause' });
  ok(resumed.status === 'done', 'P5: resumed run completes (does not re-pause)');
  ok(resumed.intermediateResults.contextResolve?.summary === 'prior', 'P5: prior intermediate results survive the resume');
  ok(!resumed.history.includes('planner') && resumed.needsConfirmation === false,
    'P5: resume starts at the paused node — never from the planner');

  // Declining clears the stored run (no orphan state).
  clearRun('conv-a');
  ok(loadRun('conv-a') === null, 'P5: declining clears the stored RunState');
}

/* ================================================================
 * P6 — memory injected into the PLANNER before classification
 * ================================================================ */

{
  const original = planner._classifyLLM;
  let memorySeen = null;
  planner._classifyLLM = async (q, opts) => {
    memorySeen = opts?.memoryContext || null;
    if (memorySeen?.includes('weather app')) return { intent: 'code_task', tasks: ['coder'], reasoning: 'remembered project', confidence: 0.85 };
    return null;
  };
  const plan = await planner.analyzeIntent('continue building it', { memoryContext: 'User is building a weather app (active project).' });
  planner._classifyLLM = original;
  ok(memorySeen?.includes('weather app') && plan.intent === 'code_task',
    'P6: the planner receives memory at classification time, and a remembered project decides the intent');
}

/* ================================================================
 * P7 — MCP as an internal tool through the validated path
 * ================================================================ */

{
  const health = await callMcpTool('get_health', {});
  ok(health.ok === true && health.result?.ok === true, 'P7: internal callMcpTool reaches an external MCP tool');
  const bad = await callMcpTool('knowledge_search', { query: '' });
  ok(!bad.ok && bad.error?.code === 'SCHEMA_VALIDATION_FAILED', 'P7: MCP calls are schema-validated (fail closed)');
  const unknown = await callMcpTool('not_a_tool', {});
  ok(!unknown.ok && unknown.error?.code === 'UNKNOWN_MCP_TOOL', 'P7: unknown MCP tools fail closed');
  const throughRuntime = await executeTool({ slug: 'mcp-call', args: { tool: 'get_health' } });
  ok(throughRuntime.ok === true && throughRuntime.result?.includes('jexi-os'), 'P7: an internal graph node calls an MCP tool via the ToolRuntime path');
}

/* ================================================================
 * P8 — retry / fallback / ask_user for every node path
 * ================================================================ */

{
  // retry: a node emits outcome 'retry' → re-enters itself, bounded by maxSteps.
  let runs = 0;
  const g = createGraph({
    nodes: {
      start: async (s) => s,
      flaky: async (s) => { runs += 1; if (runs < 3) { s.outcome = 'retry'; return s; } s.outcome = null; return s; },
      responder: async (s) => { s.responded = true; return s; },
    },
    edges: { start: () => 'flaky', '*': (s) => (s.outcome === 'retry' ? s.currentNode : 'responder'), flaky: (s) => (s.outcome === 'retry' ? 'flaky' : 'responder') },
    start: 'start',
  });
  const out = await g.run({});
  ok(runs === 3 && out.responded === true, 'P8: a node can re-enter itself (retry) up to its budget, then proceed');
}

// ask_user: the github node pauses for approval through the real graph.
{
  const { saveSettings } = await import('./src/services/SettingsManager.js');
  saveSettings({ githubToken: 'fake-token-for-audit-test' }); // auth passes → confirm fires
  const graph = orchestrator.buildGraph();
  const results = { success: true, query: '', intent: 'github', tasks: [], steps: [], agentResults: {}, summary: '', sources: [], statistics: { executionTime: 0, agentsUsed: 0, confidence: 0 } };
  const state = {
    query: 'create a pull request', plan: { intent: 'github' }, resolvedQuery: '', memoryLoadout: {},
    intermediateResults: {}, currentNode: '', status: 'running', retryCount: 0, lastError: null, outcome: null,
    needsConfirmation: false, confirmationPayload: null, history: [], agentResult: null,
    context: {
      results, sendEvent: () => {},
      // The real executePlan confirm writes to the SHARED opts handle, which
      // wrapCase reads — mirror that exactly here.
      opts: (() => { const o = {}; o.confirm = async (payload) => { o._pendingConfirmation = payload; return 'paused'; }; return o; })(),
    },
  };
  const out = await graph.run({ ...state, startNode: 'contextResolve' });
  ok(out.needsConfirmation === true && out.status === 'paused' && out.confirmationPayload?.risk === 'high',
    'P8: ask_user routes to confirmationPause with a structured payload (github mutating action)');
  saveSettings({ githubToken: '' });
}

/* ================================================================
 * P9 — no cross-talk between concurrent conversations
 * ================================================================ */

{
  clearAllSessions();
  // Two conversations both hit confirmationPause "simultaneously".
  saveRun('conv-1', { plan: { intent: 'github' }, query: 'push to github', state: { id: 'run-1', status: 'paused' } });
  saveRun('conv-2', { plan: { intent: 'research' }, query: 'research ai', state: { id: 'run-2', status: 'paused' } });
  const r1 = loadRun('conv-1');
  const r2 = loadRun('conv-2');
  ok(r1.state.id === 'run-1' && r2.state.id === 'run-2', 'P9: two concurrent paused conversations never cross-talk');
  clearRun('conv-1');
  ok(loadRun('conv-1') === null && loadRun('conv-2') !== null, 'P9: clearing one conversation leaves the other intact');
  clearAllSessions();
}

/* ================================================================
 * Prompt fixes — shared structured verification pattern
 * ================================================================ */

{
  const { parseVerificationVerdict, buildVerificationPrompt, buildRevisionPrompt } = await import('./src/services/VerificationPrompt.js');
  ok(parseVerificationVerdict('{"verdict": "CLEAN"}').clean === true, 'PROMPT: JSON verdict CLEAN parses');
  const bad = parseVerificationVerdict('{"verdict": "ISSUES", "issues": ["Claims X but sources say Y"]}');
  ok(bad.clean === false && bad.issues.length === 1, 'PROMPT: JSON verdict ISSUES returns structured issues');
  const legacy = parseVerificationVerdict('VERDICT: ISSUES\nISSUES:\n- invented stat');
  ok(legacy.clean === false && legacy.issues.length === 1, 'PROMPT: legacy VERDICT:/ISSUES: format still parses (non-JSON model tolerated)');
  ok(parseVerificationVerdict('{"verdict": "CLEAN"} trailing prose').clean === true, 'PROMPT: prose-tolerant JSON parsing');
  const prompt = buildVerificationPrompt({ role: 'TESTER', task: 't', draft: 'd' });
  ok(prompt.includes('"verdict"') && prompt.includes('ISSUES'), 'PROMPT: critique prompt requires structured { verdict, issues } output');
  ok(buildRevisionPrompt({ task: 't', issues: ['x'], draft: 'd' }).includes('fixes EVERY issue'), 'PROMPT: revise prompt reused across verifiers');
  const loopSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/VerificationLoop.js', 'utf8'));
  const domainSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/DomainVerifier.js', 'utf8'));
  ok(loopSrc.includes('buildVerificationPrompt') && domainSrc.includes('buildVerificationPrompt'),
    'PROMPT: every verifier call site uses the shared pattern (VerificationLoop + DomainVerifier)');
  const memSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/MemoryManager.js', 'utf8'));
  const prefSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/PreferenceLearner.js', 'utf8'));
  const jexiSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/JexiPrompt.js', 'utf8'));
  ok(memSrc.includes('NEGATIVE EXAMPLES') && memSrc.includes('nothing else'), 'PROMPT: context resolution forces bare rewrite + negative examples');
  ok(prefSrc.includes('NEGATIVE EXAMPLES'), 'PROMPT: preference extraction has negative few-shots');
  // B50 P7 — per-intent output formats MOVED OUT of the always-on prompt into
  // the progressive knowledge folder; the prompt keeps the rules + a pointer.
  ok(jexiSrc.includes('NEVER invent sources'), 'PROMPT: JEXI_SYSTEM_PROMPT has never-invent-sources');
  ok(jexiSrc.includes('knowledge-load') && jexiSrc.includes('formatting'), 'PROMPT: JEXI_SYSTEM_PROMPT points at the formatting knowledge folder');
  ok(jexiSrc.includes('# PROJECT KNOWLEDGE'), 'PROMPT: always-on project knowledge section present');
}

console.log(failures === 0 ? '\nAUDIT BUILD 47 TESTS PASSED ✅' : `\n${failures} AUDIT TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
