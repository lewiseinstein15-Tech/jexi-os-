/**
 * M12 — Intelligent Tool Selection: progressive tool disclosure.
 *
 * The M11 measurement: a coding turn was offered 41 tools (25 plan + 16 routed
 * MCP), the 3B model answered in prose instead of calling any of them, and the
 * graded file was never written — 0/15. A controlled probe isolated the cause
 * as the SIZE of the offered menu (41 tools → 0/4 tool-call; 3 tools → 3/4).
 *
 * These tests guard the fix: a small, relevant INITIAL menu, a working
 * `request_tools` expansion, and — critically — that neither ever expands
 * AUTHORITY (a disclosed tool is still gated at execute time) and neither ever
 * withholds a tool the request plainly needs.
 *
 * Determinism: every assertion here runs through the real builder/selector with
 * no model and no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerAllDomains } from '../../src/tools/domains/index.js';
import { buildOfferedTools } from '../../src/services/agent/ToolSetBuilder.js';
import {
  initialDisclosure, resolveDisclosureRequest, buildRequestToolsSchema,
  isDisclosureCall, discoverableBundleIds,
} from '../../src/services/agent/ToolDisclosure.js';
import { CODING_INTENTS, isCodingIntent } from '../../src/services/agent/CodingLoop.js';
import { TOOL_BUNDLES, initialBundlesForIntent } from '../../src/services/agent/ToolBundles.js';
import { resolveToolDef, toolHasEngine, toolPermission } from '../../src/services/ToolRuntime.js';

registerAllDomains();

const namesOf = (schemas) => schemas.map((s) => s.function?.name || s.name);

/* ── root cause: the intent-string mismatch that disabled the cap ────────── */

test('M12: the planner vocabulary is a coding intent (the M11 root cause)', () => {
  // The Planner emits code_task / code_fix; before M12 the set listed only
  // code/coding/fix/debug/refactor/test, so isCodingIntent returned FALSE for
  // every real coding turn and the cap never engaged.
  assert.equal(isCodingIntent({ intent: 'code_task' }), true);
  assert.equal(isCodingIntent({ intent: 'code_fix' }), true);
  for (const i of ['code', 'coding', 'fix', 'debug', 'refactor', 'test']) {
    assert.equal(CODING_INTENTS.has(i), true, `${i} must stay a coding intent`);
  }
  assert.equal(isCodingIntent({ intent: 'learning_research' }, 'who won the 1998 world cup'), false);
});

/* ── the initial menu is small and relevant ──────────────────────────────── */

test('M12: a coding turn is offered a SMALL initial menu, not the catalogue', async () => {
  const out = await buildOfferedTools({
    plan: { intent: 'code_task', tools: ['knowledge-load', 'code-run', 'code-write', 'code-fix', 'code-review', 'security-scan', 'fact-check', 'self-consistency', 'test-automation', 'lint-check', 'dependency-audit', 'build-check', 'fs_read', 'fs_write', 'term_execute', 'pytest_run'] },
    query: 'Complete this Python function by writing the full implementation to the file solution.py.',
    emit: () => {},
  });
  const names = namesOf(out.schemas);
  assert.ok(out.disclosure, 'the turn must carry a disclosure decision');
  assert.ok(names.length <= 8, `initial menu must stay small, got ${names.length}: ${names}`);
  // The closed loop must be present: read, edit, run, verify.
  for (const need of ['fs_read', 'fs_write', 'term_execute', 'pytest_run']) {
    assert.ok(names.includes(need), `the closed loop needs ${need}, got ${names}`);
  }
  // The noise that caused the failure must be gone.
  for (const noise of ['knowledge-load', 'code-review', 'security-scan', 'dependency-audit', 'build-check']) {
    assert.ok(!names.includes(noise), `${noise} must not sit in the initial coding menu`);
  }
});

test('M12: an unmapped intent gets the universal read/write/run floor, NOT the full catalogue', async () => {
  // Regression: a coding task the classifier labelled `observability` matched
  // no bundle, so disclosure returned null and the model silently received the
  // FULL 24-tool menu — the narrowing became a coin flip on the intent label.
  // An unmapped intent must now get a small floor, never the whole catalogue.
  const out = await buildOfferedTools({
    plan: { intent: 'totally_unknown_intent', tools: ['knowledge-load', 'code-run'] },
    query: 'hello there',
    emit: () => {},
  });
  assert.ok(out.disclosure, 'an unmapped intent must still disclose a floor');
  assert.deepEqual(out.disclosure.bundles, ['filesystem', 'terminal']);
  const names = namesOf(out.schemas);
  for (const need of ['fs_read', 'fs_write', 'term_execute']) {
    assert.ok(names.includes(need), `the floor needs ${need}, got ${names}`);
  }
  assert.ok(names.length <= 8, `the floor must stay small, got ${names.length}: ${names}`);
  assert.ok(!names.includes('knowledge-load'), 'the full catalogue must not leak back in');
});

test('M12: an explicit empty intent mapping still means no disclosure', async () => {
  const out = await buildOfferedTools({
    plan: { intent: 'self_check', tools: ['knowledge-load', 'code-run'] },
    query: 'check yourself',
    emit: () => {},
  });
  assert.equal(out.disclosure, null, 'an explicitly empty mapping is an opt-out');
});

/* ── disclosure never withholds what the request needs ───────────────────── */

