#!/usr/bin/env node
/**
 * B136 — JEXI HEADLESS CLI (DeepSeek Harness `packages/bundle/headless`
 * mirror, JEXI-branded).
 *
 * Run JEXI without the server: one question in, one answer out, through the
 * SAME pipeline the web app uses (Planner routing → tool-calling loop /
 * direct path). No HTTP, no UI.
 *
 *   node cli.js "what time is it in Nairobi?"        # one turn
 *   node cli.js --self-test                          # offline determinism checks
 *   node cli.js --list                               # built-in commands
 *   node cli.js --conv <id> "…"                      # continue a conversation
 *   node cli.js --json "…"                           # machine-readable output
 *
 * Exit codes: 0 success, 1 error, 2 usage error.
 */

import { loadPlugins, setActivePluginContext } from './src/services/PluginContext.js';
import { TOOL_REGISTRY, TOOL_COUNT } from './src/services/ToolRegistry.js';
import { projectSession } from './src/services/SessionProjection.js';
import { checkFsOperation } from './src/services/FsSandbox.js';
import { loadBaselineInstructionSet } from './src/services/AgentInstructions.js';
import { WORKSPACE_DIR } from './src/config.js';

/* ---------------- self-test (offline, deterministic) ---------------- */

async function selfTest() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) });

  check('registry loads', TOOL_COUNT > 0, `${TOOL_COUNT} tools`);
  check('dsh lifecycle tools present', TOOL_REGISTRY.some((t) => t.slug === 'subagent')
    && TOOL_REGISTRY.some((t) => t.slug === 'todo')
    && TOOL_REGISTRY.some((t) => t.slug === 'plan')
    && TOOL_REGISTRY.some((t) => t.slug === 'ralph'),
    'subagent/todo/plan/ralph');

  const { ctx, failed } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  check('plugins load', failed.length === 0, failed.map((f) => f.file).join(', '));

  const proj = projectSession({ convId: 'cli-self-test', maxChars: 400 });
  check('session projection ok', proj.ok === true && Array.isArray(proj.events), `${proj.events.length} events`);

  const gate = checkFsOperation({ op: 'write', target: '/etc/passwd', workspaceRoot: WORKSPACE_DIR, mode: 'workspace-write' });
  check('fs sandbox fails closed outside workspace', gate.allowed === false, gate.reason);

  const inside = checkFsOperation({ op: 'write', target: `${WORKSPACE_DIR}/x.txt`, workspaceRoot: WORKSPACE_DIR, mode: 'workspace-write' });
  check('fs sandbox allows workspace writes', inside.allowed === true);

  const instructions = loadBaselineInstructionSet({ root: WORKSPACE_DIR });
  check('agent instructions load (0 is fine)', Array.isArray(instructions), `${instructions.length} files`);

  const passed = results.filter((r) => r.ok).length;
  const out = { ok: passed === results.length, total: results.length, passed, results };
  return out;
}

/* ---------------- one headless turn ---------------- */

async function runTurn(query, { conv = null } = {}) {
  const { Planner } = await import('./src/services/Planner.js');
  const { runAgentLoop } = await import('./src/services/AgentLoop.js');
  const events = [];
  let plan;
  try {
    plan = await Planner.analyzeIntent(query);
  } catch {
    plan = { intent: 'research', teamSlugs: ['researcher'] };
  }
  const emit = (t, d) => events.push({ type: t, ...(d || {}) });
  const started = Date.now();
  const res = await runAgentLoop({ query, sendEvent: emit, opts: { convId: conv || `cli-${Date.now()}` } });
  const durationMs = Date.now() - started;

  return {
    ok: !!res.answer && !res.cancelled,
    answer: String(res.answer || '').trim(),
    cancelled: !!res.cancelled,
    intent: plan.intent,
    events: events.slice(-30),
    stats: res.stats || { toolCalls: 0, durationMs },
    conv: conv || null,
  };
}

/* ---------------- main ---------------- */

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`JEXI OS — headless CLI (dsh bundle/headless mirror, JEXI-branded)

USAGE
  node cli.js "<question>"            run one headless turn (same pipeline as the web app)
  node cli.js --json "<question>"     machine-readable result (single JSON object)
  node cli.js --conv <id> "<question>" continue a conversation (its log feeds the projection)
  node cli.js --list                  list built-in commands
  node cli.js --self-test             offline determinism checks (registry, fs sandbox, projection)

EXIT CODES
  0 success · 1 run error · 2 usage error`);
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 2);
}

if (args.includes('--self-test')) {
  const out = await selfTest();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

if (args.includes('--list')) {
  const { listCommands } = await import('./src/services/CommandRegistry.js');
  const commands = listCommands();
  console.log(JSON.stringify({ commands }, null, 2));
  process.exit(0);
}

let conv = null;
const convAt = args.indexOf('--conv');
if (convAt >= 0 && args[convAt + 1]) {
  conv = args[convAt + 1];
  args.splice(convAt, 2);
}
const json = args.includes('--json');
if (json) args.splice(args.indexOf('--json'), 1);

const query = args.join(' ').trim();
if (!query) {
  console.error('jexi: no question given (try --help)');
  process.exit(2);
}

try {
  const out = await runTurn(query, { conv });
  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    if (out.answer) console.log(out.answer);
    else console.error(out.cancelled ? '(cancelled)' : '(no answer — check provider keys)');
  }
  process.exit(out.ok ? 0 : 1);
} catch (e) {
  console.error('jexi:', (e && e.message) || e);
  process.exit(1);
}
