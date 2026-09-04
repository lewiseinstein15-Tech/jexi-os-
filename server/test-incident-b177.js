/**
 * B177 — the two live-incident fixes (found in the user's real logs).
 *
 *   1. linkAnalysis crash   — "analyze: YouTube video — <title>" (NO link)
 *                             threw `plan.payload.url` → whole turn died with
 *                             "Cannot read properties of undefined (reading
 *                             'url')". Guarded + research fallback.
 *   2. Groq model retirement— llama-3.1-8b-instant 404s (model_not_found,
 *                             106/106 failed calls). Default bumped to a
 *                             current tier + RUNTIME self-healing: on
 *                             model_not_found the client asks /models and
 *                             retries once with a live model (cached).
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

/* ══════════════ 1. LINK-ANALYSIS CRASH (the user's exact message) ══════════════ */
console.log('\n== 1. no-link message no longer crashes the turn ==');
{
  const { orchestrator } = await import('./src/services/Orchestrator.js');
  const nodes = orchestrator.buildNodes();
  ok('linkAnalysis node exists', typeof nodes.linkAnalysis === 'function');

  // The user's REAL failing state: plan with NO payload (their message had
  // "YouTube video" but no URL). Before B177 this threw on plan.payload.url.
  const state = {
    query: 'analyze: YouTube video — How AI Works',
    plan: { intent: 'link_analysis' }, // payload: undefined  ← the crash
    context: {
      results: { summary: '', statistics: {} },
      sendEvent: (t, d) => {},
      opts: {},
    },
    intermediateResults: {},
  };
  let crashed = false;
  let summary = '';
  try {
    await nodes.linkAnalysis(state);
    summary = state.context.results.summary || '';
  } catch (e) {
    crashed = true;
    console.log('   crash:', e.message);
  }
  ok('no crash on a link-analysis request without a link', crashed === false);
  ok('user gets a helpful answer instead of an error', summary.length > 20 && !summary.includes('hit a problem'));

  // And WITH a real link, the normal path is unchanged
  const src = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
  ok('guard uses optional chaining (payload?.url)', src.includes('plan?.payload?.url'));
  ok('fullQuery read also guarded', src.includes('plan?.payload?.fullQuery'));
}

/* ══════════════ 2. GROQ MODEL SELF-HEALING ══════════════ */
console.log('\n== 2. Groq model retirement self-heals ==');
{
  const llmSrc = fs.readFileSync('./src/services/LLMClient.js', 'utf-8');
  ok('default model is the live catalog flagship (B219: llama line retired)', llmSrc.includes("const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b'"));
  ok('runtime discovery on model_not_found', llmSrc.includes('discoverGroqModel') && llmSrc.includes('/models'));
  ok('discovered model cached for the process', llmSrc.includes('groqModelCache'));
  ok('retry uses the discovered model once', /model: discovered/.test(llmSrc));
  ok('streaming/REST path uses the cache too', llmSrc.includes('opts.model || groqModelCache || GROQ_TEXT_MODEL'));

  // Behavioral: the discovery picker prefers sensible models
  const { __pickGroqModel } = await import('./src/services/LLMClient.js');
  // B219 — preference follows the LIVE catalog: llama is retired, gpt-oss leads.
  const good = __pickGroqModel(['openai/gpt-oss-20b', 'groq/llama-3.3-70b-versatile', 'qwen/qwen3-32b']);
  ok(`picker prefers gpt-oss over retired llama (got: ${good})`, good === 'openai/gpt-oss-20b');
  const best = __pickGroqModel(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  ok(`picker prefers the 120B flagship (got: ${best})`, best === 'openai/gpt-oss-120b');
  const weird = __pickGroqModel(['vendorx/mystery-1', 'vendorz/mystery-2']);
  ok('falls back to the first available when nothing matches', weird === 'vendorx/mystery-1');
  ok('empty list → null', __pickGroqModel([]) === null);
}

console.log(`\n${failures === 0 ? '🎉 ALL B177 INCIDENT-FIX CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