test('M12: an explicitly required tool survives narrowing', async () => {
  // "fix the failing test AND search the web" is one turn that needs both.
  const out = await buildOfferedTools({
    plan: { intent: 'code_task', tools: ['fs_read', 'fs_write', 'term_execute', 'pytest_run'] },
    query: 'fix the failing test and search the web for the error message',
    emit: () => {},
  });
  const names = namesOf(out.schemas);
  assert.ok(names.includes('web_search'), `an explicitly required tool must survive, got ${names}`);
  assert.ok(names.includes('pytest_run'), 'the coding tools must still be there');
});

/* ── the expansion tool ──────────────────────────────────────────────────── */

test('M12: request_tools is recognised and carries a real schema', () => {
  assert.equal(isDisclosureCall('request_tools'), true);
  assert.equal(isDisclosureCall('fs_read'), false);
  const schema = buildRequestToolsSchema(['web', 'browser']);
  assert.equal(schema.function.name, 'request_tools');
  assert.ok(schema.function.parameters.properties.bundles, 'it must accept bundle ids');
});

test('M12: expansion resolves real bundles and drops unknown tools honestly', () => {
  const got = resolveDisclosureRequest({ requested: ['web'], alreadyOffered: [], knownSlugs: [] });
  const names = namesOf(got.schemas);
  assert.ok(names.includes('web_search'), `web bundle must resolve web_search, got ${names}`);
  assert.deepEqual(got.unknown, [], 'a real bundle yields no unknowns');

  const bad = resolveDisclosureRequest({ requested: ['definitely_not_a_tool'], alreadyOffered: [], knownSlugs: [] });
  assert.equal(bad.schemas.length, 0);
  assert.deepEqual(bad.unknown, ['definitely_not_a_tool'], 'an unknown tool is reported, not invented');
});

test('M12: expansion never re-offers a tool already in the menu', () => {
  const got = resolveDisclosureRequest({ requested: ['filesystem'], alreadyOffered: ['fs_read', 'fs_write'], knownSlugs: [] });
  const names = namesOf(got.schemas);
  assert.ok(!names.includes('fs_read'), 'fs_read is already offered');
  assert.ok(!names.includes('fs_write'), 'fs_write is already offered');
});

/* ── discovery never expands authority ───────────────────────────────────── */

test('M12: every bundle member is a REAL, engine-backed tool (no invented tools)', () => {
  for (const [id, bundle] of Object.entries(TOOL_BUNDLES)) {
    const declared = [...(bundle.core || []), ...(bundle.slugs || [])];
    for (const slug of declared) {
      assert.ok(resolveToolDef(slug), `bundle ${id} declares "${slug}", which is not a registered tool`);
      assert.ok(toolHasEngine(slug), `bundle ${id} declares "${slug}", which has no engine to run`);
    }
  }
});

test('M12: a disclosed tool is still subject to the execute-time permission gate', () => {
  // Discovery changes what is OFFERED; it must never change what is ALLOWED.
  // The permission classification is a property of the tool, resolved by the
  // runtime at call time — expanding the menu cannot alter it. `code-write` is
  // `risky` and only runs under a profile that permits risky tools, whether it
  // arrived in the initial menu or via request_tools.
  assert.equal(toolPermission('code-write'), 'risky', 'a risky write stays risky after disclosure');
});

test('M12: bundle ids offered for expansion exclude those already disclosed', () => {
  const avail = discoverableBundleIds(['filesystem', 'terminal']);
  assert.ok(!avail.includes('filesystem'));
  assert.ok(!avail.includes('terminal'));
  assert.ok(avail.includes('web'), 'an undisclosed bundle stays reachable');
});

/* ── the intent→bundle map is coherent ───────────────────────────────────── */

test('M12: every intent bundle id is a real bundle', () => {
  const intents = ['code_task', 'code_fix', 'research', 'learning_research', 'data', 'github', 'computer_use'];
  for (const i of intents) {
    for (const b of initialBundlesForIntent(i)) {
      assert.ok(TOOL_BUNDLES[b], `intent ${i} maps to unknown bundle "${b}"`);
    }
  }
});

/* ── the offering half of JEXI-017: domain tools keep their parameters ───── */

test('M12: an offered domain tool carries its REAL parameter schema', async () => {
  // Regression: `resolveToolDef` returned a bare `{slug,name,permission}` stub
  // for domain tools, so `fs_write` reached the model with an EMPTY argument
  // object — the model was told the tool existed but not that it needs
  // path+content, and could not form a valid call. Narrowing made this binding
  // because the small menu is mostly domain tools.
  const out = await buildOfferedTools({
    plan: { intent: 'code_task', tools: ['fs_read', 'fs_write', 'fs_edit', 'term_execute', 'pytest_run'] },
    query: 'write solution.py and run the tests',
    emit: () => {},
  });
  const byName = Object.fromEntries(out.schemas.map((s) => [s.function.name, s.function]));
  assert.deepEqual(byName.fs_write.parameters.required, ['path', 'content']);
  assert.ok(byName.fs_write.parameters.properties.content, 'fs_write must expose `content`');
  assert.deepEqual(byName.fs_read.parameters.required, ['path']);
  assert.ok(byName.fs_edit.parameters.properties.find, 'fs_edit must expose `find`');
  assert.ok(byName.term_execute.parameters.properties.command, 'term_execute must expose `command`');
});

test('M12: resolveToolDef surfaces a domain tool’s description and parameters', () => {
  const def = resolveToolDef('fs_write');
  assert.ok(def, 'fs_write must resolve');
  assert.equal(def.parameters?.type, 'object');
  assert.ok(String(def.desc || def.description || '').length > 0, 'the model needs a description');
});
