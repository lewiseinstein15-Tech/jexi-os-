#!/usr/bin/env node
/**
 * B204 — RESEARCH LATENCY: OVERLAP + CORE-QUERY + ADAPTIVE READS
 *
 * Production telemetry (B203 post-deploy run): first answer word at 89.3s —
 * Query Analyzer LLM call 34s (serial, before ANY search) + searches 22s +
 * deep-read 31s (serialized by B203). Three tunings:
 *
 *  1. coreQuery() — strip leading answer-format packaging ("In one short
 *     paragraph:", "briefly:") before complexity scoring, so simple
 *     questions never pay the 34s LLM decomposition at all.
 *  2. Overlap — the raw-question searchOne() starts the instant research
 *     begins; the analyzer's LLM call runs alongside it instead of before it.
 *  3. readConcurrency() — with B203's memory caps in place, deep-read at
 *     concurrency 2 when RSS < 300MB (halves ~31s → ~16s), else 1.
 */
import {
  coreQuery, isComplexQuery, analyzeQuery, mergePools, readConcurrency,
} from './src/services/SearchAgent.js';
import fs from 'node:fs';
import { planner } from './src/services/Planner.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('B204: research latency tuning\n');

// --- 1. coreQuery strips packaging, keeps the question ---
console.log('[1] coreQuery strips answer-format packaging');
for (const [q, want] of [
  ['In one short paragraph: what are the three largest lakes in Africa by area?', 'what are the three largest lakes in Africa by area?'],
  ['briefly: what is the capital of France', 'what is the capital of France'],
  ['Please in a short sentence explain photosynthesis', 'explain photosynthesis'],
  ['In your own words: describe the water cycle', 'describe the water cycle'],
  ['what is love', 'what is love'],
  ['', ''],
]) {
  check(`coreQuery(${JSON.stringify(q.slice(0, 40))})`, coreQuery(q) === want, `got ${JSON.stringify(coreQuery(q))}`);
}

// --- 2. complexity is measured on the core, not the packaging ---
console.log('\n[2] isComplexQuery scores the core question');
check('lakes question (76 chars with packaging) is SIMPLE', !isComplexQuery('In one short paragraph: what are the three largest lakes in Africa by area?'));
check('compare question stays COMPLEX', isComplexQuery('compare the economic impact of coffee farming in Kenya and Ethiopia'));
check('long question stays COMPLEX', isComplexQuery('what are the long-term effects of deforestation on rainfall patterns across the Amazon basin and how do they affect agriculture downstream'));

// --- 3. analyzeQuery: simple → single core sub-query, no LLM needed ---
console.log('\n[3] analyzeQuery simple path');
{
  const t0 = Date.now();
  const plan = await analyzeQuery('In one short paragraph: what are the three largest lakes in Africa by area?');
  const ms = Date.now() - t0;
  check('simple → complex:false', plan.complex === false);
  check('simple → subQueries = [core]', plan.subQueries[0] === 'what are the three largest lakes in Africa by area?');
  check(`simple path is instant (${ms}ms, no LLM round-trip)`, ms < 1500);
}
{
  // complex path with dead providers → falls back to the core, still complex
  const plan = await analyzeQuery('compare the economic impact of coffee farming in Kenya and Ethiopia');
  check('complex fallback → complex:true', plan.complex === true);
  check('complex fallback → subQueries non-empty', plan.subQueries.length >= 1);
}

// --- 4. mergePools: dedupe + resilience ---
console.log('\n[4] mergePools');
{
  const { merged } = mergePools([
    { status: 'fulfilled', value: { query: 'a', results: [{ link: 'https://x.com/1' }, { link: 'https://x.com/1#anchor' }, { link: 'https://y.com/' }] } },
    { status: 'rejected', reason: new Error('engine down') },
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: { query: 'b', results: [{ link: 'https://y.com' }, { link: 'https://z.com/?utm_source=rss' }] } },
  ]);
  check(`dedupes across pools (got ${merged.length}, want 3)`, merged.length === 3);
  check('subQuery tag survives', merged.every((m) => typeof m.subQuery === 'string'));
}

// --- 5. readConcurrency is adaptive and sane ---
console.log('\n[5] readConcurrency');
{
  const c = readConcurrency();
  check(`returns 1 or 2 (got ${c})`, c === 1 || c === 2);
}

// --- 6. the overlap is wired in source order ---
console.log('\n[6] overlap wiring (raw search starts BEFORE the analyzer awaits)');
{
  const src = fs.readFileSync('./src/services/SearchAgent.js', 'utf-8');
  const kickoff = src.indexOf('searchOne(core).catch');
  const analyzer = src.indexOf('await analyzeQuery');
  check('raw-query search kicks off before the analyzer awaits', kickoff !== -1 && analyzer !== -1 && kickoff < analyzer);
  const merge = src.indexOf('mergePools(await Promise.allSettled');
  check('settled pools go through mergePools', merge !== -1);
}

// --- 7. B202 regression: ranked lists still route to research ---
console.log('\n[7] B202 regression guard');
{
  const p = await planner._classifyRegex('what are the three largest lakes in Africa by area?');
  check('ranked-list question still routes to research', p.intent === 'research');
  const p2 = await planner._classifyRegex('what is the capital of Kenya');
  check('simple fact still direct_answer', p2.intent === 'direct_answer');
}

console.log(`\nB204: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
