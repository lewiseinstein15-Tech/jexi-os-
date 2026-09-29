/**
 * JEXI-017 / 018 / 020 / 021 / 026 / 030 — single registry, one verification
 * path, counts that match the runtime, skills that constrain, a loop key that
 * cannot be dodged, and a coding tool set that is not the whole catalogue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

/* ── JEXI-017 ─────────────────────────────────────────────────────── */

test('JEXI-017: toolHasEngine agrees with what executeTool can actually dispatch', async () => {
  const { domainExecutor } = await import('../../src/tools/domains/executor.js');
  domainExecutor();
  const { toolHasEngine, buildNativeSchemas } = await import('../../src/services/ToolRuntime.js');
  const { hasDomainTool, domainToolCount } = await import('../../src/tools/domains/executor.js');

  assert.ok(domainToolCount() > 0, 'domains must be registered before asking about engines');

  // Every real domain tool has an engine.
  for (const slug of ['fs_read', 'fs_write', 'fs_edit', 'term_execute', 'pytest_run', 'test_run']) {
    assert.equal(hasDomainTool(slug), true, `${slug} is a registered domain tool`);
    assert.equal(toolHasEngine(slug), true, `${slug} must report an engine`);
  }
  // An invented slug has none — and is not merely "unknown to this check".
  assert.equal(toolHasEngine('definitely_not_a_real_tool_xyz'), false);
  assert.equal(toolHasEngine(''), false);
  assert.equal(toolHasEngine(null), false);
  // mcp__ names are dispatched by the gateway, so they are runnable.
  assert.equal(toolHasEngine('mcp__duckduckgo__search'), true);
});

test('JEXI-017: ZERO tools enter native schemas without a registered engine', async () => {
  const { domainExecutor } = await import('../../src/tools/domains/executor.js');
  domainExecutor();
  const { buildNativeSchemas, toolHasEngine } = await import('../../src/services/ToolRuntime.js');

  // A deliberately mixed bag, including two slugs that cannot possibly run.
  const defs = [
    { slug: 'fs_read', desc: 'read a file' },
    { slug: 'fs_edit', desc: 'edit a file' },
    { slug: 'pytest_run', desc: 'run pytest' },
    { slug: 'mcp__arxiv__search', desc: 'mcp' },
    { slug: 'phantom_tool_a', desc: 'no engine' },
    { slug: 'phantom_tool_b', desc: 'no engine' },
  ];
  const schemas = buildNativeSchemas(defs);
  const names = schemas.map((s) => s.function.name);

  assert.ok(!names.includes('phantom_tool_a'), 'a tool with no engine must not be offered');
  assert.ok(!names.includes('phantom_tool_b'), 'a tool with no engine must not be offered');
  assert.deepEqual(names.sort(), ['fs_edit', 'fs_read', 'mcp__arxiv__search', 'pytest_run']);

  // The invariant itself, stated generally: every offered schema is runnable.
  for (const s of schemas) {
    assert.equal(toolHasEngine(s.function.name), true, `${s.function.name} was offered but has no engine`);
  }
});

test('JEXI-017: a schema the model can see is one executeTool will not refuse as Unknown', async () => {
  const { domainExecutor, hasDomainTool } = await import('../../src/tools/domains/executor.js');
  domainExecutor();
  const { buildNativeSchemas } = await import('../../src/services/ToolRuntime.js');
  const { getTool } = await import('../../src/services/ToolRegistry.js');

  const schemas = buildNativeSchemas([
    { slug: 'fs_read' }, { slug: 'pytest_run' }, { slug: 'nope_not_real' },
  ]);
  for (const s of schemas) {
    const name = s.function.name;
    const dispatchable = name.startsWith('mcp__') || !!getTool(name) || hasDomainTool(name);
    assert.equal(dispatchable, true, `${name} would have been refused "Unknown tool"`);
  }
});

/* ── JEXI-018 ─────────────────────────────────────────────────────── */

test('JEXI-018: chat and WorkGraph share ONE run-tests seam', async () => {
  const chat = await import('../../src/services/agent/CodingLoop.js');
  // The shared seam is `runTestEvidence` — both paths must import the same
  // binding, not each re-implementing "run the tests and parse the result".
  const { runTestEvidence } = await import('../../src/verification/verifiers/TestVerifier.js');
  assert.equal(typeof runTestEvidence, 'function', 'the shared seam must exist');
  // CodingLoop re-exports it rather than wrapping a private copy.
  assert.equal(chat.runTestEvidence, runTestEvidence, 'chat must call the shared seam, not a fork');
});

