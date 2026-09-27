#!/usr/bin/env node
/**
 * PHASE 5 P5-5 — TOOLS SIMULATION.
 *
 * "routeDecision must see the REAL tool catalog (not subset)."
 * "6 questions requiring different tools (search, file, code, math, memory,
 *  web). Assert correct tool per question."
 *
 * Every routed capability must report the REAL TOOL_REGISTRY slugs it
 * dispatches through (CAPABILITY_TOOLS bridge), and every slug must exist
 * in the live registry. Raw decisions printed.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/jexi-p55';

const ad = await import(path.join(ROOT, 'server/src/services/AgenticDecision.js'));
const tr = await import(path.join(ROOT, 'server/src/services/ToolRegistry.js'));
const dom = await import(path.join(ROOT, 'server/src/tools/domains/executor.js'));
const registrySlugs = new Set(tr.TOOL_REGISTRY.map((t) => t.slug));
const isRealTool = (slug) => registrySlugs.has(slug) || dom.hasDomainTool(slug);
console.log(`[REGISTRY] ${tr.TOOL_REGISTRY.length} registry tools + ${dom.domainToolCount()} domain tools loaded`);

const CASES = [
  { q: 'search the web for the latest news about the Mars mission', expect: 'web_search' },
  { q: 'read the file package.json and show me its contents', expect: 'file_read' },
  { q: 'run this python code that computes fibonacci(10)', expect: 'code_run' },
  { q: 'what is 17 * 24 + 9?', expect: 'direct_answer' },
  { q: 'remember that my favorite color is teal', expect: 'memory_write' },
  { q: 'what do you remember about my preferred meeting time?', expect: 'memory_read' },
];

let pass = 0;
for (const { q, expect } of CASES) {
  const d = await ad.routeDecision(q);
  const routedOk = d.route === expect;
  const toolsKnown = (d.tools || []).every((s) => isRealTool(s));
  const catalogOk = d.catalog && typeof d.catalog.total === 'number' && d.catalog.total > 0;
  const ok = d.ok && routedOk && toolsKnown && catalogOk;
  if (ok) pass++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] "${q}"`);
  console.log(`   route=${d.route} (expect ${expect}) via=${d.via} conf=${d.confidence.toFixed(2)} | tools=[${(d.tools || []).join(', ')}] | registry total=${d.catalog?.total}`);
  if (!ok) console.log(`   FAIL detail: routedOk=${routedOk} toolsAllReal=${toolsKnown} catalogOk=${catalogOk} reasoning=${d.reasoning}`);
}

console.log(`P5-5 TOOLS SIM: ${pass}/${CASES.length} PASS`);
process.exit(pass === CASES.length ? 0 : 1);
