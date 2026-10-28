/**
 * JEXI OS — capability registry tests.
 *
 * These guard the fix for the reported defect: JEXI claimed a capability was
 * unavailable while being able to use it the moment it was named explicitly.
 * The cause was structural — the offered tool set came only from the classified
 * intent, so a misroute withheld the right tools — and these tests pin the
 * property that a request's own words are always reachable.
 *
 * They also pin the four-state model (exists / registered / available /
 * succeeded), because conflating those states is what made an optimistic claim
 * possible in the first place.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATES, REASONS, describeCapability, listCapabilityStates,
  capabilitySummary, primeCapabilities, stateRank, atLeast,
} from '../../src/capability/registry/registry.js';
import { inferRequirements, requirementRules } from '../../src/capability/registry/requirements.js';
import { selectCapabilityTools } from '../../src/capability/registry/selection.js';
import {
  recordOutcome, classifyOutcome, succeededCapabilities, refusedCapabilities,
  failedCapabilities, OUTCOMES, _resetLedger,
} from '../../src/capability/registry/ledger.js';
import { CAPABILITIES, capabilityIds } from '../../src/capability/registry/catalog.js';
import { buildOfferedTools } from '../../src/services/agent/ToolSetBuilder.js';

/* ── the catalog is honest about itself ─────────────────────────────────── */

test('catalog: every capability has an id, guidance, and at least one provider', () => {
  assert.ok(CAPABILITIES.length >= 10, 'the catalog must cover the core capabilities');
  for (const c of CAPABILITIES) {
    assert.ok(c.id, 'a capability needs an id');
    assert.ok(c.title && c.whenToUse, `${c.id} needs title + whenToUse (tool guidance)`);
    assert.ok(Array.isArray(c.providers) && c.providers.length > 0, `${c.id} needs a provider`);
    for (const p of c.providers) {
      assert.ok(p.tool || p.mcpServer, `${c.id} provider must name a tool or an mcpServer`);
    }
  }
  assert.equal(new Set(capabilityIds()).size, capabilityIds().length, 'ids must be unique');
});

/* ── the four states are distinct and derived, never asserted ────────────── */

test('registry: availability is derived from real engines, not hard-coded', async () => {
  await primeCapabilities();
  const fsRead = describeCapability('filesystem_read');
  assert.equal(fsRead.state, STATES.AVAILABLE, 'fs_read has a real engine, so it is available');
  assert.equal(fsRead.exists, true);
  assert.equal(fsRead.registered, true);
  assert.equal(fsRead.available, true);
  assert.equal(fsRead.reason, REASONS.OK);

  // The provider record names the concrete tool and why it is usable.
  const p = fsRead.providers.find((x) => x.tool === 'fs_read');
  assert.ok(p, 'fs_read must appear as a provider');
  assert.equal(p.hasEngine, true);
  assert.equal(p.permitted, true);
});

test('registry: a permission-denied capability is reported unavailable WITH a reason', async () => {
  await primeCapabilities();
  // `readonly` permits only safe tools; fs_write is medium, so it is denied.
  const d = describeCapability('filesystem_write', { profile: 'readonly' });
  assert.equal(d.available, false, 'a write capability must not be available under readonly');
  assert.ok(d.reasons.includes(REASONS.PERMISSION_DENIED), `expected permission_denied, got ${d.reasons}`);
  // It still EXISTS and is REGISTERED — those are weaker, true claims.
  assert.equal(d.exists, true);
  assert.equal(d.registered, true);
  assert.ok(atLeast(d.state, STATES.REGISTERED));
  assert.ok(!atLeast(d.state, STATES.AVAILABLE));
});

test('registry: a SAFE read is still available under readonly', async () => {
  await primeCapabilities();
  /* Regression: `resolveToolDef` returns a probe stub without `riskLevel` for
     domain tools, so a naive `riskLevel ?? 'medium'` mapped every domain tool to
     medium and denied reads under readonly. fs_read declares riskLevel 'low'. */
  const d = describeCapability('filesystem_read', { profile: 'readonly' });
  assert.equal(d.available, true, 'reading a file is a safe action and must survive readonly');
  assert.equal(d.reason, REASONS.OK);

  // The provider must carry the REAL risk tier, not a default.
  const p = d.providers.find((x) => x.tool === 'fs_read');
  assert.equal(p.tier, 'safe', `fs_read must be tier safe, got ${p.tier}`);
  assert.equal(p.permitted, true);

  // And a medium provider of the same capability set is still denied.
  const w = describeCapability('filesystem_write', { profile: 'readonly' });
  assert.equal(w.available, false);
});

