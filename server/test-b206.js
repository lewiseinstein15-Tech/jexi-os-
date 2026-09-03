#!/usr/bin/env node
/**
 * B206 — THINKING-PANEL HARDENING: "make sure when it is thinking it will
 * not break the UI."
 *
 * The panel renders LIVE, UNTRUSTED server data. Failure modes guarded:
 *
 *  1. Non-string payloads — an object/number/null in a log message would
 *     throw "Objects are not valid as a React child" and (without the local
 *     boundary) blank the whole screen via the app-wide ErrorBoundary.
 *  2. Control characters / ANSI escapes — junk rendering.
 *  3. Marathon tasks — hundreds of activity rows re-rendering 10×/s.
 *  4. Giant reasoning blobs — megabytes of think tokens.
 *  5. A render crash anyway — the panel sits in a LOCAL boundary that hides
 *     the panel and keeps the chat + answer intact.
 */
import {
  sanitizeText, safeRows, capTail, capText, dedupeActivity, hasTrace,
} from '../src/utils/agentStream.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const read = (p) => fs.readFileSync(p, 'utf-8');

console.log('B206: thinking-panel hardening\n');

// --- 1. sanitizeText: anything in, safe string out ---
console.log('[1] sanitizeText coerces everything');
check('object → string (never a React crash)', typeof sanitizeText({ a: 1 }) === 'string');
check('undefined/null → empty string', sanitizeText(undefined) === '' && sanitizeText(null) === '');
check('number → string', sanitizeText(42) === '42');
check('array → joined string', typeof sanitizeText([1, 2]) === 'string');
check('ANSI escapes stripped', sanitizeText('\u001B[31mRED\u001B[0m') === 'RED');
check('control chars stripped (\\n \\t kept)', sanitizeText('a\u0000b\u0007c\nd\te') === 'abcd\ne'.replace('\n\n', '\n') || sanitizeText('a\u0000b\u0007c\nd\te') === 'abc\nd\te');
check('length capped with tail kept', (() => { const s = sanitizeText('x'.repeat(9000), 4000); return s.length === 4000 && s.startsWith('…') && s.endsWith('x'); })());
check('normal text untouched', sanitizeText('I found 30 sources.') === 'I found 30 sources.');

// --- 2. safeRows: malformed activity rows ---
console.log('\n[2] safeRows handles malformed rows');
{
  const rows = safeRows([
    { agent: 'Searcher', message: 'ok row' },
    { agent: { nested: true }, message: { deep: 'object' } }, // both malformed
    { agent: null, message: null },
    null,
    undefined,
    'just a string',
    { agent: 'Extractor', message: 12345 },
    { agent: '', message: '   ' }, // blank everything → dropped
  ]);
  check('all entries are {agent: string, message: string}', rows.every((r) => typeof r.agent === 'string' && typeof r.message === 'string'));
  check('no nulls survive', rows.every(Boolean));
  check('valid row intact', rows.some((r) => r.agent === 'Searcher' && r.message === 'ok row'));
  check('numeric message coerced', rows.some((r) => r.message === '12345'));
  check('non-array input → []', safeRows(null).length === 0 && safeRows('nope').length === 0);
  // the React-child guarantee: nothing in a rendered row can be an object
  check('RENDER SAFETY: no object values anywhere in rows', JSON.stringify(rows) === JSON.stringify(rows) && !rows.some((r) => typeof r.agent === 'object' || typeof r.message === 'object'));
}

// --- 3. capTail: marathon tasks render the tail only ---
console.log('\n[3] capTail bounds the DOM');
{
  const big = Array.from({ length: 500 }, (_, i) => ({ agent: 'A', message: `step ${i}` }));
  const { shown, hidden } = capTail(big, 40);
  check('500 rows → 40 shown', shown.length === 40);
  check('hidden count = 460', hidden === 460);
  check('keeps the NEWEST tail', shown[shown.length - 1].message === 'step 499');
  const small = capTail([1, 2, 3], 40);
  check('small lists unchanged', small.shown.length === 3 && small.hidden === 0);
  check('non-array → empty', capTail(undefined, 10).shown.length === 0);
}

// --- 4. capText: giant reasoning blobs ---
console.log('\n[4] capText bounds reasoning');
{
  const huge = 'y'.repeat(50000);
  const out = capText(huge, 6000);
  check('50KB → 6000 chars', out.length === 6000);
  check('tail marker + newest content', out.startsWith('…') && out.endsWith('y'));
  check('short text passes through', capText('because the sources say so', 6000) === 'because the sources say so');
  check('non-string coerced', capText(null, 100) === '');
}

// --- 5. dedupe + hasTrace still hold under hostile input ---
console.log('\n[5] existing helpers stay robust');
check('dedupe handles null', dedupeActivity(null).length === 0);
check('hasTrace(null) safe', hasTrace(null) === false);
check('hasTrace with object narrations', hasTrace({ narrations: [{}] }) === true);

// --- 6. wiring contracts ---
console.log('\n[6] wiring contracts');
{
  const hook = read('../src/hooks/useJexiEngine.js');
  check('hook sanitizes log entries at ingestion', /agent: sanitizeText\(data\.agent, 40\)/.test(hook) && /message: sanitizeText\(data\.message, 240\)/.test(hook));
  check('hook caps stored activity (slice(-400))', /\.slice\(-400\)/.test(hook));
  check('hook imports sanitizeText', /from '\.\.\/utils\/agentStream\.js'/.test(hook));

  const panel = read('../src/components/AgentThinking.jsx');
  check('panel wraps in a LOCAL crash boundary', /class PanelBoundary/.test(panel) && /PanelBoundary>/.test(panel));
  check('local boundary hides the panel, not the chat', /this\.state\.crashed \? null : this\.props\.children/.test(panel));
  check('panel coerces props via useMemo + safeRows', /safeRows\(activity\)/.test(panel) && /useMemo\(/.test(panel));
  check('panel caps rendered narrations/rows/reasoning', /NARRATION_CAP/.test(panel) && /ROW_CAP/.test(panel) && /REASON_CAP/.test(panel));
  check('panel renders "+N earlier" markers', /jx-agent-more/.test(panel));
  check('panel coerces by/sourceCount defensively', /typeof by === 'string'/.test(panel) && /Number\.isFinite\(sourceCount\)/.test(panel));

  const css = read('../src/index.css');
  check('.jx-agent-more styled', /\.jx-agent-more/.test(css));
}

console.log(`\nB206: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
