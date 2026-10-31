/**
 * JEXI OS — benchmarks/humaneval-live/probe-toolmenu.mjs
 *
 * DIAGNOSTIC. Answers one question with evidence: when JEXI scores 0, is the
 * model failing to write code, or failing to CALL A TOOL AT ALL?
 *
 * Method: run one real task through the real loop with a fetch interceptor that
 * captures the exact chat request JEXI sends to Ollama. Then replay that exact
 * request against Ollama, varying one input at a time — the size of the offered
 * tool menu and the system prompt — and report how often the model emits a
 * native tool call.
 *
 *   node benchmarks/humaneval-live/probe-toolmenu.mjs
 *
 * Slow on CPU (each cell is a real model call). It is a probe, not a test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OLLAMA = `${String(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/v1/chat/completions`;
const MODEL = process.env.MODEL_NAME || process.env.BENCH_MODEL || 'llama3.2:3b';
const RUNS = Number(process.env.PROBE_RUNS || 4);

/** Capture the real request JEXI builds, by intercepting the fetch it makes. */
async function captureRealRequest() {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    if (!captured && String(url).includes('/chat/completions') && opts?.body) {
      captured = JSON.parse(opts.body);
    }
    return realFetch(url, opts);
  };
  try {
    const { loadDataset, materialiseTask } = await import('./lib/tasks.mjs');
    const { patchDomainSchemas } = await import('./lib/schema-patch.mjs');
    await patchDomainSchemas();
    const { setToolProfile } = await import('/workspace/project/jexi-os-/server/src/services/ToolRuntime.js');
    setToolProfile('full');
    const { tasks } = loadDataset();
    const task = tasks[0];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolmenu-'));
    materialiseTask(task, dir);
    process.env.WORKSPACE_DIR = dir;
    const { runTaskWithJexi } = await import('./lib/agent.mjs');
    await runTaskWithJexi({ task, sandboxDir: dir, schemaMode: 'repaired', toolProfile: 'full', timeoutMs: 180000, log: () => {} });
  } finally {
    globalThis.fetch = realFetch;
  }
  return captured;
}

/** Replay a captured body with one field changed; did the model call a tool? */
async function callsTool(body) {
  const res = await fetch(OLLAMA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (body.stream) return text.includes('tool_calls');
  try { return Boolean(JSON.parse(text).choices?.[0]?.message?.tool_calls?.length); } catch { return false; }
}

const SHORT_PROMPT = 'You are a helpful coding agent. Use the provided tools when useful.';

async function main() {
  const base = await captureRealRequest();
  if (!base) throw new Error('could not capture a request — did the loop reach Ollama?');
  const nTools = base.tools.length;
  console.log(`captured request: ${nTools} tools, system prompt ${base.messages[0].content.length} chars\n`);

  const conditions = [
    ['JEXI system prompt', nTools, 'jexi'],
    ['short system prompt', nTools, 'short'],
    ['JEXI system prompt', 3, 'jexi'],
    ['short system prompt', 3, 'short'],
  ];

  console.log('| system prompt | tools | tool-call rate |');
  console.log('|---|---|---|');
  for (const [label, n, prompt] of conditions) {
    const body = structuredClone(base);
    body.stream = true;
    body.model = MODEL;
    delete body.max_tokens;
    body.tools = base.tools.slice(0, n);
    if (prompt === 'short') body.messages[0].content = SHORT_PROMPT;
    let hits = 0;
    for (let i = 0; i < RUNS; i++) hits += await callsTool(body);
    console.log(`| ${label} | ${n} | ${hits}/${RUNS} |`);
  }
  console.log('\nA near-zero rate in the first two rows means the model answers in prose');
  console.log('instead of calling a tool — the zero score is a tool-adoption failure,');
  console.log('not a code-generation failure.');
}

main().then(() => process.exit(0), (e) => { console.error('probe failed:', e); process.exit(1); });
