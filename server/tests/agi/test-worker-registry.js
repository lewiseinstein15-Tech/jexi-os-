/**
 * WORKFORCE REGISTRY + TWO-STAGE ROUTER + MCP GRANT GATE (Phase 2, Scope D).
 *
 * Deterministic and keyless. Uses a DATA_DIR override with a controlled
 * employees.json roster so the assertions never depend on the default team.
 *
 * The five-worker roster under test:
 *
 *   { nueva, canwrite:true,  code:{bugfix,test}, enabled:true }   write-capable coder
 *   { strict, canwrite:false, code:{bugfix} }                      read-only coding analyst
 *   { paper,  none }                                             research analyst
 *   { dupe-a, code:{bugfix} }  description ~= dupe-b               near-duplicate pair
 *   { dupe-b, code:{bugfix} }  description ~= dupe-a
 *
 * Contracts asserted:
 *
 *   1. OVERLAP — registration with strict:true refuses near-identical
 *      agents sharing a slot (>= OVERLAP_THRESHOLD).
 *   2. DISTINCT CODERINGPOWER — "Fix this bug and run the tests" resolves to
 *      EXACTLY ONE agent.
 *   3. READ vs WRITE — the read-only coding analyst and the write-capable
 *      coder are DIFFERENT agents; read-only work never resolves to the
 *      write coder, and write-required work never resolves to the analyst.
 *   4. MCP GRANT GATE — no grants => denied; weather grant => weather works,
 *      every other server/tool denied.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-workforce-'));
process.env.DATA_DIR = DATA_DIR;

const ROSTER = {
  employees: [
    {
      agentId: 'nueva', displayName: 'Nueva', role: 'Senior Engineer',
      description: 'Designs, implements, and repairs code. Owns engineering deliverables end to end.',
      capabilities: ['code', 'planning', 'reasoning'],
      supportedTools: ['file-write', 'run-command', 'web-search'],
      allowedMCP: [],
      permissions: ['READ', 'WRITE', 'EXECUTE', 'NETWORK'],
    },
    {
      agentId: 'strict', displayName: 'Strict', role: 'Coding Analyst',
      description: 'Reads and reviews code, writes analysis, runs tests read-only.',
      capabilities: ['code', 'verification', 'analysis'],
      supportedTools: ['web-search', 'memory-recall'],
      allowedMCP: [],
      permissions: ['READ'],
    },
    {
      agentId: 'paper', displayName: 'Paper', role: 'Research Analyst',
      description: 'Finds and compares sources, synthesizes findings.',
      capabilities: ['research'],
      supportedTools: ['web-search'],
      allowedMCP: [],
      permissions: ['READ'],
    },
    {
      agentId: 'dupe-a', displayName: 'Dupe A', role: 'Regression Tester',
      description: 'Runs the regression suite and reports failures.',
      capabilities: ['verification', 'data'],
      supportedTools: [],
      allowedMCP: [],
      permissions: ['READ'],
    },
    {
      agentId: 'dupe-b', displayName: 'Dupe B', role: 'Regression Tester',
      description: 'Runs the regression suite and reports failures.',
      capabilities: ['verification', 'data'],
      supportedTools: [],
      allowedMCP: [],
      permissions: ['READ'],
    },
  ],
};
fs.mkdirSync(path.join(DATA_DIR, 'director-history'), { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'employees.json'), JSON.stringify(ROSTER));

const reg = await import('../../src/workforce/registry/index.js');
const router = await import('../../src/workforce/registry/router.js');
const gate = await import('../../src/workforce/mcp-gate.js');

test('registration indexes every enabled agent by capability token', () => {
  const { agents } = reg.registerAll();
  assert.equal(agents, 5);
  const coders = reg.findByCapability('code');
  assert.deepEqual(coders.map((a) => a.agentId).sort(), ['nueva', 'strict']);
  assert.equal(reg.getByAgentId('nueva').permissions.includes('WRITE'), true);
});

test('OVERLAP — near-identical agents in the same slot are refused at registration (>= 0.85)', () => {
  reg.registerAll();
  const violations = reg.validateOverlaps();
  const pair = violations.find((v) => (v.a === 'dupe-a' && v.b === 'dupe-b') || (v.a === 'dupe-b' && v.b === 'dupe-a'));
  assert.ok(pair, `expected dupe-a/dupe-b overlap violation, got ${JSON.stringify(violations)}`);
  assert.ok(pair.overlap >= 0.85);
  // and the well-differentiated pair is NOT flagged
  const clean = violations.filter((v) => v.a === 'nueva' || v.b === 'nueva');
  assert.ok(clean.length === 0, `nueva should not overlap anyone: ${JSON.stringify(clean)}`);
});

test('DESCRIPTION BUDGET — the catalog stays under the token budget', () => {
  const budget = reg.checkCatalogBudget();
  assert.equal(budget.ok, true);
  // and an over-budget catalog is refused honestly
  const burst = reg.checkCatalogBudget([{ description: 'word '.repeat(20000), capabilities: ['x'], role: 'y' }], 15000);
  assert.equal(burst.ok, false);
});

test('DISTINCT AGENCY — "Fix this bug and run the tests" resolves to EXACTLY ONE agent', () => {
  const r = router.routeRequest('Fix this bug and run the tests');
  assert.equal(r.agents.length, 1);
  assert.equal(r.agents[0].agentId, 'nueva'); // write-capable coder, mutation implied
  assert.equal(r.mutation, true);
  assert.equal(r.requirements.includes('code'), true);
  assert.equal(r.requirements.includes('verification'), true);
});

test('READ vs WRITE — the coding analyst and the writer are DIFFERENT agents', () => {
  const { writable, readOnly } = router.codingAgents();
  assert.equal(writable.agentId, 'nueva');
  assert.equal(readOnly.agentId, 'strict');
  assert.notEqual(writable.agentId, readOnly.agentId);

  // read-only work never resolves to the write coder
  const readWork = router.routeRequest('review this code and report issues');
  assert.ok(!readWork.agent || readWork.agent.agentId !== 'nueva');
  // write-required work never resolves to the read-only analyst
  const writeWork = router.routeRequest('fix this bug and write the files', { requireWrite: true });
  assert.equal(writeWork.agent.agentId, 'nueva');
});

test('lightweight/no-requirement requests resolve to NO agent', () => {
  const r = router.routeRequest('hello');
  assert.equal(r.agent, null);
  assert.equal(r.agents.length, 0);
});

/* ═══ MCP GRANT GATE — deny by default ════════════════════════════════════ */

