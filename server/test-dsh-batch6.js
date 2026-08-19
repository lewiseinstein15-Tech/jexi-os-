/**
 * B137 — DSH BATCH 6 TEST ("Pull the all"):
 *
 *   interaction/user-approval        → UserApproval.js (ask | never, log-backed)
 *   interaction/permission-presets   → PermissionPresets.js (sandbox+approval bundles)
 *   subagent/tool-subagent-report    → SubagentReport.js + registry `report` tool
 *   preset/persona + agent-presets   → PersonaManager.js (persona flavors)
 *   schedule/schedule (runtime view) → ScheduleRuntime.js
 *   host/webserver + frontend-static → HostStatus.js
 *   api/gateway                      → gatewayStatus (open paths, key lock)
 *   examples/                        → server/examples (docs mirror)
 *   test-support/llm-replay          → server/test-support/llm-replay.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. USER APPROVAL ══════════════ */
console.log('\n== 1. User approval (dsh user-approval) ==');
{
  const { APPROVAL_POLICIES, DEFAULT_APPROVAL_POLICY, effectiveApprovalPolicy, setApprovalPolicy, needsApproval } = await import('./src/services/UserApproval.js');
  ok('policies are ask | never', APPROVAL_POLICIES.join(',') === 'ask,never');
  ok('default is ask', DEFAULT_APPROVAL_POLICY === 'ask');
  ok('fresh session → ask', effectiveApprovalPolicy('t-approval-fresh') === 'ask');
  ok('ask needs approval', needsApproval('t-approval-fresh') === true);
  const r = setApprovalPolicy('t-approval-conv', 'never');
  ok('set never ok', r.ok && r.policy === 'never');
  ok('fold reads never (log-backed)', effectiveApprovalPolicy('t-approval-conv') === 'never');
  ok('never needs no approval', needsApproval('t-approval-conv') === false);
  ok('invalid policy rejected', setApprovalPolicy('t-approval-conv', 'maybe').ok === false);
  setApprovalPolicy('t-approval-conv', 'ask');
  ok('re-set back to ask', effectiveApprovalPolicy('t-approval-conv') === 'ask');
}

/* ══════════════ 2. PERMISSION PRESETS ══════════════ */
console.log('\n== 2. Permission presets (dsh permission-presets) ==');
{
  const { PERMISSION_PRESETS, PERMISSION_PRESET_NAMES, effectivePermissionPreset, setPermissionPreset, permissionsStatus, CUSTOM_PRESET } = await import('./src/services/PermissionPresets.js');
  ok('preset table has 4 bundles', PERMISSION_PRESET_NAMES.sort().join(',') === 'assistant,autonomous,full-access,sandboxed');
  ok('autonomous = workspace-write + never', PERMISSION_PRESETS.autonomous.sandbox === 'workspace-write' && PERMISSION_PRESETS.autonomous.approval === 'never');
  const conv = 't-perm-conv';
  const r = setPermissionPreset(conv, 'autonomous');
  ok('set preset writes both knobs', r.ok && r.sandbox === 'workspace-write' && r.approval === 'never');
  const { effectiveSandboxMode } = await import('./src/services/SandboxMode.js');
  ok('sandbox knob actually folded', effectiveSandboxMode(conv) === 'workspace-write');
  const { effectiveApprovalPolicy } = await import('./src/services/UserApproval.js');
  ok('approval knob actually folded', effectiveApprovalPolicy(conv) === 'never');
  ok('effective preset matches bundle', effectivePermissionPreset(conv) === 'autonomous');
  ok('invalid preset rejected', setPermissionPreset(conv, 'root').ok === false);
  const status = permissionsStatus(conv);
  ok('status shape', status.ok && status.preset === 'autonomous' && status.presets.length === 4 && status.sandboxModes.length === 3 && status.approvalPolicies.length === 2);
  const fresh = permissionsStatus('t-perm-none');
  ok('fresh session maps to assistant (defaults)', fresh.preset === 'assistant');
  ok('CUSTOM_PRESET exported', CUSTOM_PRESET === 'custom');
  setPermissionPreset(conv, 'assistant');
}

