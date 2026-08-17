/**
 * JEXI OS — Do Anything Agent regression suite (B89).
 * LLM + tool runtime fully mocked — no keys, no network.
 */

import { DoAnythingAgent, DO_ANYTHING_TOOLS } from './src/services/DoAnythingAgent.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== Tool catalog ==');
ok(Array.isArray(DO_ANYTHING_TOOLS) && DO_ANYTHING_TOOLS.length >= 20, 'curated catalog has 20+ tools');
ok(DO_ANYTHING_TOOLS.some((t) => t.slug === 'web-search' && t.desc), 'catalog entries have slug + desc');

console.log('\n== Happy path: plan → act → report ==');
{
  let call = 0;
  const gen = async (prompt) => {
    call += 1;
    if (call === 1) return JSON.stringify({ goal: 'summarize today tech news', steps: [{ tool: 'news-feed', args: { query: 'tech' }, why: 'get headlines' }, { tool: 'summarize-doc', args: { text: 'headlines' }, why: 'digest' }] });
    if (call === 2) return '### 🛠 Summary\n\nHere is the tech news digest.';
    return 'extra';
  };
  const tools = {
    async executeTool({ slug, args }) {
      if (slug === 'news-feed') return { ok: true, result: 'AI model announced today' };
      if (slug === 'summarize-doc') return { ok: true, result: 'digested' };
      return { ok: false, error: 'unknown' };
    },
  };
  const agent = new DoAnythingAgent({ generateContent: gen, executeTool: tools.executeTool.bind(tools) });
  const events = [];
  const out = await agent.run({ task: 'summarize today tech news', sendEvent: (t) => events.push(t) });
  ok(out.success === true, 'completes successfully');
  ok(events.includes('do.start') && events.includes('do.plan'), 'emits start + plan');
  ok(events.filter((t) => t === 'do.step').length === 2, 'both steps executed');
  ok(events.filter((t) => t === 'do.step-result').length === 2, 'both step results emitted');
  ok(/tech news digest/.test(out.summary), 'final summary from LLM');
  ok(out.statistics.steps === 2 && out.statistics.ok === 2, 'statistics correct');
}

console.log('\n== Failure + repair round ==');
{
  let call = 0;
  const gen = async (prompt) => {
    call += 1;
    if (call === 1) return JSON.stringify({ steps: [{ tool: 'web-search', args: { query: 'x' }, why: '' }] });
    if (call === 2) return JSON.stringify({ complete: false, missing: ['need the actual answer'] });
    if (call === 3) return JSON.stringify({ steps: [{ tool: 'deep-read', args: { url: 'https://example.com' }, why: 'get the answer' }] });
    if (call === 4) return JSON.stringify({ complete: true, missing: [] });
    if (call === 5) return 'Final report with the answer.';
    return 'extra';
  };
  const tools = {
    async executeTool({ slug }) {
      if (slug === 'web-search') return { ok: false, error: 'rate limited' };
      if (slug === 'deep-read') return { ok: true, result: 'the answer is 42' };
      return { ok: false, error: 'unknown' };
    },
  };
  const agent = new DoAnythingAgent({ generateContent: gen, executeTool: tools.executeTool.bind(tools) });
  const events = [];
  const out = await agent.run({ task: 'find the answer', sendEvent: (t) => events.push(t) });
  ok(out.success === true, 'succeeds after repair');
  ok(events.includes('do.repair'), 'repair round emitted');
  ok(out.statistics.repairs === 1, 'one repair counted');
  ok(out.statistics.steps === 2, 'two attempts total');
}

console.log('\n== Approval-required steps are skipped, not run ==');
{
  let call = 0;
  const gen = async () => {
    call += 1;
    if (call === 1) return JSON.stringify({ steps: [{ tool: 'connector-call', args: { name: 'email', method: 'send', payload: {} }, why: '' }, { tool: 'web-search', args: { query: 'y' }, why: '' }] });
    if (call === 2) return JSON.stringify({ complete: true, missing: [] });
    return 'Report.';
  };
  const tools = {
    async executeTool({ slug }) {
      if (slug === 'connector-call') return { ok: false, approvalRequired: true, error: 'external action needs approval' };
      if (slug === 'web-search') return { ok: true, result: 'results' };
      return { ok: false, error: 'unknown' };
    },
  };
  const agent = new DoAnythingAgent({ generateContent: gen, executeTool: tools.executeTool.bind(tools) });
  const out = await agent.run({ task: 'do a thing' });
  ok(out.statistics.needsApproval === 1, 'approval step recorded as needs-approval');
  ok(out.statistics.ok === 1, 'safe step still ran');
  ok(out.success === true, 'completes with approval pending');
}

console.log('\n== Blocked steps (risk guard) respected ==');
{
  let call = 0;
  const gen = async () => {
    call += 1;
    if (call === 1) return JSON.stringify({ steps: [{ tool: 'code-run', args: { command: 'rm -rf /' }, why: '' }] });
    if (call === 2) return JSON.stringify({ complete: true, missing: [] });
    return 'Report.';
  };
  const tools = {
    async executeTool() { return { ok: false, blocked: true, error: 'Risk guard blocked this call' }; },
  };
  const agent = new DoAnythingAgent({ generateContent: gen, executeTool: tools.executeTool.bind(tools) });
  const out = await agent.run({ task: 'x' });
  ok(out.statistics.blocked === 1, 'blocked step counted');
}

console.log('\n== No keys → honest failure ==');
{
  const agent = new DoAnythingAgent({ generateContent: null, executeTool: null });
  const out = await agent.run({ task: 'anything' });
  ok(out.success === false && /AI key/.test(out.summary), 'honest degraded failure');
}

console.log('\n== Malformed plan → honest failure, no crash ==');
{
  const agent = new DoAnythingAgent({ generateContent: async () => 'not json', executeTool: async () => ({ ok: false }) });
  const out = await agent.run({ task: 'x' });
  ok(out.success === false && /could not form a plan/.test(out.summary), 'malformed plan handled');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
