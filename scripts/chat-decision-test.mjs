#!/usr/bin/env node
/**
 * JEXI OS — CHAT DECISION TEST (ui/decision-layer-rendering, Part 1).
 *
 * Verifies the AGENTIC DECISION LAYER: routeDecision → executePlan →
 * verifyAnswer. Per the lead's contract:
 *
 *   - 6 scenarios, each asserts the ROUTE chosen (the capability picked from
 *     CAPABILITY_CATALOG), NOT the LLM answer.
 *   - Real PASS only: verifyAnswer must pass on grounded answers, and its
 *     negative case (wrong answer + errored trace) must honestly FAIL.
 *   - Fully deterministic: no network, no LLM key required. With a key the
 *     same routes come back via the model pick; keyless the deterministic
 *     catalog matcher decides — the route is the contract either way.
 *
 * Run: node scripts/chat-decision-test.mjs            (repo root)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '../server');

// Import the decision layer through the intent classifier's module (Planner.js
// re-exports the AgenticDecision surface — the single import point consumers
// already know).
const { routeDecision, executePlan, verifyAnswer, CAPABILITY_CATALOG } = await import(
  path.join(SERVER_DIR, 'src/services/Planner.js')
);

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('════════════════════════════════════════════════════════');
console.log(' JEXI OS — chat-decision-test (agentic decision layer)');
console.log(` catalog: ${CAPABILITY_CATALOG.length} capabilities: ${CAPABILITY_CATALOG.map((c) => c.id).join(', ')}`);
console.log('════════════════════════════════════════════════════════\n');

/* ── 1. ROUTE assertions — the 6 lead scenarios ─────────────────────── */
const SCENARIOS = [
  { q: 'what is 2+2?', route: 'direct_answer' },
  { q: 'search the web for the latest AI news', route: 'web_search' },
  { q: 'read /etc/hostname', route: 'file_read' },
  { q: 'write and run a python script that prints hello', route: 'code_run' },
  { q: 'my name is Lewis', route: 'memory_write' },
  { q: 'what is my name?', route: 'memory_read' },
];

console.log('── ROUTE assertions (routeDecision) ──\n');
for (const s of SCENARIOS) {
  const d = await routeDecision(s.q);
  const pass = d.ok && d.route === s.route;
  record(
    `route: "${s.q}" → ${s.route}`,
    pass,
    `got ${d.route} (via ${d.via}, conf ${d.confidence.toFixed(2)})${pass ? '' : ` — EXPECTED ${s.route}`}`,
  );
}

/* ── 2. ROUTE precedence — specific tools beat the generic agent ────── */
console.log('\n── ROUTE precedence guards ──\n');
{
  // "what is my name?" must go to memory_read, never direct_answer.
  const d = await routeDecision('what is my name?');
  record('precedence: "what is my name?" is memory_read (not direct_answer)', d.route === 'memory_read', `got ${d.route}`);
  // "search the web" must not collapse into direct_answer's "what is" pattern.
  const d2 = await routeDecision('search the web for quantum computing');
  record('precedence: "search the web for X" is web_search (not direct_answer)', d2.route === 'web_search', `got ${d2.route}`);
  // A question with NO tool evidence stays direct (no forced tooling).
  const d3 = await routeDecision('who wrote the Odyssey?');
  record('no-evidence question stays direct_answer', d3.route === 'direct_answer', `got ${d3.route}`);
}

/* ── 3. executePlan — deterministic capability runs (no network) ────── */
console.log('\n── executePlan deterministic runs ──\n');
{
  const d = await routeDecision('what is 2+2?');
  const run = await executePlan(d, 'what is 2+2?');
  record('executePlan: 2+2 computes exactly 4', run.success && /4/.test(run.summary) && !/wrong|fail/i.test(run.summary), `summary: ${String(run.summary).slice(0, 60)}`);
  const v = verifyAnswer('what is 2+2?', run.summary, run.trace);
  record('verifyAnswer: 2+2 verdict is PASS', v.ok, v.checks.map((c) => `${c.name}:${c.pass ? 'ok' : 'FAIL'}`).join(' · '));
}
{
  const d = await routeDecision('my name is Lewis');
  const run = await executePlan(d, 'my name is Lewis');
  record('executePlan: memory_write stores the name fact', run.success, String(run.trace.steps[0]?.observation || '').slice(0, 80));
  const v = verifyAnswer('my name is Lewis', run.summary, run.trace);
  record('verifyAnswer: memory_write verdict is PASS', v.ok, v.checks.map((c) => `${c.name}:${c.pass ? 'ok' : 'FAIL'}`).join(' · '));
  // memory_read must now find it (write→read closed loop, same process).
  const d2 = await routeDecision('what is my name?');
  const run2 = await executePlan(d2, 'what is my name?');
  record('executePlan: memory_read recalls "Lewis" after the write', run2.success && /Lewis/i.test(run2.summary), `summary: ${String(run2.summary).slice(0, 60)}`);
}

/* ── 4. verifyAnswer — the verifier must NOT lie ────────────────────── */
console.log('\n── verifyAnswer honesty (negative cases) ──\n');
{
  // A non-answer with an errored trace MUST fail — this is the exact bug
  // class the lead banned ("verify: FAIL (Low term overlap)" labelled PASS).
  const bad = verifyAnswer(
    'what is my name?',
    'Sorry, I could not complete the task.',
    { steps: [{ step: 1, ok: false, observation: 'runner threw: no provider key configured' }] },
  );
  record('negative: failed runner + off-topic answer → verify FAIL', !bad.ok, bad.reason);
  // Empty answer must fail.
  const empty = verifyAnswer('what is 2+2?', '', { steps: [{ step: 1, ok: true, observation: 'ok' }] });
  record('negative: empty answer → verify FAIL', !empty.ok, empty.reason);
  // Grounded answer with clean trace must pass.
  const good = verifyAnswer(
    'read /etc/hostname',
    'Contents of `/etc/hostname`:\n\n```\njexi-box\n```',
    { steps: [{ step: 1, ok: true, observation: 'read 9 bytes from /etc/hostname' }] },
  );
  record('positive: grounded file answer → verify PASS', good.ok, good.reason);
}

/* ── summary ─────────────────────────────────────────────────────────── */
const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log('\n════════════════════════════════════════════════════════');
console.log(` RESULT: ${passed}/${total} PASS`);
console.log('════════════════════════════════════════════════════════');
process.exit(passed === total ? 0 : 1);
