/**
 * M16 — slice driver for the HumanEval live benchmark.
 *
 * run.mjs always starts at task 0 and has no offset flag, so it cannot tell a
 * task-difficulty effect apart from a position effect. This driver runs an
 * arbitrary [start, end) slice in a FRESH process, and can "warm" the process
 * with N earlier tasks first (their results are discarded).
 *
 * Usage:
 *   node slice.mjs --start 9 --end 15            # tasks 9..14, fresh process
 *   node slice.mjs --start 9 --end 15 --warm 9   # tasks 0..8 first, then 9..14
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadDataset, materialiseTask, gradeLocally } from './lib/tasks.mjs';
import { runTaskWithJexi } from './lib/agent.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};

const start = Number(arg('start', '0'));
const end = Number(arg('end', '15'));
const warm = Number(arg('warm', '0'));
const timeoutMs = Number(arg('timeout', '300')) * 1000;

const { tasks } = loadDataset();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm16-slice-'));

async function runOne(task) {
  const sandboxDir = path.join(tmpRoot, task.task_id.replace('/', '_'));
  materialiseTask(task, sandboxDir);
  const t0 = Date.now();
  let info = {};
  try {
    info = await runTaskWithJexi({ task, sandboxDir, schemaMode: 'as-shipped', toolProfile: 'full', timeoutMs, log: () => {} });
  } catch (e) { info = { error: String(e && e.message || e) }; }
  const graded = gradeLocally({ sandboxDir, solutionName: 'solution.py', testName: `test_${task.entry_point}.py`, entryPoint: task.entry_point });
  return {
    taskId: task.task_id, pass: graded.passed, durationMs: Date.now() - t0,
    tools: (info.toolCalls || []).length, error: info.error || null,
  };
}

for (let i = 0; i < Math.min(warm, start); i += 1) await runOne(tasks[i]);

const rows = [];
for (let i = start; i < end; i += 1) {
  const r = await runOne(tasks[i]);
  rows.push(r);
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.taskId.padEnd(14)} ${String(r.durationMs).padStart(7)}ms  tools=${r.tools}  ${r.error ? 'err=' + r.error.slice(0, 50) : ''}`);
}
const passed = rows.filter((r) => r.pass).length;
console.log(`\nslice [${start},${end}) warm=${warm}: ${passed}/${rows.length} = ${(passed / rows.length * 100).toFixed(1)}%`);
fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(0);