test('registry: state ordering is comparable', () => {
  assert.ok(stateRank(STATES.AVAILABLE) > stateRank(STATES.REGISTERED));
  assert.ok(stateRank(STATES.REGISTERED) > stateRank(STATES.EXISTS));
  assert.ok(atLeast(STATES.SUCCEEDED, STATES.AVAILABLE));
  assert.ok(!atLeast(STATES.EXISTS, STATES.AVAILABLE));
});

test('registry: summary counts match the per-capability states', async () => {
  await primeCapabilities();
  const s = capabilitySummary();
  const recomputed = s.capabilities.filter((c) => c.available).length;
  assert.equal(s.available + s.registered + s.exists + s.succeeded, recomputed + s.succeeded);
  assert.equal(s.total, CAPABILITIES.length);
});

/* ── requirement inference: the request's own words ─────────────────────── */

test('requirements: the three reported misroutes infer the right capabilities', () => {
  const web = inferRequirements('search the web for the latest Node.js release', {});
  assert.ok(web.required.includes('web_search'), `web search must be required, got ${web.required}`);

  const file = inferRequirements('read the file package.json', {});
  assert.ok(file.required.includes('filesystem_read'), `reading a file must require filesystem_read, got ${file.required}`);

  const term = inferRequirements('run ls -la in the terminal', {});
  assert.ok(term.required.includes('terminal'), `running a command must require terminal, got ${term.required}`);
});

test('requirements: a coding intent implies read + write + verify even if unstated', () => {
  const r = inferRequirements('make the suite green', { intent: 'code', tools: [] });
  for (const cap of ['filesystem_read', 'filesystem_write', 'testing', 'terminal']) {
    assert.ok(r.required.includes(cap), `coding turn must require ${cap}, got ${r.required}`);
  }
});

test('requirements: a greeting requires nothing', () => {
  const r = inferRequirements('hi', {});
  assert.equal(r.required.length, 0, `a greeting must not require capabilities, got ${r.required}`);
});

test('requirements: every rule declares why it fired', () => {
  const r = inferRequirements('run the tests in the terminal', {});
  assert.ok(r.reasons.length > 0);
  for (const reason of r.reasons) {
    assert.ok(reason.capability && reason.why, 'each requirement needs a capability and a reason');
  }
  assert.ok(requirementRules().length > 0);
});

/* ── selection: verified against the live registry ──────────────────────── */

test('selection: required tools are added even when the plan asked for none', async () => {
  // The exact misroute that produced the bug report: web search classified as
  // legal_task, whose tools are compliance-check / privacy-review.
  const sel = await selectCapabilityTools({
    query: 'search the web for the latest Node.js release',
    plan: { intent: 'legal_task', tools: ['compliance-check', 'privacy-review'] },
  });
  const slugs = sel.tools.map((t) => t.slug);
  assert.ok(slugs.includes('web_search'), `web_search must be added, got ${slugs}`);
  assert.ok(sel.required.includes('web_search'));
});

test('selection: never offers a tool with no engine', async () => {
  await primeCapabilities();
  const sel = await selectCapabilityTools({
    query: 'read the file package.json and run ls in the terminal',
    plan: { intent: 'default', tools: [] },
  });
  assert.ok(sel.tools.length > 0, 'the request plainly needs tools');
  // Every offered slug must resolve to a real definition.
  const { resolveToolDef } = await import('../../src/services/ToolRuntime.js');
  for (const t of sel.tools) {
    assert.ok(resolveToolDef(t.slug), `${t.slug} was offered but does not resolve`);
  }
});

test('selection: offers a minimal set, not every provider of a capability', async () => {
  const sel = await selectCapabilityTools({
    query: 'read the file package.json',
    plan: { intent: 'default', tools: [] },
  });
  const slugs = sel.tools.map((t) => t.slug);
  // fs_delete is a high-risk provider of filesystem_write — a plain read must
  // not hand the model a delete tool.
  assert.ok(!slugs.includes('fs_delete'), `fs_delete must not be offered for a read, got ${slugs}`);
});

test('selection: a greeting adds nothing', async () => {
  const sel = await selectCapabilityTools({ query: 'hi', plan: { intent: 'conversation', tools: [] } });
  assert.equal(sel.tools.length, 0, `a greeting must not add tools, got ${sel.tools.map((t) => t.slug)}`);
});

