/**
 * PROBE — does AgentLoop's tool surface actually reach the model?
 *
 * Two independent checks, no mocks:
 *   1. the builder's output (what AgentLoop passes in as `schemas`)
 *   2. a REAL model call through the real generateWithToolsLoop, with
 *      outbound fetch bodies recorded on the way past. If the body declares
 *      zero tools, the model cannot call one — that is the defect.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');   // scripts live in acceptance/, repo is the parent

/* ── 1. the builder, called exactly as AgentLoop calls it ───────── */
const { buildOfferedTools } = await import(path.join(SRC, 'src/services/agent/ToolSetBuilder.js'));
const offered = await buildOfferedTools({
  plan: { intent: 'code', steps: ['edit', 'test'] },
  query: 'The pytest suite is failing. Read the failing test, fix the module, re-run the tests.',
  emit: () => {},
});
console.log('1. buildOfferedTools -> schemas:', offered.schemas.length);
console.log('   ', offered.schemas.map((s) => s.function?.name || s.slug).join(', ') || '(none)');

/* ── 2. record real outbound bodies, still calling the real API ──── */
const bodies = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/chat/completions')) {
    try { bodies.push(JSON.parse(init?.body || '{}')); } catch { bodies.push({ __unparsed: true }); }
  }
  return realFetch(url, init);
};

/* ── 3. a REAL call through the real loop ────────────────────────── */
const { generateWithToolsLoop, normalizeTools } = await import(path.join(SRC, 'src/providers/runtime/LLMClient.js'));
console.log('2. normalizeTools   -> provider-ready defs:', normalizeTools(offered.schemas).length);

const executed = [];
const res = await generateWithToolsLoop(
  'The pytest suite in this project is failing. Read the failing test, read the module it imports, make the minimal edit, then re-run the tests. Use the tools.',
  'You are a coding agent with tool access. Call tools; do not describe what you would do.',
  offered.schemas,
  {
    provider: 'groq', temperature: 0.2, maxIterations: 2,
    executeToolCalls: async (calls) => {
      for (const c of calls) {
        executed.push(c.name);
        return [{ tool_call_id: c.id, content: `TOOL ${c.name} RAN (probe) — this is a probe sandbox, no real edit was made.` }];
      }
      return [];
    },
  },
).catch((e) => ({ ok: false, error: e.message }));

globalThis.fetch = realFetch;

console.log('\n3. real /chat/completions bodies sent:');
if (!bodies.length) console.log('   (none captured)');
for (const b of bodies) {
  console.log('   model      :', b.model);
  console.log('   tools      :', Array.isArray(b.tools) ? `${b.tools.length} declared` : String(b.tools));
  console.log('   names      :', (b.tools || []).map((t) => t.function?.name).join(', ') || '(NONE SENT)');
  console.log('   tool_choice:', b.tool_choice);
}
console.log('\n4. loop result :', JSON.stringify({ ok: res?.ok, provider: res?.provider, model: res?.model, error: res?.error }));
console.log('5. tools the model ACTUALLY called:', executed.length ? executed.join(', ') : '(none)');
console.log('6. answer      :', String(res?.text || '').slice(0, 200) || '(none)');