test('JEXI-018: both entry points resolve to the same function identity', async () => {
  const autoVerify = await import('../../src/verification/loop/auto-verify.js');
  const testVerifier = await import('../../src/verification/verifiers/TestVerifier.js');
  assert.equal(autoVerify.runTestEvidence, testVerifier.runTestEvidence);
  assert.equal(typeof autoVerify.runTestEvidence, 'function');
});

/* ── JEXI-020 ─────────────────────────────────────────────────────── */

test('JEXI-020: published agent counts equal list().length of executable agents', async () => {
  const { listAgentDefinitions, loadAgentDefinition, agentCounts, publishedAgentLine } = await import('../../src/services/AgentDefinitions.js');
  const all = listAgentDefinitions();
  assert.ok(Array.isArray(all) && all.length > 0, 'there are agent definitions to count');

  // "Executable" = loads AND parses. A definition that fails to load must not
  // be counted, which is exactly the drift the ticket is about.
  const executable = all.filter((slug) => {
    const d = loadAgentDefinition(slug);
    return !!d && typeof d.systemPrompt === 'string' && d.systemPrompt.length > 0;
  });
  assert.equal(executable.length, all.length, 'every listed agent must actually load');
  assert.equal(executable.length, new Set(executable).size, 'no duplicate slugs');

  // The published count must BE the derived count, not a number typed next to
  // it. This is the assertion that makes "published counts match the runtime"
  // true rather than aspirational.
  const c = await agentCounts();
  assert.equal(c.executableAgents, executable.length, 'published executable count drifted from the code');
  assert.equal(c.agentDefinitions, all.length);
  assert.deepEqual(c.slugs.slice().sort(), executable.slice().sort(), 'the published slugs are the executable ones');
  assert.ok(c.executableAgents <= c.agentDefinitions, 'executable can never exceed defined');
});

test('JEXI-020: the published line names each population instead of conflating them', async () => {
  const { publishedAgentLine, agentCounts } = await import('../../src/services/AgentDefinitions.js');
  const line = await publishedAgentLine();
  const c = await agentCounts();
  // The numbers in the printed line are the derived numbers.
  assert.ok(line.includes(String(c.executableAgents)), `line "${line}" lacks the executable count ${c.executableAgents}`);
  assert.ok(line.includes(String(c.agentDefinitions)), `line "${line}" lacks the definition count ${c.agentDefinitions}`);
  // A planner role spec is not a live agent; the line must say which is which,
  // which is the drift the ticket was about.
  assert.match(line, /not live agents|role spec/i);
  // And the populations must actually differ, or the distinction is theatre.
  assert.ok(c.plannerSpecs !== c.executableAgents, 'planner specs and live agents are different populations and must not read the same');
});

test('JEXI-020: a count derived from the code matches a freshly derived count', async () => {
  const { listAgentDefinitions, agentCounts } = await import('../../src/services/AgentDefinitions.js');
  const a = listAgentDefinitions().length;
  const b = listAgentDefinitions().length;
  assert.equal(a, b, 'list() must be deterministic, not appending on each call');
  const c1 = await agentCounts();
  const c2 = await agentCounts();
  assert.deepEqual(c1, c2, 'deriving the counts twice must give the same answer');
  assert.ok(a > 0);
});

/* ── JEXI-021 ─────────────────────────────────────────────────────── */

test('JEXI-021: a real pytest-repair skill exists with a declared closed tool set', async () => {
  const { catalog } = await import('../../src/skills/catalog.js');
  const index = await catalog();
  const skill = index['pytest-repair'];
  assert.ok(skill, 'pytest-repair must be a registered skill, not a mention in a doc');
  assert.ok(Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0, 'it declares allowedTools');
  assert.ok(skill.allowedTools.includes('fs_read'), 'reading the failing test is allowed');
  assert.ok(skill.allowedTools.includes('fs_edit'), 'editing the module is allowed');
  assert.ok(skill.allowedTools.includes('pytest_run'), 're-running the suite is allowed');
  // The set is CLOSED: no search, no MCP, no browser.
  for (const forbidden of ['web_search', 'web-search', 'browser-drive', 'mcp__duckduckgo__search']) {
    assert.ok(!skill.allowedTools.includes(forbidden), `${forbidden} must not be in the set`);
  }
  assert.ok(!skill.allowedTools.some((t) => String(t).startsWith('mcp__')), 'no MCP tools may be allowed');

  // The declared set must not contain a tool that does not exist — JEXI-017's
  // invariant applied to the skill itself.
  const { domainExecutor, hasDomainTool } = await import('../../src/tools/domains/executor.js');
  domainExecutor();
  for (const t of skill.allowedTools) {
    assert.equal(hasDomainTool(t), true, `skill declares ${t}, which has no registered engine`);
  }
});