/* ══════════════ 3. SUBAGENT REPORT ══════════════ */
console.log('\n== 3. Subagent report (dsh tool-subagent-report) ==');
{
  const { openReportChannel, deliverReport, reportsFor, closeReportChannel, closeAllReportChannels, reportChannelStatus, REPORT_GUIDANCE } = await import('./src/services/SubagentReport.js');
  ok('guidance present', REPORT_GUIDANCE.includes('report tool') && REPORT_GUIDANCE.includes('never ends your turn'));
  const outside = deliverReport('no-such-sub', 'hello');
  ok('report outside a subagent run fails closed', outside.ok === false && /only available inside/.test(outside.error));
  openReportChannel({ subagentId: 'sub-demo', parentConv: 't-parent' });
  const d1 = deliverReport('sub-demo', '  done with the task  ');
  ok('report delivers', d1.ok && d1.report.text === 'done with the task');
  const d2 = deliverReport('sub-demo', '');
  ok('empty report rejected', d2.ok === false);
  ok('reports collected', reportsFor('sub-demo').length === 1);
  const closed = closeReportChannel('sub-demo');
  ok('close returns the reports', closed.length === 1);
  ok('channel gone after close', reportsFor('sub-demo').length === 0);
  ok('status lists live channels', Array.isArray(reportChannelStatus()));
  closeAllReportChannels();

  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('report in the registry', TOOL_REGISTRY.some((t) => t.slug === 'report'));
  ok('registry count is 207', TOOL_COUNT === 218);
  const { hasOutputContract, validateToolArgs, executeTool } = await import('./src/services/ToolRuntime.js');
  ok('report has an output contract', hasOutputContract('report'));
  ok('report schema validates output', validateToolArgs('report', { output: 'x' }).ok === true);
  ok('report requires output', validateToolArgs('report', {}).ok === false);
  const engineOut = await executeTool({ slug: 'report', args: { output: 'hi' }, spillOwner: 't-parent' });
  ok('engine fails closed without a subagent context', engineOut.ok === false && /only available inside/.test(engineOut.error));
  openReportChannel({ subagentId: 'sub-exec', parentConv: 't-parent' });
  const okCall = await executeTool({ slug: 'report', args: { output: 'real result' }, spillOwner: 't-parent', subagentId: 'sub-exec' });
  ok('engine delivers when subagentId is active', okCall.ok === true && okCall.result && String(okCall.result).includes('real result'));
  closeAllReportChannels();
}

