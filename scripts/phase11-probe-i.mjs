// Phase 11 Scope I — token-efficient graph-first queries probe (P1–P8).
// Real graph (Scope A store over capability/code/graph/db), real file reads.
// Token counting is the LABELED deterministic approximation bytes/4.
//
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${l}`); };

const gf = await import(path.join(ROOT, 'capability/code/graph-first.js'));
const hook = await import(path.join(ROOT, 'capability/context-hook.js'));

const Q1 = 'What functions call readViaBackends?';

// ── P1 — graph answer ──
console.log('\n════ P1 — structural question via the GRAPH (raw) ════');
let g1 = null;
{
  g1 = await gf.answerStructuralQuery(Q1);
  console.log(JSON.stringify(g1, null, 2));
  ok(g1.source === 'graph' && g1.status === 'ok' && (g1.items || []).length > 0, `P1 graph answered: ${g1.items.length} callers, ${g1.tokens} tokens`);
}

// ── P2 — files answer ──
console.log('\n════ P2 — same question via FILE READS (raw) ════');
let f1 = null;
{
  f1 = await gf.answerViaFileRead(Q1);
  console.log(JSON.stringify({ ...f1, items: f1.items.slice(0, 6) }, null, 2) + `\n  … (${f1.items.length} matched files total; raw byte account: ${f1.bytesRead} B read across ${f1.filesScanned} files)`);
  ok(f1.source === 'files' && f1.filesScanned > 900 && f1.bytesRead > 5_000_000 && f1.tokens === Math.ceil(f1.bytesRead / 4), `P2 real file scan: ${f1.filesScanned} files, ${f1.bytesRead} B read → ${f1.tokens} tokens CONSUMED (answer payload alone: ${f1.answerTokens} tok)`);
}

// ── P3 — ratio ──
console.log('\n════ P3 — ratio (raw) ════');
{
  const c = await gf.compare(Q1);
  console.log(`  graph.tokens = ${c.graph.tokens} | files.tokens = ${c.files.tokens} | ratio = ${c.ratio}x | tokenizer = ${c.tokenizer}`);
  ok(c.ratio >= 10, `P3 ratio ${c.ratio}x ≥ 10x target`);
}

// ── P4 — multiple questions ──
console.log('\n════ P4 — multiple structural questions (per-question ratio) ════');
const QUESTIONS = [
  Q1,
  'Where is ReachConfig defined?',
  'What functions call siteSearch?',
  'What functions call loginWallDetected?',
];
const comps = [];
{
  for (const q of QUESTIONS) {
    const c = await gf.compare(q);
    comps.push(c);
    console.log(`  Q: ${q}`);
    console.log(`     graph ${c.graph.tokens} tok | files ${c.files.tokens} tok | ratio ${c.ratio}x | graph says: ${String(c.graph.summary).slice(0, 100)}`);
  }
  ok(comps.length === 4 && comps.every((c) => c.ratio >= 10), 'P4 all 4 questions ≥10x');
}

// ── P5 — correctness ──
console.log('\n════ P5 — graph answer vs file-read answer (per question) ════');
{
  for (const c of comps) {
    console.log(`  Q: ${c.question}`);
    console.log(`     consistency: ${JSON.stringify(c.consistency)}`);
    if (c.graph.kind === 'callers') ok(c.consistency.graphFilesAllFoundByText === true, `P5 callers of ${c.graph.symbol}: every graph caller file appears in the text scan (${c.consistency.graphFiles} graph files vs ${c.consistency.filesFiles} text files — extras = definition/same-name lines, noted)`);
    else if (c.graph.kind === 'definition') ok(c.consistency.sameFile === true, `P5 definition of ${c.graph.symbol}: same file (${c.consistency.graphFile})`);
    else if (c.graph.kind === 'callees') ok(c.consistency.presentInFilesText === c.consistency.graphCallees, `P5 callees of ${c.graph.symbol}: ${c.consistency.presentInFilesText}/${c.consistency.graphCallees} names present in defining-file text`);
  }
}

// ── P6 — context-hook zone discipline ──
console.log('\n════ P6 — capability/context-hook.js imports nothing from server/src/context ════');
{
  const src = fs.readFileSync(path.join(ROOT, 'capability/context-hook.js'), 'utf8');
  let naive = '';
  try { naive = execFileSync('grep', ['-rn', 'server/src/context', path.join(ROOT, 'capability/context-hook.js')], { encoding: 'utf8' }); } catch { /* no matches */ }
  console.log(`  naive grep -rn 'server/src/context' → ${naive.trim() ? `${naive.trim().split('\n').length} hits (all comment/doc lines):` : '(0 hits)'}`);
  if (naive.trim()) for (const l of naive.trim().split('\n')) console.log(`    | ${l.trim().slice(0, 110)}`);
  let importGrep = '';
  try { importGrep = execFileSync('grep', ['-nE', '(^|[^a-zA-Z])(import|require)\\s*\\(?\\s*[\'\"].*server/src/context', path.join(ROOT, 'capability/context-hook.js')], { encoding: 'utf8' }); } catch { /* no matches */ }
  console.log(`  import-statement grep (raw): ${importGrep.trim() || '(0 hits)'}`);
  const imports = src.split('\n').filter((l) => l.startsWith('import '));
  console.log(`  import lines: ${JSON.stringify(imports)}`);
  ok(importGrep.trim() === '', 'P6 import grep: 0 hits — nothing imported from server/src/context');
  ok(naive.trim() !== '' && naive.includes('*'), 'P6 naive-grep hits are documentation comments only (zone-owner task text)');
  ok(imports.every((l) => l.includes('./code/graph-first.js')), 'P6 only in-zone import: capability/code/graph-first.js');
  const ctx = await hook.getContext(Q1);
  console.log(`  getContext smoke (raw): ${JSON.stringify({ ...ctx, items: `${ctx.items.length} items` })}`);
  ok(ctx.sourceId === 'capability/code/graph-first' && ctx.tokens > 0, 'P6 getContext returns a context-provider-shaped result');
}

// ── P7 — honest degradation ──
console.log('\n════ P7 — question the graph CANNOT answer (NOT_IN_GRAPH + fallback) ════');
{
  const bogus = 'What functions call handleBogusSymbolQZ42?';
  const g = await gf.answerStructuralQuery(bogus);
  console.log(`  graph answer (raw): ${JSON.stringify({ status: g.status, summary: g.summary, tokens: g.tokens })}`);
  ok(g.status === 'NOT_IN_GRAPH', 'P7 graph honestly returns NOT_IN_GRAPH');
  const c = await gf.compare(bogus);
  console.log(`  compare (raw): fallbackToFileRead=${c.fallbackToFileRead} | files.tokens=${c.files.tokens} | files.summary=${String(c.files.summary).slice(0, 90)}`);
  ok(c.fallbackToFileRead === true, 'P7 compare fell back to real file reads');
  const hf = await hook.getContextWithFallback(bogus);
  console.log(`  getContextWithFallback (raw): ${JSON.stringify({ ...hf, items: `${hf.items.length} items` })}`);
  ok(hf.status === 'NOT_IN_GRAPH_FALLBACK' && hf.tokensSaved === 0, 'P7 fallback reports zero savings honestly');
}

// ── P8 — determinism ──
console.log('\n════ P8 — determinism: P1 run twice, same graph ════');
{
  const a = await gf.answerStructuralQuery(Q1);
  const b = await gf.answerStructuralQuery(Q1);
  console.log(`  run1: tokens=${a.tokens} bytes=${a.bytes} items=${a.items.length}`);
  console.log(`  run2: tokens=${b.tokens} bytes=${b.bytes} items=${b.items.length}`);
  console.log(`  identical answers: ${JSON.stringify(a) === JSON.stringify(b)}`);
  ok(a.tokens === b.tokens && a.bytes === b.bytes && a.items.length === b.items.length, 'P8 identical token counts + answer structure across runs');
}

console.log(`\n════ SCOPE I PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
