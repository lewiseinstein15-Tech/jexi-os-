/**
 * M19 — PHASE 3: TOOL-CALL RELIABILITY EXPERIMENTS.
 *
 * Measures, for one model on the live Ollama endpoint, the rate at which it
 * produces a USABLE tool call under four controlled conditions that change one
 * variable at a time:
 *
 *   A  full-prompt        — JEXI's real assembled system prompt + full menu
 *   B  reduced-prompt     — short essential-instructions system prompt, same menu
 *   C  reduced-catalogue  — full prompt, only the coding tools
 *   D  concise-desc       — full prompt, tool descriptions trimmed
 *
 * The prompt and the full tool menu are captured from a REAL AgentLoop request
 * (fetch is intercepted for one call, then restored), so conditions A/C/D test
 * exactly what JEXI sends. Every trial is a REAL HTTP round against Ollama.
 *
 * Classification (never counts a call as success):
 *   native    — a native tool_calls array, every call in-menu and parseable
 *   recovered — no native call, but the REAL recovery path found an in-menu call
 *   invalid   — a call attempt whose name is not offered / args unparseable
 *   no-call   — prose or empty, no tool attempt
 *
 * Usage:
 *   MODEL_PROVIDER=ollama OLLAMA_HOST=127.0.0.1:11434 \
 *     node benchmarks/humaneval-live/toolcall-reliability.mjs --reps 3 --task 0
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVER = '/workspace/project/jexi-os-/server';
const HERE = path.dirname(new URL(import.meta.url).pathname);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};

const REPS = Number(arg('reps', '3'));
const TASK_INDEX = Number(arg('task', '0'));
const HOST = (String(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '').startsWith('http')
  ? String(process.env.OLLAMA_HOST).replace(/\/+$/, '')
  : `http://${String(process.env.OLLAMA_HOST).replace(/\/+$/, '')}`);
const MODEL = String(process.env.BENCH_MODEL || process.env.MODEL_NAME || 'llama3.2:3b');
const CODING = new Set(['fs_write', 'fs_read', 'fs_edit', 'term_execute', 'pytest_run', 'fs_ls', 'fs_glob', 'fs_grep']);

function concise(desc, max = 90) {
  const s = String(desc || '');
  const cut = s.split(/(?<=\.)\s/)[0] || s;
  return cut.length > max ? cut.slice(0, max) : cut;
}

/** Capture the exact system prompt + tool menu a real AgentLoop run sends. */
async function captureRealRequest(task, dir) {
  const query = [
    `Complete this Python function by writing the full implementation to the file ${path.join(dir, 'solution.py')}.`,
    '', '```python', task.prompt.trim(), '```', '',
    `Use the code-write tool to write the complete file to ${path.join(dir, 'solution.py')}. Do not reply with the code`,
    'as text — the file on disk is what is graded.',
    `Keep the exact function name (${task.entry_point}) and signature.`,
    `A test file, test_${task.entry_point}.py, is already in the same directory. Use the code-run tool to run it and confirm it passes.`,
  ].join('\n');

  const realFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      try { captured.push(JSON.parse(init?.body || '{}')); } catch { /* skip */ }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  const prevWs = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = dir;
  try {
    const { runTaskWithJexi } = await import(path.join(HERE, 'lib/agent.mjs'));
    await runTaskWithJexi({ task, sandboxDir: dir, schemaMode: 'as-shipped', toolProfile: 'full', timeoutMs: 20_000, log: () => {} }).catch(() => {});
  } finally {
    globalThis.fetch = realFetch;
    if (prevWs === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prevWs;
  }
  // The planning/classify calls carry no tools; the tool-calling round is the
  // captured request with the LARGEST menu (that is the real offer).
  const withTools = captured.filter((c) => Array.isArray(c.tools) && c.tools.length);
  if (!withTools.length) throw new Error(`failed to capture a tool-carrying AgentLoop request (captured ${captured.length} calls, none with tools)`);
  const best = withTools.reduce((a, b) => (b.tools.length > a.tools.length ? b : a));
  const system = (best.messages || []).find((m) => m.role === 'system')?.content || '';
  const user = (best.messages || []).find((m) => m.role === 'user')?.content || '';
  return { system, user, tools: best.tools, capturedCalls: captured.length, toolCalls: withTools.length };
}

/** One real tool-calling round; classifies the outcome. */
async function round(messages, tools, label, timeoutMs = 600_000) {
  const body = { model: MODEL, messages, tools, tool_choice: 'auto', temperature: 0.3, stream: false, max_tokens: 1024 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { label, kind: 'http-error', status: res.status, ms: Date.now() - started };
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    const native = (msg.tool_calls || []).filter((tc) => tc && tc.function);
    const text = String(msg.content || '');
    const offered = tools.map((t) => t.function.name);

    if (native.length) {
      for (const tc of native) {
        const name = tc.function?.name || '';
        let parsed = null;
        try { parsed = JSON.parse(tc.function.arguments || '{}'); } catch { parsed = null; }
        if (!offered.includes(name)) return { label, kind: 'invalid', why: `name ${name} not offered`, ms: Date.now() - started };
        if (!parsed) return { label, kind: 'invalid', why: 'args unparseable', ms: Date.now() - started };
      }
      return { label, kind: 'native', count: native.length, names: native.map((tc) => tc.function.name), ms: Date.now() - started };
    }

    const { recoverToolCallsFromText, looksLikeToolAttempt } = await import(path.join(SERVER, 'src/services/agent/ToolCallRecovery.js'));
    const recovered = recoverToolCallsFromText(text, offered);
    if (recovered.length) return { label, kind: 'recovered', count: recovered.length, names: recovered.map((c) => c.name), aliasedFrom: recovered.map((c) => c.aliasedFrom).filter(Boolean), ms: Date.now() - started };
    if (looksLikeToolAttempt(text)) {
      // Record WHAT the model tried to call, so an unresolved alias is visible.
      const tried = [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      return { label, kind: 'invalid', why: 'prose call, name not in menu', tried, ms: Date.now() - started };
    }
    return { label, kind: 'no-call', textLen: text.length, ms: Date.now() - started };
  } catch (e) {
    return { label, kind: 'error', why: String((e && e.message) || e).slice(0, 120), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { loadDataset, materialiseTask } = await import(path.join(HERE, 'lib/tasks.mjs'));
  const { tasks } = loadDataset();
  const task = tasks[TASK_INDEX];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm19-phase3-'));
  materialiseTask(task, dir);

  const captured = await captureRealRequest(task, dir);
  const fullMenu = captured.tools;
  const codingMenu = fullMenu.filter((t) => CODING.has(t.function.name));
  const conciseMenu = fullMenu.map((t) => ({ type: 'function', function: { ...t.function, description: concise(t.function.description) } }));
  const reducedSystem = 'You are JEXI, a coding agent working in a sandbox. Use the provided tools to do the work: '
    + 'write files with fs_write (arguments: path, content) and run commands with term_execute. '
    + 'The file on disk is what is graded. Keep the exact function name and signature.';

  const conditions = [
    { key: 'A_full-prompt', system: captured.system, tools: fullMenu },
    { key: 'B_reduced-prompt', system: reducedSystem, tools: fullMenu },
    { key: 'C_reduced-catalogue', system: captured.system, tools: codingMenu },
    { key: 'D_concise-desc', system: captured.system, tools: conciseMenu },
  ];

  console.log(`[phase3] model=${MODEL} host=${HOST} task=${task.task_id} reps=${REPS}`);
  console.log(`[phase3] captured system=${captured.system.length} chars · menu full=${fullMenu.length} coding=${codingMenu.length}`);
  const out = { model: MODEL, host: HOST, task: task.task_id, reps: REPS, generatedAt: new Date().toISOString(), captured: { systemChars: captured.system.length, menuSize: fullMenu.length }, conditions: [] };

  for (const c of conditions) {
    const trials = [];
    for (let i = 0; i < REPS; i++) {
      const messages = [
        ...(c.system ? [{ role: 'system', content: c.system }] : []),
        { role: 'user', content: captured.user },
      ];
      const r = await round(messages, c.tools, c.key);
      trials.push(r);
      console.log(`  ${c.key.padEnd(22)} rep${i} -> ${r.kind}${r.why ? ' (' + r.why + ')' : ''}${r.names ? ' ' + JSON.stringify(r.names) : ''} ${r.ms}ms`);
    }
    const tally = trials.reduce((a, t) => { a[t.kind] = (a[t.kind] || 0) + 1; return a; }, {});
    const usable = (tally.native || 0) + (tally.recovered || 0);
    out.conditions.push({ key: c.key, menuSize: c.tools.length, systemChars: (c.system || '').length, tally, usable, usableRate: usable / REPS, trials });
    console.log(`  ${c.key.padEnd(22)} => usable ${usable}/${REPS}  ${JSON.stringify(tally)}`);
  }

  const outPath = path.join(HERE, 'results', `m19-toolcall-reliability-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[phase3] wrote ${outPath}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => { console.error('[phase3] fatal:', e); process.exit(1); });