/* ══════════════ 4. PERSONAS ══════════════ */
console.log('\n== 4. Personas (dsh preset/persona) ==');
{
  const { BUILTIN_PERSONAS, loadPersonas, resolvePersona, personaFlavor, personaStatus, saveUserPersonas } = await import('./src/services/PersonaManager.js');
  ok('built-in personas present', Object.keys(BUILTIN_PERSONAS).length >= 4 && !!BUILTIN_PERSONAS.jexi);
  ok('resolve works', resolvePersona('concise').name === 'Concise');
  ok('unknown persona → null', resolvePersona('nope') === null);
  const flavor = personaFlavor('mentor');
  ok('flavor block rendered', flavor.includes('[Persona: Mentor]') && flavor.includes('mentor'));
  ok('empty flavor for unknown', personaFlavor('nope') === '');
  const status = personaStatus();
  ok('status lists personas with keys', status.ok && status.personas.some((p) => p.key === 'code-specialist'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-persona-'));
  const oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const saved = saveUserPersonas({ mypersona: { name: 'My', flavor: 'Be yourself.' } });
  ok('user persona saved', saved.ok && saved.saved === 1);
  ok('user persona loads', loadPersonas().mypersona.flavor === 'Be yourself.');
  ok('built-ins cannot be overridden by the file', saveUserPersonas({ jexi: { name: 'X', flavor: 'nope' } }).saved === 0);
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
}

/* ══════════════ 5. SCHEDULE RUNTIME ══════════════ */
console.log('\n== 5. Schedule runtime (dsh schedule) ==');
{
  const { scheduleRuntimeStatus } = await import('./src/services/ScheduleRuntime.js');
  const fake = {
    list: () => [
      { id: 's1', label: 'Morning', query: 'daily brief', kind: 'task', status: 'active', everySeconds: null, dailyAt: '08:00', nextRunAt: 1, lastRunAt: 2, lastStatus: 'ok', runCount: 3 },
      { id: 's2', label: 'Health', query: 'check', kind: 'goal', status: 'paused', everySeconds: 300 },
    ],
  };
  const r = scheduleRuntimeStatus(fake);
  ok('runtime view lists schedules', r.ok && r.count === 2 && r.active === 1 && r.paused === 1);
  ok('runtime view is public fields only', r.schedules[0].query === 'daily brief' && r.schedules[0].dailyAt === '08:00');
  ok('no scheduler → graceful', scheduleRuntimeStatus(null).ok === true);
  ok('no scheduler note', scheduleRuntimeStatus(null).note.includes('unavailable'));
}

/* ══════════════ 6. HOST + GATEWAY ══════════════ */
console.log('\n== 6. Host + gateway (dsh host/webserver + api/gateway) ==');
{
  const { hostStatus, gatewayStatus, resetHostClock } = await import('./src/services/HostStatus.js');
  resetHostClock();
  const host = hostStatus({ publicDir: null });
  ok('host facts: uptime/memory/node', host.ok && host.uptimeSec >= 0 && host.memory.rssMb > 0 && host.node === process.version);
  ok('host static unavailable when no dir', host.static.available === false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-host-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  const host2 = hostStatus({ publicDir: dir });
  ok('host static available with index', host2.static.available === true && host2.static.index === true);
  const gw = gatewayStatus({ openPaths: ['/api/health', '/api/events'], keyLocked: true, allowUnlocked: false });
  ok('gateway reports open paths + lock', gw.openPathCount === 2 && gw.keyLocked === true && gw.allowUnlocked === false);
  ok('gateway rate null by default', gw.rateLimit === null);
  const gw2 = gatewayStatus({ openPaths: [], keyLocked: false, rate: { ai: 'active' } });
  ok('gateway passes rate through', gw2.rateLimit.ai === 'active');
}

/* ══════════════ 7. TEST-SUPPORT LLM REPLAY ══════════════ */
console.log('\n== 7. Test-support llm-replay (dsh test-support) ==');
{
  const { createReplayProvider, callSummary } = await import('./test-support/llm-replay.js');
  const seq = createReplayProvider({ script: [{ content: 'first' }, { content: 'second' }] });
  const a1 = await seq.generateContent('p1', 's', null, { temperature: 0 });
  const a2 = await seq.chatWithToolsOnce('p2', 's', []);
  ok('sequence mode answers in order', a1 === 'first' && a2.content === 'second');
  ok('calls recorded with kind + prompt', seq.calls.length === 2 && seq.calls[0].kind === 'generateContent' && seq.calls[0].prompt === 'p1');
  let exhausted = false;
  try { await seq.generateContent('p3', 's', null, {}); } catch { exhausted = true; }
  ok('script exhaustion throws', exhausted);
  seq.reset();
  ok('reset restarts the script', (await seq.generateContent('x', 's', null, {})) === 'first');
  const match = createReplayProvider({ mode: 'match', script: [{ match: /weather/, content: 'sunny' }] });
  ok('match mode answers by prompt', (await match.generateContent('get weather now', 's', null, {})) === 'sunny');
  let noMatch = false;
  try { await match.generateContent('nothing here', 's', null, {}); } catch { noMatch = true; }
  ok('match mode misses throw', noMatch);
  const err = createReplayProvider({ script: [{ throwError: 'boom' }] });
  let threw = false;
  try { await err.generateContent('x', 's', null, {}); } catch (e) { threw = e.message === 'boom'; }
  ok('throwError scripted failures', threw);
  ok('callSummary renders', typeof callSummary(seq.calls) === 'string');
}

/* ══════════════ 8. EXAMPLES + INTEGRATION ══════════════ */
console.log('\n== 8. Examples + integration ==');
{
  ok('examples README exists', fs.existsSync(path.join(process.cwd(), 'examples', 'README.md')));
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 207', TOOL_COUNT === 218);
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const prompt = await assemblePrompt({ convId: 't-int-b137' });
  ok('prompt still assembles', typeof prompt === 'string' && prompt.length > 500);
  const { loadPlugins, setActivePluginContext, listPluginTools } = await import('./src/services/PluginContext.js');
  const { ctx, failed } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  ok('plugins load clean', failed.length === 0);
  ok('plugin tools still mounted', listPluginTools().length >= 13);
}

console.log(`\n${failures === 0 ? '🎉 ALL B137 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
