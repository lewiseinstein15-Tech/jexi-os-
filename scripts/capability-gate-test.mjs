#!/usr/bin/env node
/**
 * P10 GAP 5 — CAPABILITY GATE (regex → semantic) — acceptance test.
 *
 * Spec: 10 novel phrasings of the same capability (web_search) — paraphrases
 * the regex evidence cascade was NOT built for. Assert ≥8/10 route to the
 * correct capability through the FULL layered gate, and that the semantic
 * layer genuinely contributes (≥3 of the hits arrive via 'semantic' — i.e.
 * phrasings the regex layer missed or mis-routed, caught by the vector
 * layer). Assert no false positives on 5 unrelated queries (none routes to
 * web_search).
 */
import { routeDecision } from '../server/src/services/AgenticDecision.js';
import { semanticScores } from '../server/src/services/CapabilitySemantic.js';

const CAPABILITY = 'web_search';

const PARAPHRASES = [
  'catch me up on the latest space headlines',
  'pull up recent articles about electric vehicles',
  'find out what is happening with the stock market today',
  'look for current stories about the World Cup',
  'what is the newest on the AI regulation debate?',
  'get me today\'s top tech stories',
  'scour the internet for news about the merger',
  'browse for fresh publications on climate change',
  'dig up the latest reports on the housing market',
  'show me breaking stories from this hour',
];

const UNRELATED = [
  'what is 17 * 24 + 9?',
  'write a haiku about the ocean',
  'my name is Lewis',
  'what is my name?',
  'explain Bayes theorem',
];

let pass = 0, total = 0;

/* A — 10 novel phrasings, ≥8 must route to web_search */
{
  let correct = 0, viaSemantic = 0;
  const rows = [];
  for (const q of PARAPHRASES) {
    const d = await routeDecision(q);
    const ok = d.route === CAPABILITY;
    if (ok) correct++;
    if (ok && d.via === 'semantic') viaSemantic++;
    rows.push(`    ${ok ? '✓' : '✗'} "${q}" → ${d.route} (via ${d.via}, conf ${d.confidence.toFixed(2)}, ${d.reasoning.slice(0, 72)})`);
  }
  total++;
  const ok = correct >= 8 && viaSemantic >= 3;
  if (ok) pass++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] A — novel phrasings: ${correct}/10 routed to ${CAPABILITY} (need ≥8), ${viaSemantic}/10 via the semantic layer (need ≥3)`);
  console.log(rows.join('\n'));
}

/* B — 5 unrelated queries: no false positives on web_search */
{
  const rows = [];
  let fp = 0;
  for (const q of UNRELATED) {
    const d = await routeDecision(q);
    const fpHit = d.route === CAPABILITY;
    if (fpHit) fp++;
    rows.push(`    ${fpHit ? '✗ FALSE-POSITIVE' : '✓'} "${q}" → ${d.route} (via ${d.via})`);
  }
  total++;
  const ok = fp === 0;
  if (ok) pass++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] B — unrelated queries: ${fp}/5 false positives (need 0)`);
  console.log(rows.join('\n'));
}

/* C — the semantic layer's own scores for transparency (raw) */
{
  const s = await semanticScores(PARAPHRASES[0]);
  console.log(`[INFO] semantic scores for "${PARAPHRASES[0]}": ${JSON.stringify(s)}`);
}

console.log(`\nP10 GAP 5 CAPABILITY GATE TEST: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
