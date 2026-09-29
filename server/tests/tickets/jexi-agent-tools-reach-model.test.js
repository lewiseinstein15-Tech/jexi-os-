/**
 * JEXI-002 / JEXI-021 — the tool surface must REACH the model, not just
 * exist in AgentLoop.
 *
 * An earlier note claimed "AgentLoop counts schemas but never sends them to
 * the model". A live probe of the real outbound request body disproved that:
 * the body carried all 12 declared tools with tool_choice:'auto' and the model
 * made real calls. So there was nothing to fix in the sending path — but the
 * claim was never guarded, which is how a false defect report survives.
 *
 * This test intercepts the outbound body (wiring under test, no network) so
 * the property stays enforced. The live half of the proof is
 * probe-agentloop-tools.mjs, which runs the same path against a real model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildOfferedTools } from '../../src/services/agent/ToolSetBuilder.js';
import { generateWithToolsLoop, normalizeTools } from '../../src/providers/runtime/LLMClient.js';

test('JEXI-021: the coding builder offers a real, non-empty coding tool set', async () => {
  const offered = await buildOfferedTools({
    plan: { intent: 'code', steps: ['edit', 'test'] },
    query: 'The pytest suite is failing. Read the failing test, fix the module, re-run the tests.',
    emit: () => {},
  });
  assert.ok(offered.schemas.length > 0, 'a coding turn must offer tools');
  const names = offered.schemas.map((s) => s.function?.name || s.slug);
  for (const need of ['fs_read', 'fs_edit', 'pytest_run']) {
    assert.ok(names.includes(need), `missing ${need} from ${names.join(', ')}`);
  }
});

test('JEXI-002: the provider body DECLARES the offered tools with tool_choice auto', async () => {
  const offered = await buildOfferedTools({
    plan: { intent: 'code', steps: ['edit', 'test'] },
    query: 'The pytest suite is failing. Read the failing test, fix the module, re-run the tests.',
    emit: () => {},
  });

  // Intercept only the body; the response is stubbed so no network/key is used.
  // The `ollama` lane is the seam: it carries a dummy key by design, so this
  // test needs no credential and cannot bill a real provider.
  const bodies = [];
  const realFetch = globalThis.fetch;
  const realHost = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      try { bodies.push(JSON.parse(init?.body || '{}')); } catch { bodies.push({}); }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };

  try {
    await generateWithToolsLoop('fix it', 'coding agent', offered.schemas, {
      provider: 'ollama', maxIterations: 1,
      executeToolCalls: async () => [],
    }).catch(() => { /* the body capture is the assertion, not the answer */ });
  } finally {
    globalThis.fetch = realFetch;
    if (realHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = realHost;
  }

  assert.ok(bodies.length > 0, 'no /chat/completions request was made — cannot prove the tools are sent');
  const body = bodies[0];
  assert.ok(Array.isArray(body.tools), 'the request body must carry a `tools` array');
  assert.equal(body.tools.length, offered.schemas.length,
    'every offered schema must survive into the request body');
  assert.equal(body.tool_choice, 'auto', 'tool_choice must be auto, not "none"');
  const sent = body.tools.map((t) => t.function?.name);
  for (const need of ['fs_read', 'fs_edit', 'pytest_run']) {
    assert.ok(sent.includes(need), `${need} never reached the request body`);
  }
});

test('JEXI-002: normalizeTools keeps the def-shaped tools the builder emits', () => {
  const out = normalizeTools([
    { slug: 'fs_read', desc: 'read a file', schema: { path: { type: 'string', desc: 'p', required: true } } },
    { slug: 'pytest_run', desc: 'run tests', schema: {} },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'function');
  assert.equal(out[0].function.name, 'fs_read');
  assert.deepEqual(out[0].function.parameters.required, ['path']);
});
