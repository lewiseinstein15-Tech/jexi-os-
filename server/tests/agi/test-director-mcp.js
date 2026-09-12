/**
 * DIRECTOR LANE × CAPABILITY ROUTER — live MCP data in boss-directed runs
 * (Ultimate Upgrade §7/§11). The interpreter routes live services onto a
 * subtask; the employee session calls them for REAL and grounds the
 * deliverable in actual data. Deterministic shapes + one live weather call
 * (same convention as test-capability-router).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-director-mcp';

const { assembleBrief, runEmployeeSession } = await import('../../src/services/director/EmployeeSession.js');
const { TaskMailbox } = await import('../../src/services/director/AgentMail.js');
const { DirectorTask } = await import('../../src/services/director/TaskState.js');
const { getEmployee } = await import('../../src/services/director/Employees.js');

const GOOD_OUTPUT = ['## REPORT', 'Used the live data.', '', '## DELIVERABLE', 'The answer, grounded in the real service output.', '', '## CONFIDENCE', 'high'].join('\n');

function fakeEmployee() {
  const z = getEmployee('zola');
  // D2: the session now carries the employee's MCP grants — this test's fake
  // employee runs a WEATHER lane,so it grants weather (deterministic: no keys,
  // the real weather server is curated+enabled and this assertion keeps the live
  // call honest;every OTHER server stays denied by default).
  return { ...z, supportedTools: ['web-search', 'memory-recall'], allowedMCP: [{ server: 'weather', tools: ['*'] }] };
}

/* ═══ brief shape ═══════════════════════════════════════════════════════════ */

test('assembleBrief carries the interpreter-routed mcpCalls (capped at 3)', () => {
  const task = new DirectorTask({ conversationId: 'c1', rawQuery: 'weather', objective: 'weather', successCriteria: [] });
  const subtask = {
    id: 'st1', title: 'get weather', capability: 'research', searchQueries: [],
    mcpCalls: [
      { server: 'weather', tool: 'get_weather_summary', args: { city_name: 'Nairobi' } },
      { server: 'weather', tool: 'get_forecast', args: {} },
      { server: 'arxiv', tool: 'search', args: { q: 'x' } },
      { server: 'weather', tool: 'get_alerts', args: {} }, // 4th → dropped
    ],
  };
  const brief = assembleBrief({ task, subtask, employee: fakeEmployee(), dependencies: [] });
  assert.equal(brief.mcpCalls.length, 3);
  assert.equal(brief.mcpCalls[0].server, 'weather');
  // and without mcpCalls the brief stays exactly as before
  const plain = assembleBrief({ task, subtask: { id: 'st2', title: 'x', capability: 'research' }, employee: fakeEmployee(), dependencies: [] });
  assert.deepEqual(plain.mcpCalls, []);
});

/* ═══ live data phase — real weather call, grounded prompt ═════════════════ */

