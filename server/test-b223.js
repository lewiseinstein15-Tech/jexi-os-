/**
 * B223 — Part 20: objective → capability → tool discovery registry.
 *
 * Proves the discovery layer is REAL and honest:
 *   - every registry tool derives capabilities + risk metadata (none untagged)
 *   - risk is the B209 permission truth (network/execute/outbound/destructive)
 *   - verification metadata names HOW results verify — or honestly null
 *   - capabilities come from the interpreter (INTERPRETER) or keyword
 *     families (INFERRED), never invented
 *   - discovery matches tools per-objective, prunes to a small subset,
 *     respects the B52 intent allowlist, and reports capability GAPS
 *     instead of hiding them
 *   - the Director wires it as ADDITIVE metadata (emits TOOLS_DISCOVERED,
 *     attaches to the structured objective) without touching injection
 *   - the /api/tools/discover endpoint exists and is wired to the module
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

const {
  discoverTools, requiredCapabilities, capabilitiesForTool, riskForTool,
} = await import('./src/services/ToolDiscovery.js');
const { TOOL_REGISTRY, toolsForTeam } = await import('./src/services/ToolRegistry.js');
const { toolPermissionsFor } = await import('./src/services/director/Permissions.js');

/* ── 1. registry coverage: every tool tagged ─────────────────────────── */

test('every registry tool derives ≥1 capability (no untagged tools)', () => {
  const untagged = TOOL_REGISTRY.filter((t) => capabilitiesForTool(t).length === 0).map((t) => t.slug);
  assert.deepEqual(untagged, [], `untagged tools: ${untagged.join(', ')}`);
});

test('every tool derives risk metadata with the B209 permission truth', () => {
  for (const t of TOOL_REGISTRY) {
    const r = riskForTool(t);
    assert.ok(r.tier, `${t.slug}: tier missing`);
    assert.deepEqual(r.permissions, toolPermissionsFor(t.slug), `${t.slug}: permissions must mirror Permissions.js`);
    assert.equal(typeof r.flags.network, 'boolean');
    assert.equal(typeof r.flags.outbound, 'boolean');
    assert.equal(typeof r.flags.destructive, 'boolean');
  }
});

test('risk flags are the real dangerous ones', () => {
  assert.equal(riskForTool(TOOL_REGISTRY.find((t) => t.slug === 'web-search')).flags.network, true);
  assert.equal(riskForTool(TOOL_REGISTRY.find((t) => t.slug === 'code-run')).flags.execute, true, 'code-run is exec-tier');
  const cc = riskForTool(TOOL_REGISTRY.find((t) => t.slug === 'connector-call'));
  assert.equal(cc.flags.outbound, true, 'connector-call is outbound');
  assert.equal(cc.approvalRequired, true, 'outbound sends stay approval-gated (B56)');
  assert.equal(riskForTool(TOOL_REGISTRY.find((t) => t.slug === 'memory-clear')).flags.destructive, true);
});

test('verification metadata: named kinds, honest null for generative tools', () => {
  const d = discoverTools({ objective: 'research the latest AI news with sources and verify the claims', interpreted: { requiredCapabilities: ['research', 'verification'] } });
  const ws = d.tools.find((t) => t.slug === 'web-search');
  assert.equal(ws.verification.kind, 'citations');
  const fc = d.tools.find((t) => t.slug === 'fact-check');
  assert.equal(fc.verification.kind, 'verdict');
  // a purely generative tool honestly reports null
  const poem = riskForTool(TOOL_REGISTRY.find((t) => t.slug === 'poem-write'));
  assert.ok(poem, 'poem-write resolves');
  const d2 = discoverTools({ objective: 'write a poem about the sea', interpreted: { requiredCapabilities: ['creative'] } });
  const pw = d2.tools.find((t) => t.slug === 'poem-write');
  if (pw) assert.equal(pw.verification.kind, null, 'generative tools are honestly unverifiable');
});

/* ── 2. objective → capabilities (provenance-tagged) ─────────────────── */

test('interpreter capabilities pass through with INTERPRETER provenance + synonym folding', () => {
  const r = requiredCapabilities('ship it', { requiredCapabilities: ['coding', 'research', 'dept:engineering'] });
  assert.ok(r.capabilities.includes('author-code'), 'coding → author-code');
  assert.ok(r.capabilities.includes('research'));
  assert.ok(r.capabilities.includes('dept:engineering'), 'dept families pass through');
  assert.equal(r.provenance['author-code'], 'INTERPRETER');
});

test('keyword hints tag INFERRED (documented heuristic, never presented as user-stated)', () => {
  const r = requiredCapabilities('build me a quiz web app and make sure it works', null);
  assert.ok(r.capabilities.includes('author-code'));
  assert.ok(r.capabilities.includes('verification'));
  assert.equal(r.provenance['author-code'], 'INFERRED');
});