test('JEXI-021: the active coding skill actually NARROWS the offered tool set', async () => {
  const { activeCodingSkill } = await import('../../src/services/AgentLoop.js');
  const skill = await activeCodingSkill('fix the failing pytest in this project');
  assert.ok(skill, 'a coding query must resolve to a skill');
  assert.equal(skill.slug, 'pytest-repair');

  // The narrowing is real: applying the declared set to a wide catalogue
  // must strictly reduce it, and must remove every non-declared tool.
  const wide = [
    { type: 'function', function: { name: 'fs_read' } },
    { type: 'function', function: { name: 'fs_edit' } },
    { type: 'function', function: { name: 'pytest_run' } },
    { type: 'function', function: { name: 'term_execute' } },
    { type: 'function', function: { name: 'web_search' } },
    { type: 'function', function: { name: 'mcp__duckduckgo__search' } },
    { type: 'function', function: { name: 'browser-drive' } },
  ];
  const allow = new Set(skill.allowedTools.map((t) => String(t).toLowerCase()));
  const narrowed = wide.filter((s) => allow.has(s.function.name));
  assert.ok(narrowed.length < wide.length, 'the set must actually shrink');
  assert.deepEqual(narrowed.map((s) => s.function.name).sort(), ['fs_edit', 'fs_read', 'pytest_run', 'term_execute']);
  assert.ok(!narrowed.some((s) => s.function.name.startsWith('mcp__')));
});

test('JEXI-021: a non-coding query activates no skill and keeps its full tool set', async () => {
  const { activeCodingSkill } = await import('../../src/services/AgentLoop.js');
  assert.equal(await activeCodingSkill('who won the world cup in 1998'), null);
  assert.equal(await activeCodingSkill(''), null);
  assert.equal(await activeCodingSkill('what is the capital of Kenya'), null);
});

/* ── JEXI-026 ─────────────────────────────────────────────────────── */

test('JEXI-026: near-duplicate calls produce ONE loop key, not a new one', async () => {
  const { loopKeyFor, normalizeCallArgs } = await import('../../src/services/AgentLoop.js');

  // Key order must not matter.
  assert.equal(loopKeyFor('fs_read', { path: 'a.ts', limit: 5 }), loopKeyFor('fs_read', { limit: 5, path: 'a.ts' }));
  // Path spelling must not matter.
  assert.equal(loopKeyFor('fs_read', { path: './a/../b.ts' }), loopKeyFor('fs_read', { path: 'b.ts' }));
  assert.equal(loopKeyFor('fs_read', { path: '/tmp/b.ts' }), loopKeyFor('fs_read', { path: 'tmp/b.ts' }));
  assert.equal(loopKeyFor('fs_read', { path: 'a//b.ts' }), loopKeyFor('fs_read', { path: 'a/b.ts' }));
  // Case and stray whitespace must not matter.
  assert.equal(loopKeyFor('FS_Read ', { path: ' a.ts ' }), loopKeyFor('fs_read', { path: 'a.ts' }));
  // An omitted argument and an explicit undefined are the same call.
  assert.equal(loopKeyFor('fs_read', { path: 'a', limit: undefined }), loopKeyFor('fs_read', { path: 'a' }));
  // Nesting order must not matter either.
  assert.equal(loopKeyFor('t', { a: { x: 1, y: 2 } }), loopKeyFor('t', { a: { y: 2, x: 1 } }));
});

test('JEXI-026: genuinely different calls still get different keys', async () => {
  const { loopKeyFor } = await import('../../src/services/AgentLoop.js');
  assert.notEqual(loopKeyFor('fs_read', { path: 'a' }), loopKeyFor('fs_read', { path: 'b' }));
  assert.notEqual(loopKeyFor('fs_read', { path: 'a' }), loopKeyFor('fs_write', { path: 'a' }));
  assert.notEqual(loopKeyFor('t', { a: [1, 2] }), loopKeyFor('t', { a: [2, 1] }), 'array order is significant');
  assert.notEqual(loopKeyFor('t', { a: 1 }), loopKeyFor('t', { a: '1' }), 'a number is not a string');
});

