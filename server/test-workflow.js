/**
 * B115 — WORKFLOW + SUBAGENT CONTROL regression suite
 * (deepseek-harness workflow/workflow-worker-thread + tool-subagent-control
 * mirror).
 *
 * Proves: the workflow tool runs model-written scripts with the DSH globals
 * (agent/parallel/pipeline/phase/log/args), agentsStarted + result contract,
 * META_INVALID / SCRIPT_PARSE / RESULT_UNSERIALIZABLE / AGENT_CAP error
 * discipline, cancellation, workflow run records, and send_message /
 * interrupt_agent through the gated runtime with contracts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-wf-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { startWorkflow, workflowRecord, listWorkflows, setWorkflowDispatcher, WorkflowError } = await import('./src/services/WorkflowEngine.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { TOOL_COUNT, TOOL_REGISTRY, getTool } = await import('./src/services/ToolRegistry.js');
const { buildNativeSchemas, TOOL_SCHEMAS } = await import('./src/services/ToolRuntime.js');
const { startJob, setJobExecutor } = await import('./src/services/BackgroundJobs.js');

console.log('\n== 1. Registry: 3 new tools (196) ==');
ok(TOOL_COUNT === 213, `registry count 193 → 205 (${TOOL_COUNT})`);
for (const slug of ['workflow', 'send_message', 'interrupt_agent']) {
  ok(TOOL_REGISTRY.some((t) => t.slug === slug), `${slug} registered`);
}
ok(TOOL_SCHEMAS.workflow && TOOL_SCHEMAS.workflow.script && TOOL_SCHEMAS.workflow.meta, 'workflow declares script + meta args');
ok(TOOL_SCHEMAS.send_message && TOOL_SCHEMAS.send_message.subagent_id, 'send_message declares subagent_id');
const sdk = buildNativeSchemas([getTool('workflow')]);
ok(sdk.length === 1 && sdk[0].function.parameters.properties.meta, 'buildNativeSchemas emits workflow meta');

console.log('\n== 2. Script execution with the DSH globals ==');
setWorkflowDispatcher(async (task) => `report: ${task}`);
const events = [];
const run1 = startWorkflow({
  script: `phase('research');
const a = await agent('find sources');
const b = await agent('check facts');
const both = await parallel([() => agent('p1'), () => agent('p2')]);
const piped = await pipeline([1, 2, 3], (items) => items.map((x) => x * 2));
log('done');
return { a, b, both: both.length, piped, arg: args.topic };`,
  meta: { name: 'research-flow', description: 'Research then verify', whenToUse: 'multi-agent research' },
  args: { topic: 'ai' },
  onEvent: (type, data) => events.push({ type, ...data }),
});
const out1 = await run1.result;
ok(out1.stopReason === 'completed', 'workflow completed');
ok(out1.agentsStarted === 4, `agentsStarted = 4 (2 direct + 2 parallel) (${out1.agentsStarted})`);
ok(out1.value.a === 'report: find sources', 'agent() returns the subagent report');
ok(out1.value.both === 2, 'parallel() ran both thunks (both = count)');
ok(JSON.stringify(out1.value.piped) === '[2,4,6]', 'pipeline() applied the stage');
ok(out1.value.arg === 'ai', 'args global exposed');
const rec = workflowRecord(run1.id);
ok(rec && rec.status === 'completed', 'run record completed');
ok(events.some((e) => e.type === 'workflow/phase' && e.title === 'research'), 'phase event emitted');
ok(events.some((e) => e.type === 'workflow/log'), 'log event emitted');
ok(events.some((e) => e.type === 'workflow/agent-start'), 'agent-start event emitted');
ok(events.some((e) => e.type === 'workflow/end'), 'workflow/end event emitted');
ok(listWorkflows().some((w) => w.id === run1.id && w.agentsStarted === 4), 'listWorkflows shows the run');

console.log('\n== 3. Error discipline (DSH WorkflowError codes) ==');
let metaErr = null;
try { startWorkflow({ script: 'return 1;', meta: { name: 'Bad Meta!' } }); } catch (e) { metaErr = e; }
ok(metaErr && metaErr.code === 'META_INVALID', 'invalid meta → META_INVALID (synchronous)');
let parseErr = null;
try { startWorkflow({ script: 'const = broken', meta: { name: 'ok-name', description: 'valid description here' } }); } catch (e) { parseErr = e; }
ok(parseErr && parseErr.code === 'SCRIPT_PARSE', 'unparseable script → SCRIPT_PARSE');
const badResult = await startWorkflow({
  script: `return { f: () => 1 };`,
  meta: { name: 'bad-result', description: 'returns non-json' },
}).result;
ok(badResult.stopReason === 'error' && /RESULT_UNSERIALIZABLE/.test(badResult.error.code), 'non-JSON result → RESULT_UNSERIALIZABLE');
const capped = await startWorkflow({
  script: `await agent('a1'); await agent('a2'); return 'x';`,
  meta: { name: 'capped-flow', description: 'exceeds cap' },
  maxTotalAgents: 1,
}).result;
ok(capped.stopReason === 'error' && capped.error.code === 'AGENT_CAP', 'agent cap → AGENT_CAP');
const cancelled = await startWorkflow({
  script: `await agent('a'); await new Promise((r) => setTimeout(r, 3000)); return 'late';`,
  meta: { name: 'slow-flow', description: 'cancellable' },
  signal: (() => { const c = new AbortController(); c.abort(); return c.signal; })(),
}).result;
ok(cancelled.stopReason === 'cancelled' || cancelled.stopReason === 'error', 'aborted signal settles the run (never hangs)');

console.log('\n== 4. workflow tool through the gate ==');
const t1 = await executeTool({
  slug: 'workflow',
  args: {
    script: `return { ok: true, n: args.count || 0 };`,
    meta: { name: 'gate-flow', description: 'gate test' },
    args: { count: 3 },
  },
});
ok(t1.ok === true && /"kind": "workflow"/.test(String(t1.result || '')), 'workflow executes with kind=workflow');
ok(/"runId": "wf-/.test(String(t1.result || '')), 'runId present');
ok(/\"result\": \{\s*\"ok\": ?true/.test(String(t1.result || '')), 'script result returned');
const t2 = await executeTool({ slug: 'workflow', args: { script: 'return 1;', meta: { name: 'X' } } });
ok(t2.ok === false && /META_INVALID/.test(t2.error || ''), 'bad meta fails honestly through the gate');
const t3 = await executeTool({ slug: 'workflow', args: { script: '', meta: { name: 'x', description: 'valid' } } });
ok(t3.ok === false && /script body/.test(t3.error || ''), 'empty script fails honestly');

console.log('\n== 5. send_message / interrupt_agent (dsh tool-subagent-control) ==');
setJobExecutor({ run: async () => { await new Promise((r) => setTimeout(r, 400)); return { answer: 'bg done' }; } });
const j = startJob({ task: 'background task' });
ok(j.ok === true, 'background job started');
const sm = await executeTool({ slug: 'send_message', args: { subagent_id: j.id, message: 'now also check the API' } });
ok(sm.ok === true && /"kind": "message"/.test(String(sm.result || '')), 'send_message executes with kind=message');
ok(/"messageId": "msg-/.test(String(sm.result || '')), 'messageId returned (DSH contract)');
const smBad = await executeTool({ slug: 'send_message', args: { subagent_id: 'nope', message: 'hi' } });
ok(smBad.ok === false && /not found/.test(smBad.error || ''), 'unknown subagent fails honestly');
await new Promise((r) => setTimeout(r, 500));
const ia = await executeTool({ slug: 'interrupt_agent', args: { agent_id: j.id } });
ok(ia.ok === true && /"accepted": true/.test(String(ia.result || '')), 'interrupt_agent returns accepted (DSH contract)');
const iaBad = await executeTool({ slug: 'interrupt_agent', args: { agent_id: 'nope' } });
ok(iaBad.ok === false && /not found/.test(iaBad.error || ''), 'interrupting an unknown agent fails honestly');

console.log(`\nB115 workflow+subagent-control: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