test('MCP gate — agent with NO grants is DENIED every server/tool', () => {
  const grants = [];
  const denied = gate.authorizeMcpCall(grants, 'weather', 'get_weather_summary');
  assert.equal(denied.allowed, false);
  assert.equal(denied.denial, gate.DENY_DEFAULT);
  assert.ok(denied.reason.includes('no MCP grants'));
});

test('MCP gate — weather grant allows weather, denies every other server', () => {
  const grants = [{ server: 'weather', tools: ['*'] }];
  assert.equal(gate.authorizeMcpCall(grants, 'weather', 'get_weather_summary').allowed, true);
  assert.equal(gate.authorizeMcpCall(grants, 'weather', 'get_forecast').allowed, true);
  // un-granted server -> denied, not silently allowed
  const other = gate.authorizeMcpCall(grants, 'arxiv', 'search');
  assert.equal(other.allowed, false);
  assert.equal(other.denial, 'arxiv:ungranted');
});

test('MCP gate — per-tool grants allow only listed tools on the server', () => {
  const grants = [{ server: 'git', tools: ['status', 'diff'] }];
  assert.equal(gate.authorizeMcpCall(grants, 'git', 'status').allowed, true);
  assert.equal(gate.authorizeMcpCall(grants, 'git', 'diff').allowed, true);
  const push = gate.authorizeMcpCall(grants, 'git', 'push');
  assert.equal(push.allowed, false);
  assert.ok(push.reason.includes("not granted on server 'git'"));
});

test('MCP gate — missing/unrecognized server is always denied', () => {
  const grants = [{ server: 'weather', tools: ['*'] }];
  assert.equal(gate.authorizeMcpCall(grants, '', 'get_weather_summary').allowed, false);
  assert.equal(gate.authorizeMcpCall(grants, 'unknown', 'anything').allowed, false);
});

/* ═══ cleanup ═════════════════════════════════════════════════════════════ */

test.after(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
});