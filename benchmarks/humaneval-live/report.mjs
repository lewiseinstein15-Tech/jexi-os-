/**
 * JEXI OS — benchmarks/humaneval-live/report.mjs
 *
 * Renders every result in results/ into one markdown table, so the headline
 * number and the ablations sit side by side and can be re-derived from the raw
 * JSON at any time.
 *
 *   node benchmarks/humaneval-live/report.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');

const files = fs.existsSync(RESULTS)
  ? fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json')).sort()
  : [];

if (!files.length) {
  console.log('no results yet — run run.mjs first');
  process.exit(0);
}

const runs = files.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')) }));

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const short = (c) => (c ? c.slice(0, 8) : 'unknown');

console.log('| run | leg | schema | model | commit | tasks | resolved | isolated |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of runs) {
  const m = r.manifest;
  console.log(`| ${short(m.runId)} | ${m.leg} | ${m.schemaMode} | ${m.model} | ${short(m.gitCommit)} | ${m.tasks} | ${r.passed}/${r.rows.length} = ${pct(r.resolved)} | ${m.gradedWithoutIsolation ? 'NO' : 'yes'} |`);
}

console.log('\n### Failure modes\n');
for (const r of runs) {
  if (r.manifest.leg !== 'jexi') continue;
  const fails = r.rows.filter((x) => !x.pass);
  if (!fails.length) continue;
  const zeroTools = fails.filter((x) => (x.toolCalls || []).length === 0).length;
  const schemaErr = fails.filter((x) => (x.toolResults || []).some((t) => /missing required property|schema:/i.test(t.error || ''))).length;
  const gradeFail = fails.filter((x) => /HUMANEVAL_GRADE=FAIL/.test(x.gradeOutput || '')).length;
  console.log(`- ${short(r.manifest.runId)} (${r.manifest.schemaMode}): ${fails.length} failed — ${zeroTools} made no tool call, ${schemaErr} hit a tool-schema rejection, ${gradeFail} produced code that ran and failed the test.`);
}

console.log('\n### Per-task\n');
for (const r of runs) {
  console.log(`\n**${r.manifest.leg}/${r.manifest.schemaMode}** — ${r.passed}/${r.rows.length}`);
  for (const x of r.rows) {
    console.log(`- ${x.pass ? 'PASS' : 'FAIL'} \`${x.taskId}\` ${x.durationMs}ms tools=${(x.toolCalls || []).length}${x.agentError ? ` agentError=${x.agentError.slice(0, 60)}` : ''}`);
  }
}
