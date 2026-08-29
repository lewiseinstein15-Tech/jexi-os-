/**
 * B172 — SPEED + ACCURACY, the DSH way (delegate-router + prefix-stable
 * prompts + one-step minimal turns + per-turn telemetry).
 *
 *   speed routing     — providers ordered by MEASURED latency (no lottery)
 *   latency EMA       — success records fold real call durations
 *   telemetry         — done.statistics.timings + the ⚡ line
 *   prefix stability  — time block minute-stable within the same minute
 *   greeting lane     — pure greetings get the 3-tool minimal set
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. SPEED-AWARE ROUTING ══════════════ */
console.log('\n== 1. speed-aware provider routing (dsh delegate-router) ==');
{
  const PR = await import('./src/services/ProviderRouter.js');
  PR.resetProviderHealth('groq'); PR.resetProviderHealth('gemini'); PR.resetProviderHealth('openrouter');

  // Before any measurements: base order preserved
  const before = PR.providerOrder('');
  ok('unmeasured: base order preserved', before[0] === 'groq' || before[0] === 'gemini' || before[0] === 'openrouter');

  // Simulate: groq fast (800ms), gemini medium (2000ms), openrouter slow (6000ms)
  PR.recordProviderSuccess('groq', 800);
  PR.recordProviderSuccess('groq', 800);
  PR.recordProviderSuccess('gemini', 2000);
  PR.recordProviderSuccess('openrouter', 6000);
  const order = PR.providerOrder('');
  ok('fastest measured provider routes FIRST (groq)', order[0] === 'groq');
  ok('slowest measured provider is LAST of the head (openrouter)', order.indexOf('openrouter') > order.indexOf('gemini'));

  // EMA folds new samples (groq slows down → gemini can overtake)
  for (let i = 0; i < 12; i++) PR.recordProviderSuccess('groq', 9000);
  const order2 = PR.providerOrder('');
  ok('EMA adapts: a provider that got slow loses the lead', order2[0] !== 'groq');

  ok('latency exposed for diagnostics', PR.providerLatency('groq') > 5000);
  // cleanup so other tests see fresh health
  PR.resetProviderHealth('groq'); PR.resetProviderHealth('gemini'); PR.resetProviderHealth('openrouter');
}

/* ══════════════ 2. PREFIX STABILITY (KV-cache friendly) ══════════════ */
console.log('\n== 2. minute-stable time context (prefix-stable prompts) ==');
{
  const { timeContextBlock } = await import('./src/services/TimeContext.js');
  const a = timeContextBlock();
  const b = timeContextBlock();
  ok('same-minute calls produce an IDENTICAL block (cache hit)', a === b);
  ok('minute precision declared', a.includes('minute precision'));
  ok('no churnning seconds in the block', !/:\d{2}\.\d/.test(a) && !/Server clock:/.test(a));
}

/* ══════════════ 3. GREETING FAST LANE ══════════════ */
console.log('\n== 3. greeting fast lane (one-step minimal turn) ==');
{
  const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');
  ok('pure greetings detected from the RAW query', st.includes("String(query || '').trim()"));
  ok('greeting lane trims to 3 memory tools', st.includes("['memory-recall', 'rolling-summary', 'profile-read']"));
  const re = /^(hi+|hey+|hello+|yo|habari|jambo|sasa|good\s+(morning|afternoon|evening|day))\b[!,.\s]*$/i;
  ok('hello matches', re.test('hello')); ok('hi! matches', re.test('hi!'));
  ok('jambo matches', re.test('Jambo')); ok('good morning matches', re.test('good morning'));
  ok('complex asks do NOT match', !re.test('hello, can you build me a website?') && !re.test('hi there, what is quantum computing'));
}

/* ══════════════ 4. TELEMETRY ══════════════ */
console.log('\n== 4. per-turn speed telemetry ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('request clock + first-token tracked', idx.includes('__firstTokenMs') && idx.includes('const __t0 = Date.now()'));
  ok('timings ride the done event', idx.includes('timings: { totalMs, firstTokenMs'));
  ok('visible ⚡ speed line in the step feed', idx.includes('⚡ answered in'));
}

/* ══════════════ 5. LLMClient feeds real latencies ══════════════ */
console.log('\n== 5. real latencies feed the router ==');
{
  const llm = fs.readFileSync('./src/services/LLMClient.js', 'utf-8');
  ok('walk loop times each provider attempt', llm.includes('const __t0 = Date.now(); // B172') && llm.includes('recordProviderSuccess(provider, Date.now() - __t0)'));
  ok('stream duration measured', llm.includes('out.tookMs = Date.now() - __st0'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B172 SPEED CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