test('dept:* capabilities never count as tool gaps (they organize people, not tools)', () => {
  const d = discoverTools({ objective: 'build an app', interpreted: { requiredCapabilities: ['coding', 'dept:engineering'] } });
  assert.equal(d.gaps.filter((g) => g.capability.startsWith('dept:')).length, 0);
});

/* ── 3. the discovery pass ────────────────────────────────────────────── */

test('build-an-app objective discovers the code lane (write/run/verify), not web-search', () => {
  const d = discoverTools({ objective: 'build me a quiz web app and make sure it works', intent: 'autonomous_coding', interpreted: { requiredCapabilities: ['coding'] } });
  const slugs = d.tools.map((t) => t.slug);
  assert.ok(slugs.includes('code-write'));
  assert.ok(slugs.includes('code-run'));
  assert.ok(slugs.includes('build-check'));
  assert.ok(!slugs.includes('web-search'), 'web search is not required to build an app');
  assert.ok(d.meta.toolCount <= 12, 'AutoTool-style pruning: small subset, never the catalog');
});

test('research objective discovers the research lane with citations', () => {
  const d = discoverTools({ objective: 'research the latest AI news with sources', interpreted: { requiredCapabilities: ['research'] } });
  const slugs = d.tools.map((t) => t.slug);
  assert.ok(slugs.includes('web-search'));
  assert.ok(slugs.includes('news-feed'));
});

test('vision objective discovers vision tools', () => {
  const d = discoverTools({ objective: 'analyze this image', interpreted: { requiredCapabilities: ['vision'] } });
  assert.ok(d.tools.map((t) => t.slug).includes('vision-analyze'));
});

test('B52 allowlist is respected: direct_answer never offers web-search (withheld, noted)', () => {
  const d = discoverTools({ objective: 'research the latest AI news', intent: 'direct_answer', interpreted: { requiredCapabilities: ['research', 'realtime-info'] } });
  const slugs = d.tools.map((t) => t.slug);
  assert.ok(!slugs.includes('web-search'), 'lightweight intents get memory/knowledge tools only');
  assert.ok(slugs.includes('semantic-search'), 'research via the memory lane is by-design allowed');
  assert.ok(d.blockedByAllowlist.some((b) => b.capability === 'realtime-info'), 'the withholding is surfaced, not silent');
});

test('capability gaps are reported honestly (no tool provides telephony)', () => {
  const d = discoverTools({ objective: 'call my bank on the phone', interpreted: { requiredCapabilities: ['telephony'] } });
  assert.equal(d.gaps.length, 1);
  assert.equal(d.gaps[0].capability, 'telephony');
  assert.equal(d.gaps[0].provenance, 'INTERPRETER');
});

test('team baseline + added-for-objective delta', () => {
  const d = discoverTools({ objective: 'build an app', team: [{ slug: 'coder' }], interpreted: { requiredCapabilities: ['coding'] } });
  assert.ok(d.teamBaseline.length > 0, 'team baseline derived from toolsForTeam');
  assert.ok(d.teamBaseline.includes('code-run'), 'coder runs code');
  assert.ok(d.addedForObjective.every((s) => !d.teamBaseline.includes(s)), 'delta excludes the baseline');
});

test('deterministic: same input → same output (no LLM calls)', () => {
  const a = discoverTools({ objective: 'research AI news', interpreted: { requiredCapabilities: ['research'] } });
  const b = discoverTools({ objective: 'research AI news', interpreted: { requiredCapabilities: ['research'] } });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.meta.deterministic, true);
});

/* ── 4. wiring: Director attaches + emits; endpoint exists ───────────── */

test('Director wires discovery as ADDITIVE metadata (attach + TOOLS_DISCOVERED + no injection change)', () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, 'src/services/director/Director.js'), 'utf-8');
  assert.ok(src.includes("from '../ToolDiscovery.js'"), 'Director imports the discovery module');
  assert.ok(src.includes('structuredObjective.toolDiscovery = discoverTools('), 'attaches to the structured objective');
  assert.ok(src.includes("type: 'TOOLS_DISCOVERED'"), 'emits the TOOLS_DISCOVERED event');
  assert.ok(src.includes('discovery is metadata — never blocks the mission'), 'wrapped so it can never fail a mission');
  // the safe injection path is untouched
  assert.ok(!src.includes('toolsForIntent('), 'Director still does not do its own injection (unchanged seam)');
});

test('/api/tools/discover endpoint wired to the module', () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf-8');
  assert.ok(src.includes("app.get('/api/tools/discover'"), 'route exists');
  assert.ok(/api\/tools\/discover[\s\S]{0,600}discoverTools\(/.test(src), 'route calls discoverTools');
  assert.ok(src.includes("objective query parameter required"), 'rejects empty objectives');
});

test('source contract: the module documents the Part 20 rules (additive, no gate bypass)', () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, 'src/services/ToolDiscovery.js'), 'utf-8');
  assert.ok(src.includes('ADDITIVE metadata'), 'documented as additive');
  assert.ok(src.includes('B52'), 'allowlist awareness documented');
  assert.ok(src.includes('B209'), 'permission-gate awareness documented');
});