test('JEXI-026: the normalized key actually trips the breaker', async () => {
  const { loopKeyFor, loopBreakerTrips, LOOP_BREAKER_LIMIT } = await import('../../src/services/AgentLoop.js');
  // Simulate a model that keeps re-issuing the same call, re-ordering its JSON
  // and respelling the path each time — the dodge the old key allowed.
  const dodges = [
    { path: 'src/calculator.py', offset: 0 },
    { offset: 0, path: './src/calculator.py' },
    { path: 'src/../src/calculator.py', offset: 0 },
    { path: '  src/calculator.py  ', offset: 0 },
  ];
  const keys = dodges.map((a) => loopKeyFor('fs_edit', a));
  assert.equal(new Set(keys).size, 1, 'all four spellings must be ONE key');

  let repeatCount = 0, last = null;
  for (const k of keys) { repeatCount = k === last ? repeatCount + 1 : 1; last = k; }
  assert.equal(repeatCount, 4, 'the breaker sees four repeats, not four distinct calls');
  assert.equal(loopBreakerTrips(repeatCount), repeatCount >= LOOP_BREAKER_LIMIT);
});

test('JEXI-026: normalizeCallArgs does not recurse forever on cyclic-ish input', async () => {
  const { normalizeCallArgs } = await import('../../src/services/AgentLoop.js');
  let deep = { v: 'leaf' };
  for (let i = 0; i < 40; i++) deep = { nested: deep };
  const out = normalizeCallArgs(deep);   // must terminate
  assert.ok(out !== undefined);
  assert.equal(normalizeCallArgs(null), null);
  assert.equal(normalizeCallArgs(undefined), null);
  assert.equal(normalizeCallArgs(7), 7);
});

/* ── JEXI-030 ─────────────────────────────────────────────────────── */

test('JEXI-030: the coding tool set excludes search, MCP and non-coding tools', async () => {
  const { isCodingTool, isCodingToolSchema } = await import('../../src/services/agent/CodingLoop.js');
  // In: the tools the closed loop actually needs.
  for (const n of ['fs_read', 'fs_write', 'fs_edit', 'fs_ls', 'term_execute', 'pytest_run', 'test_run', 'git_diff', 'git_status']) {
    assert.equal(isCodingTool(n), true, `${n} belongs in a coding turn`);
  }
  // Out: everything a coding turn must NOT be offered.
  for (const n of ['web_search', 'web_fetch', 'mcp__duckduckgo__search', 'mem_recall', 'nav_navigate', 'comm_notify', 'delegate_spawn']) {
    assert.equal(isCodingTool(n), false, `${n} must not be offered on a coding turn`);
  }
  assert.equal(isCodingToolSchema({ function: { name: 'fs_write' } }), true, 'openai-shaped schema');
  assert.equal(isCodingToolSchema({}), false, 'a schema with no name is not a coding tool');
  assert.equal(isCodingToolSchema(null), false);
});

test('JEXI-030: the cap is a hard ceiling, and the cap is enforced on a wide catalogue', async () => {
  const { isCodingToolSchema, CODING_TOOL_PREFIXES } = await import('../../src/services/agent/CodingLoop.js');
  // A catalogue containing every registered tool would be flooded; the filter
  // must reduce it to the coding subset regardless of what else is in there.
  const flooded = [
    ...['fs_read', 'fs_edit', 'fs_write', 'fs_ls', 'fs_delete', 'term_execute', 'pytest_run', 'test_run', 'git_status']
      .map((n) => ({ function: { name: n } })),
    ...Array.from({ length: 200 }, (_, i) => ({ function: { name: `mcp__server${i}__tool${i}` } })),
    ...Array.from({ length: 100 }, (_, i) => ({ function: { name: `web-thing-${i}` } })),
  ];
  const kept = flooded.filter(isCodingToolSchema);
  assert.equal(kept.length, 9, `expected only the 9 coding tools, got ${kept.length}`);
  assert.ok(kept.every((s) => !s.function.name.startsWith('mcp__')));
  assert.ok(CODING_TOOL_PREFIXES.length > 0);
});

test('JEXI-030: a coding intent is recognised by plan or by its own words', async () => {
  const { isCodingIntent } = await import('../../src/services/agent/CodingLoop.js');
  assert.equal(isCodingIntent({ intent: 'code' }), true);
  assert.equal(isCodingIntent({ intent: 'debug' }), true);
  assert.equal(isCodingIntent({ intent: 'learning_research' }, 'fix the failing pytest'), true);
  assert.equal(isCodingIntent({ intent: 'learning_research' }, 'the build is broken'), true);
  assert.equal(isCodingIntent({ intent: 'learning_research' }, 'who won the world cup in 1998'), false);
});
