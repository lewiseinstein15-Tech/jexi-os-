/**
 * B200 — ARENA-STYLE STREAMING + NARRATION tests.
 *
 * The user's ask: "arena agent always updates the user in every part of what
 * it is doing — build that streaming for JEXI."
 *
 * Two layers, both proven here:
 *   1. NARRATION — 'narration' events: JEXI's own first-person words about
 *      what she is doing, emitted at the meaningful moments of a task
 *      (question breakdown, sources found, reading done, writing, fact-
 *      check, retries, fallbacks) and rendered live above the answer.
 *   2. ANSWER STREAMING — the search synthesizer (and the knowledge
 *      fallback writer) now emit token deltas as 'stream' events, so the
 *      answer types itself into the chat instead of arriving as one dump
 *      after minutes of silence (stream chars were 0 in every live run).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ─────────────── 1. the verify-graph no-clobber + narration (behavioral, via test seams) ─────────────── */
process.env.DATA_DIR = '/tmp/b200t-' + Date.now();
const { runResearchVerifyGraph } = await import('./src/services/PipelineGraphs.js');

// (a) the re-run returns the failure sentinel → the REAL draft must survive + a narration must fire
const events1 = [];
const g1 = await runResearchVerifyGraph({
  query: 'list all 54 african countries',
  draft: 'Here is the table: Kenya | Nairobi … (48 more rows)',
  sources: [{ title: 's1', link: 'https://x/1' }],
  sendEvent: (type, data) => events1.push({ type, ...data }),
  verifyFn: async () => ({ verdict: 'best-effort', changed: false, text: null, issues: ['missing claim A', 'missing claim B'] }),
  searchFn: async () => ({ summary: 'I could not find enough information in my retrieved sources to answer this.', sources: [] }),
});
ok('sentinel re-run does NOT clobber the real draft', String(g1.context.finalDraft).includes('Kenya | Nairobi'));
ok('the empty-pass narration fires on the sentinel re-run',
  events1.some((e) => e.type === 'narration' && /extra pass came back empty/i.test(e.text)));
ok('the fact-check narration fires on flagged claims',
  events1.some((e) => e.type === 'narration' && /fact-check flagged 2 claims/i.test(e.text)));

// (b) a REAL re-run replaces the draft (the improvement path still works)
const g2 = await runResearchVerifyGraph({
  query: 'q',
  draft: 'thin draft',
  sources: [],
  sendEvent: () => {},
  verifyFn: async () => ({ verdict: 'best-effort', changed: false, text: null, issues: ['x'] }),
  searchFn: async () => ({ summary: 'The corrected answer with the fixed claim and a real citation [1].', sources: [{ title: 'a', link: 'https://x' }] }),
});
ok('a REAL re-run still replaces the draft', String(g2.context.finalDraft).includes('corrected answer'));

/* ─────────────── 2. server wiring (static) ─────────────── */
const sa = fs.readFileSync('./src/services/SearchAgent.js', 'utf-8');
ok('search team narrates the key moments in first person',
  sa.includes("I'm on it — let me break this question down") &&
  /I found \$\{merged\.length\} sources across/.test(sa) &&
  sa.includes('Writing the answer now, with citations'));
ok('the FIRST synthesis streams tokens live (onToken passed through)',
  sa.includes('synthesizeGrounded(query, deep, context, { onToken: opts.onToken })'));
ok('the gap-filler re-synthesis does NOT stream (no double-append)', (() => {
  const first = sa.indexOf('synthesizeGrounded(query, deep, context, { onToken: opts.onToken })');
  const second = sa.indexOf('synthesizeGrounded(query, combined, context)');
  return first > -1 && second > -1 && second > first;
})());

const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
ok("research node emits 'stream' deltas as the answer is written", orch.includes("sendEvent('stream', { text: piece, by: 'JEXI' })"));
ok('the knowledge-fallback streams only when nothing streamed yet (no double-append)',
  orch.includes('streamedChars === 0 ? onToken : undefined'));
ok('research node narrates the books check + the knowledge fallback',
  orch.includes('Let me check my books and notes first') && orch.includes('answer from my own knowledge and verify that'));

const reasoner = fs.readFileSync('./src/services/Reasoner.js', 'utf-8');
ok('reasonAndWrite accepts an onToken streaming seam', reasoner.includes('opts.onToken'));

/* ─────────────── 3. client wiring (static + rendered) ─────────────── */
const engine = fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8');
ok("the stream engine handles 'narration' events onto the streaming message", engine.includes("data.type === 'narration'"));
const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');
ok('the chat renders the NarrationFeed on the assistant message', chat.includes('NarrationFeed') && chat.includes('msg.narrations'));

const esbuild = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const tmpOut = path.join(ROOT, 'server', 'test-support', '.b200-nf.cjs');
fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
let NarrationFeed = null;
try {
  execFileSync(esbuild, [
    path.join(ROOT, 'src/components/NarrationFeed.jsx'),
    '--bundle', '--platform=node', '--format=cjs', '--loader:.jsx=jsx',
    '--external:react', '--outfile=' + tmpOut, '--log-level=error',
  ], { stdio: 'pipe' });
  const mod = await import(('file://' + tmpOut).replace(/\\/g, '/'));
  const exp = mod && mod.default && typeof mod.default === 'object' && mod.default.default ? mod.default : mod;
  NarrationFeed = exp.default || exp;
} finally {
  try { fs.unlinkSync(tmpOut); } catch { /* best effort */ }
}
if (NarrationFeed) {
  const liveHtml = renderToStaticMarkup(React.createElement(NarrationFeed, { lines: ["I'm on it — let me break this question down first.", 'I found 30 sources across 6 search engines.'], live: true }));
  ok('live narration renders her lines + the working badge', liveHtml.includes('I found 30 sources') && liveHtml.includes('WORKING') && liveHtml.includes('working…'));
  const doneHtml = renderToStaticMarkup(React.createElement(NarrationFeed, { lines: ['a', 'b', 'c'], live: false }));
  ok('finished narration collapses to "HOW I WORKED · 3 steps"', doneHtml.includes('HOW I WORKED') && doneHtml.includes('3 steps') && doneHtml.includes('<details'));
  ok('empty narration renders nothing', renderToStaticMarkup(React.createElement(NarrationFeed, { lines: [], live: true })) === '');
} else {
  ok('NarrationFeed bundles and renders', false);
}

console.log(failures === 0 ? '\n🎉 ALL B200 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
