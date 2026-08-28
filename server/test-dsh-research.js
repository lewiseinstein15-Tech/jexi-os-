/**
 * B125 — DSH-STYLE RESEARCH regression suite
 * (deepseek-harness tool-web mirror: model-driven web_search + web_fetch).
 *
 * Proves: the research plugin mounts web_search/web_fetch with the DSH
 * contracts + the research skill (discovered at custom rank 300); the
 * tools execute through the gate; the runner drives search→synthesize with
 * sources collected; research intents route to the runner (no team
 * pipeline); fallback synthesis never leaves the user empty-handed.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-dshr-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { loadPlugins, setActivePluginContext, listPluginTools, listPluginSkills } = await import('./src/services/PluginContext.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { discoverSkills, loadSkillForModel } = await import('./src/services/SkillDiscovery.js');
const { runDshResearch } = await import('./src/services/DshResearch.js');
const { planner, isDirectIntent } = await import('./src/services/Planner.js');

console.log('\n== 1. Research plugin mounts web_search + web_fetch + the skill ==');
const { ctx, loaded, failed } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);
ok(failed.length === 0, 'all plugins load without failure');
ok(loaded.some((p) => p.name === 'research'), 'research plugin loaded');
const tools = listPluginTools();
ok(tools.some((t) => t.slug === 'web_search'), 'web_search mounted (DSH tool-web)');
ok(tools.some((t) => t.slug === 'web_fetch'), 'web_fetch mounted (DSH tool-web)');
const skills = listPluginSkills();
ok(skills.some((s) => s.slug === 'research'), 'research skill registered on the context');
const disc = discoverSkills().find((c) => c.name === 'research');
ok(!!disc && disc.source === 'custom' && disc.rank === 300, `research skill auto-discovered at custom rank 300 (${disc && disc.rank})`);
const body = loadSkillForModel('research');
ok(!!body && /Research Skill/.test(String(body.content || '')), 'research skill body loads (progressive)');
ok(String(body.content || '').includes('web_fetch'), 'skill teaches the DSH search→fetch workflow');

console.log('\n== 2. DSH contracts through the gate ==');
const ws = await executeTool({ slug: 'web_search', args: { query: 'deepseek harness' } });
ok(ws.ok === true, 'web_search executes');
ok(/\"sources\": \[/.test(String(ws.result || '')), 'web_search returns sources[] (DSH contract)');
ok(/"url": "http/.test(String(ws.result || '')), 'sources carry urls');
const wf = await executeTool({ slug: 'web_fetch', args: { url: 'https://en.wikipedia.org/wiki/Moon' } });
ok(wf.ok === true, 'web_fetch executes on a real URL');
ok(/\"body\": \{/.test(String(wf.result || '')), 'web_fetch returns body{} (DSH contract)');
ok(/\"statusCode\": 200/.test(String(wf.result || '')), 'statusCode present');
const wfBad = await executeTool({ slug: 'web_fetch', args: { url: 'ftp://nope' } });
ok(wfBad.ok === false && /http/.test(wfBad.error || ''), 'non-http url fails honestly');
const wsBad = await executeTool({ slug: 'web_search', args: {} });
ok(wsBad.ok === false && /query required/.test(wsBad.error || ''), 'missing query fails honestly');

console.log('\n== 3. Runner: model-driven search → synthesize with sources ==');
const res = await runDshResearch({
  query: 'what do sources say about the moon',
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'web_search', arguments: '{"query":"moon sources"}' }] },
    { text: '## Consensus\n\nThe moon is a rocky satellite. [Moon](http://moon.example)\n\n## Sources\n- [Moon](http://moon.example)' },
  ],
  __executeOverride: async (calls) => calls.map((c) => ({
    tool_call_id: c.id,
    content: JSON.stringify({ ok: true, kind: 'web-search-result', sources: [{ url: 'http://moon.example', title: 'Moon', snippet: 'A rocky satellite' }], truncated: false }),
  })),
});
ok(res.success === true, 'runner completes with an answer');
ok(/Consensus/.test(res.summary), 'answer is synthesized (headings)');
ok(res.sources.some((s) => s.url === 'http://moon.example'), 'sources collected from web_search results');
ok(res.statistics.sourceCount === 1 && res.statistics.toolCalls === 1, 'statistics reflect the run');

console.log('\n== 4. Runner: honest degraded result when providers fail ==');
const bad = await runDshResearch({ query: 'anything', __mockCompletions: [{ toolCalls: [] }] });
ok(bad.success === false && /could not complete the research/i.test(bad.summary), 'degraded result is honest (never pretends)');
ok(Array.isArray(bad.sources), 'sources array always present');

console.log('\n== 5. Routing: research intents are DIRECT-routed away from teams ==');
const p1 = await planner.analyzeIntent('research how solar panels work and explain it');
ok(p1.intent === 'research' || p1.intent === 'learning_research', `research request classified as research (${p1.intent})`);
ok(isDirectIntent('research') === false && isDirectIntent('learning_research') === false, 'research is NOT a direct intent (goes to the runner, not bare text)');
// B157-era routing: research intents execute through the Orchestrator's
// typed research node (Search team + finalizeAnswer + domain verification).
// runDshResearch is retained as the direct/SDK runner — the chat path rides
// the orchestrator graph, which streams the same events.
const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
ok(/N\.research = this\.wrapCase\('research'/.test(orch), 'orchestrator owns the research node (Search team)');
ok(/case 'research':\s*\n\s*case 'learning_research': return 'research';/.test(orch), 'research + learning_research route to the research node');
ok(/verifyDomainAnswer\(\{ query, draft: results\.summary, domain: 'research'/.test(orch), 'research answers domain-verified before delivery');

console.log(`\nB125 dsh-research: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