test('a routed mcpCall runs for REAL and lands in the employee context', { timeout: 240_000 }, async () => {
  // pre-warm: on a cold CI runner the weather server's npx boot can take
  // over a minute — connect it through the gateway's 150s boot budget first
  // so the session's own call is warm (mirrors what the prewarm step does in
  // production images).
  const { connectGatewayServer } = await import('../../src/services/MCPGateway.js');
  const warm = await connectGatewayServer('weather');
  assert.ok(warm.ok, `weather pre-warm failed: ${warm.error}`);
  const task = new DirectorTask({ conversationId: 'c2', rawQuery: 'weather in Kericho', objective: 'weather in Kericho', successCriteria: [] });
  const subtask = {
    id: 'st1', title: 'Fetch current weather for Kericho', capability: 'research', searchQueries: [],
    mcpCalls: [{ server: 'weather', tool: 'get_weather_summary', args: { city_name: 'Kericho' } }],
  };
  const employee = fakeEmployee();
  const brief = assembleBrief({ task, subtask, employee, dependencies: [] });
  const mailbox = new TaskMailbox(task.id);
  const events = [];
  let seenUserPrompt = '';
  try {
    await runEmployeeSession({
      task, subtask, employee, brief, mailbox,
      hooks: { onEvent: (e) => events.push(e) },
      llm: async (p) => { if (p && p.user) seenUserPrompt = String(p.user); return GOOD_OUTPUT; },
      tools: { search: async () => 'results' },
    });
  } catch { /* session outcome irrelevant — the phase is the assertion */ }
  // the phase ran the REAL gateway call
  const started = events.filter((e) => e.type === 'TOOL_STARTED' && /live data/i.test(e.summary || ''));
  assert.ok(started.length === 1, `expected one live-data TOOL_STARTED, got ${JSON.stringify(events.map((e) => e.type))}`);
  assert.match(started[0].summary, /weather/);
  const completed = events.filter((e) => e.type === 'TOOL_COMPLETED' && /live data received/i.test(e.summary || ''));
  assert.ok(completed.length === 1, 'live data must be received');
  // the model prompt contains the REAL data block
  assert.match(seenUserPrompt, /\[live data from the "weather" service/);
  // real weather content reached the model (temperature/wind/condition family)
  assert.ok(/temp|wind|condition|weather|°/i.test(seenUserPrompt), 'real weather data expected in the model prompt');
});

test('an unavailable service fails HONESTLY and the session continues', { timeout: 60_000 }, async () => {
  const task = new DirectorTask({ conversationId: 'c3', rawQuery: 'x', objective: 'x', successCriteria: [] });
  const subtask = {
    id: 'st1', title: 'call a dead service', capability: 'research', searchQueries: [],
    mcpCalls: [{ server: 'no-such-server', tool: 'no_such_tool', args: {} }],
  };
  const employee = fakeEmployee();
  const brief = assembleBrief({ task, subtask, employee, dependencies: [] });
  const mailbox = new TaskMailbox(task.id);
  const events = [];
  let reachedModel = false;
  try {
    await runEmployeeSession({
      task, subtask, employee, brief, mailbox,
      hooks: { onEvent: (e) => events.push(e) },
      llm: async () => { reachedModel = true; return GOOD_OUTPUT; },
      tools: {},
    });
  } catch { /* non-fatal by design */ }
  const failed = events.filter((e) => e.type === 'TOOL_FAILED' && /live data/i.test(e.summary || ''));
  assert.ok(failed.length >= 1, 'a TOOL_FAILED event must fire for the dead service');
  assert.ok(reachedModel, 'the model phase still runs — MCP failure is not fatal');
});

/* ═══ cleanup: close the live connection the test opened ═══════════════════ */
/* ═══ D2 — per-agent MCP grant gate (deny-by-default) ═════════════════ */

function fakeConnector(seen) {
  return {
    listTools: async function () {
      return { tools: [{ name: 'get_weather_summary', description: '', inputSchema: { type: 'object', properties: {} } }] };
    },
    callTool: async function (c) {
      seen.push(c.name);
      return { content: [{ type: 'text', text: 'ok 21C' }] };
    },
  };
}

test('an employee with NO grants is denied EVERY MCP call before any connect', async () => {
  const { invokeMcpTool, __setConnector, __resetGateway } = await import('../../src/services/MCPGateway.js');
  __resetGateway();
  let connected = false;
  __setConnector(async function () {
    connected = true;
    return fakeConnector([]);
  });
  const r = await invokeMcpTool({ server: 'weather', tool: 'get_weather_summary', mcpGrants: [] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('no MCP grant'), r.error);
  assert.equal(connected, false, 'deny must happen BEFORE any connect');
  __resetGateway();
});

test('an employee with a weather-only grant: weather passes, other servers denied', async () => {
  const { invokeMcpTool, __setConnector, __resetGateway, connectGatewayServer } = await import('../../src/services/MCPGateway.js');
  __resetGateway();
  const seen = [];
  __setConnector(async function () {
    return fakeConnector(seen);
  });
  const grants = [{ server: 'weather', tools: ['*'] }];
  const warm = await connectGatewayServer('weather');
  assert.ok(warm.ok, warm.error || 'connect failed');
  const okCall = await invokeMcpTool({ server: 'weather', tool: 'get_weather_summary', args: { city: 'Nairobi' }, mcpGrants: grants });
  assert.equal(okCall.ok, true);
  assert.ok(okCall.result.content[0].text.includes('ok 21C'), 'weather call must reach the fake server');
  const denied = await invokeMcpTool({ server: 'git', tool: 'status', mcpGrants: grants });
  assert.equal(denied.ok, false);
  assert.ok(denied.error.includes("no MCP grant for server 'git'"), denied.error);
  __resetGateway();
});
/* ═══ cleanup: close the live connection the test opened ═══════════════════ */

/* ═══ D2 — the 9 Director employees' grants resolve against the shipped registry ═══ */

test('all 9 Director employees: every declared grant names a real, ENABLED server', async () => {
  const MCPG = await import('../../src/services/MCPGateway.js');
  const reg = MCPG.loadRegistry();
  const enabled = new Set();
  for (const s of reg.servers) {
    if (s.enabled === true) enabled.add(s.name);
  }
  const EMP = await import('../../src/services/director/Employees.js');
  const employees = EMP.loadEmployees();
  assert.equal(employees.length, 9);
  for (const e of employees) {
    assert.ok(Array.isArray(e.allowedMCP));
    for (const g of e.allowedMCP) {
      const okServer = enabled.has(g.server);
      const okTools = Array.isArray(g.tools);
      assert.ok(typeof g.server === 'string');
      assert.ok(okServer);
      assert.ok(okTools);
      assert.ok(g.tools.length > 0);
    }
  }
});

test('cleanup: gateway connections closed', async () => {
  const { disconnectGatewayServer } = await import('../../src/services/MCPGateway.js');
  await disconnectGatewayServer('weather');
});
