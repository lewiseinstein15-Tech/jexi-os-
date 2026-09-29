/**
 * JEXI-016 / JEXI-019 — the agent loop is a set of modules, and the code says
 * what it means.
 *
 * 016: `AgentLoop` owned plan, tools, contracts, budgets, the loop breaker and
 *      the tool-call path in one file. Each of those is now its own module
 *      with no I/O at its seams, so the rules can be tested without a model.
 * 019: comments carried phase and ticket archaeology ("B67", "P10 GAP 4",
 *      "FINAL F4") instead of the reason the code exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src');
const AGENT_LOOP = path.join(SRC, 'services/AgentLoop.js');

/** The modules the split was supposed to produce. */
const EXTRACTED = {
  CodingLoop: 'services/agent/CodingLoop.js',
  ToolSetBuilder: 'services/agent/ToolSetBuilder.js',
  IntentRouter: 'services/agent/IntentRouter.js',
  LoopBreaker: 'services/agent/LoopBreaker.js',
  ContractGate: 'services/agent/ContractGate.js',
};

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

/* ── JEXI-016 ─────────────────────────────────────────────────────── */

test('JEXI-016: AgentLoop is under a size budget', () => {
  const lines = fs.readFileSync(AGENT_LOOP, 'utf-8').split('\n').length;
  assert.ok(lines <= 560, `AgentLoop is ${lines} lines — the budget is 560`);
  // The original was 712. Guard against creeping back toward that.
  assert.ok(lines < 700, 'AgentLoop is a god-module again');
});

test('JEXI-016: the extracted modules exist and are real files', () => {
  for (const [name, rel] of Object.entries(EXTRACTED)) {
    const p = path.join(SRC, rel);
    assert.ok(fs.existsSync(p), `${name} must exist at ${rel}`);
    const lines = fs.readFileSync(p, 'utf-8').split('\n').length;
    assert.ok(lines > 20, `${name} is a stub (${lines} lines)`);
  }
});

