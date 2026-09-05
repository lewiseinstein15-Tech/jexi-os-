/**
 * JEXI OS — EVALUATION RUNNER (AGI Phase 10).
 *
 * Runs the 6×10 task suite (evaluation/tasks.js) deterministically and
 * keylessly, prints per-category scores, appends the dated row to
 * evaluation/RESULTS.md, and exits non-zero below the 0.90 gate.
 * Scores are computed from real subsystem behavior — never fabricated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from './tasks.js';

const THRESHOLD = 0.90;
const failures = [];
const results = {};

for (const cat of CATEGORIES) {
  let passed = 0;
  for (const t of cat.tasks) {
    let ok = false;
    let err = null;
    try {
      const r = t.success();
      ok = (r && typeof r.then === 'function') ? !!(await r) : !!r;
    } catch (e) { err = e && e.message; }
    if (ok) passed += 1;
    else failures.push(`${t.id} (${cat.name}): ${err || 'criteria not met'}`);
  }
  results[cat.name] = { passed, total: cat.tasks.length, score: cat.tasks.length ? passed / cat.tasks.length : 0 };
}

const overall = CATEGORIES.reduce((s, c) => s + results[c.name].score, 0) / CATEGORIES.length;

console.log('\n════════════ JEXI EVALUATION SUITE (6 categories × 10 tasks) ════════════');
for (const cat of CATEGORIES) {
  const r = results[cat.name];
  console.log(`${r.score.toFixed(2).padEnd(5)} ${cat.label.padEnd(24)} ${r.passed}/${r.total}`);
}
console.log('────────────────────────────────────────────');
console.log(`OVERALL ${overall.toFixed(3)}   (gate: ${THRESHOLD})`);
if (failures.length) {
  console.log('\nFailed tasks:');
  failures.forEach((f) => console.log('  ✗', f));
}

/* record results over time */
const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'RESULTS.md');
const date = new Date().toISOString().slice(0, 10);
const row = `| ${date} | ${CATEGORIES.map((c) => results[c.name].score.toFixed(2)).join(' | ')} | **${overall.toFixed(3)}** |`;
let content;
try { content = fs.readFileSync(file, 'utf8'); } catch {
  content = `# JEXI Evaluation Suite — results over time\n\n6 categories × 10 tasks (spec §47), deterministic and keyless. Run \`node evaluation/run.js\` from \`server/\`.\n\n| Date | short | multi-step | unfamiliar | failure-recovery | tool-discovery | memory-transfer | Overall |\n|---|---|---|---|---|---|---|---|\n`;
}
const lines = content.trimEnd().split('\n');
const dateIdx = lines.findIndex((l) => l.startsWith(`| ${date} |`));
if (dateIdx >= 0) lines[dateIdx] = row; else lines.push(row);
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(`\nrecorded → server/evaluation/RESULTS.md`);

process.exit(overall >= THRESHOLD ? 0 : 1);