test('selection: reports an unavailable requirement instead of staying silent', async () => {
  const sel = await selectCapabilityTools({
    query: 'write the file out.txt',
    plan: { intent: 'code', tools: [] },
    profile: 'readonly',
  });
  assert.ok(sel.unavailable.some((u) => u.capability === 'filesystem_write'),
    `a denied capability must be reported, got ${JSON.stringify(sel.unavailable)}`);
  assert.ok(sel.notes.some((n) => /NOT available/.test(n)), 'the note must say the capability is unavailable');
});

/* ── ledger: evidence, not promises ─────────────────────────────────────── */

test('ledger: a transport-ok with a failing verdict is NOT success', () => {
  assert.equal(classifyOutcome({ ok: true, status: 'fail' }), OUTCOMES.FAILED);
  assert.equal(classifyOutcome({ ok: true, result: { status: 'failed' } }), OUTCOMES.FAILED);
  assert.equal(classifyOutcome({ ok: false, error: 'boom' }), OUTCOMES.FAILED);
  assert.equal(classifyOutcome({ ok: true }), OUTCOMES.SUCCEEDED);
});

test('ledger: a refusal is distinct from a failure', () => {
  assert.equal(classifyOutcome({ ok: false, blocked: true }), OUTCOMES.REFUSED);
  assert.equal(classifyOutcome({ ok: false, error: 'permission denied: fs_write needs medium permission' }), OUTCOMES.REFUSED);
});

test('ledger: succeeded / refused / failed are separate sets', () => {
  _resetLedger();
  recordOutcome({ tool: 'fs_read', result: { ok: true } });
  recordOutcome({ tool: 'fs_write', result: { ok: false, blocked: true, error: 'permission denied' } });
  recordOutcome({ tool: 'term_execute', result: { ok: false, error: 'command not found' } });

  assert.ok(succeededCapabilities().has('filesystem_read'));
  assert.ok(refusedCapabilities().has('filesystem_write'));
  assert.ok(failedCapabilities().has('terminal'));
  assert.ok(!succeededCapabilities().has('filesystem_write'), 'a refusal is not a success');
  assert.ok(!succeededCapabilities().has('terminal'), 'a failure is not a success');
  _resetLedger();
});

test('ledger: a succeeded capability reaches the SUCCEEDED state', async () => {
  await primeCapabilities();
  _resetLedger();
  assert.notEqual(describeCapability('filesystem_read').state, STATES.SUCCEEDED);
  recordOutcome({ tool: 'fs_read', result: { ok: true } });
  const d = describeCapability('filesystem_read');
  assert.equal(d.state, STATES.SUCCEEDED, 'a real success must lift the state to succeeded');
  assert.equal(d.succeeded, true);
  _resetLedger();
});

test('ledger: a failed call does not lift the state to succeeded', async () => {
  await primeCapabilities();
  _resetLedger();
  recordOutcome({ tool: 'fs_read', result: { ok: false, error: 'ENOENT' } });
  const d = describeCapability('filesystem_read');
  assert.notEqual(d.state, STATES.SUCCEEDED, 'a failure must never read as success');
  assert.equal(d.succeeded, false);
  _resetLedger();
});

/* ── integration: the offered set now honours the request ───────────────── */

test('integration: a misrouted web-search request is still offered web search', async () => {
  const out = await buildOfferedTools({
    plan: { intent: 'legal_task', tools: ['compliance-check', 'privacy-review'] },
    query: 'search the web for the latest Node.js release',
    emit: () => {},
  });
  const names = out.schemas.map((s) => s.function?.name || s.name);
  assert.ok(names.includes('web_search'), `web_search must reach the model, got ${names}`);
  assert.ok(out.requiredTools.some((t) => t.capability === 'web_search'), 'the capability report must name web_search');
});

test('integration: a misrouted terminal request is still offered the terminal', async () => {
  const out = await buildOfferedTools({
    plan: { intent: 'learning_research', tools: [] },
    query: 'run ls -la in the terminal',
    emit: () => {},
  });
  const names = out.schemas.map((s) => s.function?.name || s.name);
  assert.ok(names.includes('term_execute'), `term_execute must reach the model, got ${names}`);
});

test('integration: an explicitly required non-coding tool survives the coding cap', async () => {
  // One turn that both fixes a test AND needs the web: the coding cap must not
  // withhold the search tool the request named.
  const out = await buildOfferedTools({
    plan: { intent: 'code', tools: ['fs_read', 'fs_edit', 'pytest_run'] },
    query: 'fix the failing test and search the web for the error message',
    emit: () => {},
  });
  const names = out.schemas.map((s) => s.function?.name || s.name);
  assert.ok(names.includes('web_search'), `an explicitly required search tool must survive the coding cap, got ${names}`);
  assert.ok(names.includes('pytest_run'), 'the coding tools must still be there');
});