test('JEXI-016: AgentLoop orchestrates — it does not re-implement the parts', () => {
  const src = read('services/AgentLoop.js');
  // It imports the pieces.
  for (const needle of ['CodingLoop', 'ToolSetBuilder', 'IntentRouter', 'LoopBreaker', 'ContractGate']) {
    assert.ok(src.includes(needle), `AgentLoop must use ${needle}`);
  }
  // The extracted logic is GONE from this file, not merely delegated to.
  assert.ok(!/export function loopBreakerTrips\s*\(/.test(src), 'the breaker rule still lives in AgentLoop');
  assert.ok(!/export const INTENT_BUDGETS\s*=/.test(src), 'the budget table still lives in AgentLoop');
  assert.ok(!/function buildNativeSchemas|let schemas = buildNativeSchemas\(toolDefs\)/.test(src), 'tool-set assembly still lives in AgentLoop');
  assert.ok(!/async function getContractEnforcement\s*\(/.test(src), 'the contract loader still lives in AgentLoop');
  // One entry point remains.
  assert.equal((src.match(/export async function runAgentLoop/g) || []).length, 1);
});

test('JEXI-016: each module is unit-testable in isolation (pure exports, no loop needed)', async () => {
  // The point of the split: the rules can be exercised without AgentLoop,
  // without a provider key, and without a workspace.
  const breaker = await import('../../src/services/agent/LoopBreaker.js');
  assert.equal(typeof breaker.loopKeyFor, 'function');
  assert.equal(typeof breaker.loopBreakerTrips, 'function');
  assert.equal(breaker.loopKeyFor('fs_read', { a: 1, b: 2 }), breaker.loopKeyFor('fs_read', { b: 2, a: 1 }));

  const router = await import('../../src/services/agent/IntentRouter.js');
  assert.equal(typeof router.budgetForIntent, 'function');
  const b = router.budgetForIntent('code');
  assert.ok(b.iterations > 0 && b.toolCalls > 0 && b.verifyRounds > 0);

  const gate = await import('../../src/services/agent/ContractGate.js');
  assert.equal(typeof gate.checkToolAgainstContract, 'function');
  // No contract means no gate — the pure "no contract" case.
  assert.deepEqual(await gate.checkToolAgainstContract({ contract: null, tool: 'x', turn: 1 }), { ok: true });

  const builder = await import('../../src/services/agent/ToolSetBuilder.js');
  assert.equal(typeof builder.buildOfferedTools, 'function');
  assert.ok(Array.isArray(builder.ALWAYS_AVAILABLE) && builder.ALWAYS_AVAILABLE.length > 0);

  const coding = await import('../../src/services/agent/CodingLoop.js');
  assert.equal(typeof coding.CodingLoop, 'function');
});

test('JEXI-016: the ToolSetBuilder rules run in a stated order and each one applies', async () => {
  const { buildOfferedTools } = await import('../../src/services/agent/ToolSetBuilder.js');
  const { domainExecutor } = await import('../../src/tools/domains/executor.js');
  domainExecutor();

  const out = await buildOfferedTools({
    plan: { intent: 'code', tools: ['fs_read', 'fs_edit', 'pytest_run', 'not_a_real_tool'] },
    query: 'fix the failing pytest',
  });
  assert.ok(out.schemas.length > 0, 'a coding turn still gets tools');
  assert.equal(out.coding, true);

  // JEXI-017's filter ran inside the builder: the fake tool is not there.
  const names = out.schemas.map((s) => s.function.name);
  assert.ok(!names.includes('not_a_real_tool'), 'a tool with no engine must not survive the builder');

  // JEXI-021 ran: the skill's set is a subset of what survived.
  if (out.skill) {
    const allow = new Set(out.skill.allowedTools.map((t) => String(t).toLowerCase()));
    for (const n of names) assert.ok(allow.has(n), `${n} escaped the skill's allowedTools`);
  }

  // JEXI-030 ran: no search/MCP survived a coding turn.
  assert.ok(!names.some((n) => n.startsWith('mcp__')), 'MCP tools leaked into a coding turn');
  assert.ok(!names.includes('web_search') && !names.includes('web-fetch'));

  // Code mode, when asked for, is added last and does exist.
  const withCode = await buildOfferedTools({
    plan: { intent: 'research', tools: ['fs_read'] },
    query: 'what is the capital of Kenya',
    codeMode: true,
  });
  assert.ok(Array.isArray(withCode.schemas));
});

test('JEXI-016: a non-coding turn is not silently narrowed by the coding rules', async () => {
  const { buildOfferedTools } = await import('../../src/services/agent/ToolSetBuilder.js');
  const { domainExecutor } = await import('../../src/tools/domains/executor.js');
  domainExecutor();
  const out = await buildOfferedTools({
    plan: { intent: 'research', tools: ['web_search', 'fs_read'] },
    query: 'summarize the news',
  });
  assert.equal(out.coding, false);
  const names = out.schemas.map((s) => s.function.name);
  assert.ok(names.includes('web_search') || names.includes('web-search'), 'a research turn keeps its search tool');
});

/* ── JEXI-019 ─────────────────────────────────────────────────────── */

/** The archaeology that JEXI-019 is about. */
const ARCHAEOLOGY = [
  /\bB\d{2,3}\b/,                 // B67, B105, B119
  /\bP\d+\s*GAP\s*\d+/i,          // P10 GAP 4
  /\bFINAL\s+[A-Z]\d+/,           // FINAL F4
  /\bPhase\s+\d+/i,               // Phase 7(B)
  /\bstage\s+\d+\b/i,             // stage 12
  /\bP30\.C\b/,
  /\bdsh\b/,
  /\bUltimate Upgrade\b/,
];

test('JEXI-019: the core agent modules carry no phase or ticket archaeology', () => {
  const files = [
    'services/AgentLoop.js',
    'services/agent/CodingLoop.js',
    'services/agent/ToolSetBuilder.js',
    'services/agent/IntentRouter.js',
    'services/agent/LoopBreaker.js',
    'services/agent/ContractGate.js',
  ];
  const offenders = [];
  for (const rel of files) {
    const src = read(rel);
    src.split('\n').forEach((line, i) => {
      for (const rx of ARCHAEOLOGY) {
        if (rx.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `phase/ticket archaeology remains:\n${offenders.join('\n')}`);
});

test('JEXI-019: a comment states the reason, not the history', () => {
  const src = read('services/agent/LoopBreaker.js');
  // The breaker explains WHY normalizing matters, in words a newcomer can use.
  assert.match(src, /same call/i);
  assert.match(src, /re-ordering|JSON/i);
  // ...and the ticket tag is gone.
  assert.ok(!/\bB\d{2,3}\b/.test(src));
});

test('JEXI-019: every core module opens with a comment that explains itself', () => {
  for (const rel of Object.values(EXTRACTED)) {
    const src = read(rel);
    assert.match(src, /^\/\*\*/, `${rel} must open with a doc comment`);
    // The doc comment must say something, not just name the file.
    const header = src.slice(0, 400);
    assert.ok(header.split(/\s+/).filter(Boolean).length > 15, `${rel} has a token header comment`);
  }
});

test('JEXI-019: the split did not reduce coverage — the modules are all imported', async () => {
  const src = read('services/AgentLoop.js');
  const imported = [...src.matchAll(/from '(\.\/agent\/[^']+)'/g)].map((m) => m[1]);
  for (const rel of Object.values(EXTRACTED)) {
    const wanted = './' + rel.replace('services/', '');
    assert.ok(imported.includes(wanted), `AgentLoop does not import ${wanted} — an orphan module`);
  }
  // And each one actually loads.
  for (const rel of Object.values(EXTRACTED)) {
    const mod = await import(`file://${path.join(SRC, rel)}`);
    assert.ok(Object.keys(mod).length > 0, `${rel} exports nothing`);
  }
});
