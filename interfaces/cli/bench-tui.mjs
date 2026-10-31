#!/usr/bin/env node
/**
 * M13 — TUI BENCHMARK DRIVER.
 *
 * Runs benchmark tasks THROUGH the TUI loop — the same `runTui` the interactive
 * `jexi tui` uses, fed a scripted key stream — against the real backend. This
 * exists so a benchmark measures the interface people actually use, not a
 * private API path that could diverge from it.
 *
 * Usage (from repo root, backend already running):
 *   node interfaces/cli/bench-tui.mjs --base http://127.0.0.1:3002 \
 *        --tasks interfaces/cli/bench-tasks.jsonl --out /tmp/bench.json
 *
 * Each task line: { "id": "t1", "prompt": "…", "expect": "substring" }.
 * Output: one JSON object per task (raw), plus a summary line. Exit code is
 * nonzero if any task failed, so it can gate a pipeline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { JexiApi } from './lib/api.js';
import { runTui } from './lib/tui/app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { base: process.env.JEXI_BASE_URL || 'http://127.0.0.1:3002', tasks: path.join(HERE, 'bench-tasks.jsonl'), out: null, timeout: 120000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--tasks') out.tasks = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--timeout') out.timeout = Number(argv[++i]) || out.timeout;
  }
  return out;
}

/** A scripted stdin: yields the given chunks in order, then EOF. */
function scriptedStdin(chunks) {
  const s = Readable.from(chunks.map((c) => Buffer.from(c, 'utf8')));
  s.isTTY = false;
  return s;
}

/** A silent stdout that still reports the columns/rows the frame math needs. */
function silentStdout() {
  const chunks = [];
  const s = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  s.columns = 100; s.rows = 30; s.isTTY = false; s.chunks = chunks;
  return s;
}

/** Run one task through the TUI loop; resolve a raw result record. */
async function runTask(task, { base, timeout }) {
  const api = new JexiApi({ baseUrl: base });
  api.setSession(`bench-${task.id}`);
  const stdout = silentStdout();
  // Just the task, then EOF: the key pump ends, the main loop breaks, and
  // runTui awaits the in-flight turn before returning — so the answer is
  // complete when this resolves. (Ctrl+C would abort the turn instead.)
  const stdin = scriptedStdin([`${task.prompt}\r`]);

  const started = Date.now();
  let state;
  let timer = null;
  try {
    state = await Promise.race([
      runTui({ input: stdin, output: stdout, api, headless: true }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('task timeout')), timeout); }),
    ]);
  } catch (e) {
    return { id: task.id, ok: false, error: (e && e.message) || String(e), ms: Date.now() - started };
  } finally {
    // The losing race arm must not hold the event loop open.
    if (timer) clearTimeout(timer);
  }

  const rows = (state.t && state.t.rows) || [];
  const streamed = rows.filter((r) => r.kind === 'text').map((r) => r.text).join('\n');
  // Fast turns answer in the terminal summary (no streamed deltas); a slow
  // turn streams. The terminal row carries the summary in its text.
  const terminal = rows.filter((r) => r.kind === 'turn-end-ok').map((r) => r.text || '').join('\n');
  const answer = `${streamed}\n${terminal}`.trim();
  const toolRows = rows.filter((r) => r.kind === 'tool-result' || r.kind === 'tool-error');
  const failures = rows.filter((r) => r.kind === 'turn-end-fail');
  const expectOk = !task.expect || answer.includes(task.expect);

  return {
    id: task.id,
    ok: failures.length === 0 && expectOk,
    ms: Date.now() - started,
    events: state.t ? state.t.stats.turns : 0,
    tools: toolRows.length,
    toolErrors: toolRows.filter((r) => r.kind === 'tool-error').length,
    answerChars: answer.length,
    expectOk,
    answerHead: answer.slice(0, 200),
    failures: failures.map((f) => f.text),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.tasks)) {
    console.error(`no tasks file: ${opts.tasks}`);
    process.exit(2);
  }
  const tasks = fs.readFileSync(opts.tasks, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  const results = [];
  for (const task of tasks) {
    const r = await runTask(task, opts);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const passed = results.filter((r) => r.ok).length;
  const summary = { total: results.length, passed, failed: results.length - passed, base: opts.base };
  console.log(JSON.stringify({ summary }));
  if (opts.out) fs.writeFileSync(opts.out, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((e) => { console.error(`bench-tui: ${(e && e.message) || e}`); process.exitCode = 2; });
