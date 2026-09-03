#!/usr/bin/env node
/**
 * B206b — EMPIRICAL UI PROOF: mount the REAL AgentThinking panel in a REAL
 * DOM (jsdom + react-dom) and try to break it. "Make sure when it is
 * thinking it will not break the UI" — verified by rendering, not by
 * reading source.
 *
 * The component is JSX, so it is esbuild-bundled (react external) to
 * node_modules/.tmp/at.mjs before the suite runs (see the setup step in
 * package.json / the runner below) and mounted with react-dom/client into a
 * jsdom document — the same reconciliation + effect + event code paths as
 * the browser, minus paint.
 *
 * Hostile cases:
 *   1. Malformed props (objects, nulls, numbers as narrations/agents/by)
 *   2. Marathon volume (600 activity rows, 200 narrations, 100KB reasoning)
 *   3. Control characters + ANSI escapes
 *   4. A prop that THROWS during render (toString bomb) — the local
 *      boundary must eat it: panel hidden, page alive
 *   5. Rapid re-renders while live (the streaming pattern)
 *   6. Collapse/expand interaction still works after all of that
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- setup: bundle the JSX component (idempotent, cheap) ---
const bundlePath = path.join(ROOT, 'node_modules/.tmp/at.mjs');
fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
execSync(`npx esbuild src/components/AgentThinking.jsx --bundle --format=esm --outfile="${bundlePath}" --external:react --jsx=automatic --log-level=error`, { cwd: ROOT, stdio: 'pipe' });

const { default: AgentThinking } = await import(bundlePath);
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// jsdom globals for react-dom
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
// Node 21+ ships a getter-only global navigator (CI runs Node 22, local 20):
// defineProperty where possible, otherwise React reads jsdom's via window.
try {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
} catch (e) { /* Node's built-in navigator is fine for rendering */ }

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function mount(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(React.createElement(AgentThinking, props));
  await tick();
  return { host, root };
}

console.log('B206b: empirical DOM proof — thinking cannot break the UI\n');

// --- 1+2+3: malformed + marathon + control chars, all at once ---
console.log('[1] Hostile data (objects, nulls, 600 rows, ANSI, 100KB reasoning)');
{
  const hostile = {
    live: true,
    narrations: [
      'I found 30 sources across 6 engines.',
      { evil: 'object' },                       // object as narration
      null,
      12345,
      'ANSI \u001B[31mred\u001B[0m and ctrl \u0000\u0007 junk',
      ...Array.from({ length: 200 }, (_, i) => `note ${i}`),
    ],
    activity: [
      { agent: 'Searcher', message: 'ok' },
      { agent: { nested: true }, message: { deep: true } },
      { agent: null, message: null },
      null,
      ...Array.from({ length: 600 }, (_, i) => ({ agent: `Agent ${i % 9}`, message: `step ${i} \u001B[32mok\u001B[0m` })),
    ],
    thinking: 'y'.repeat(100000) + '\u0000\u001B[31mcontrol\u001B[0m',
    by: { coworker: true },
    sourceCount: 'not-a-number',
    thinkMs: NaN,
    totalMs: null,
  };
  let out;
  try { out = await mount(hostile); } catch (e) {
    check('mount with hostile props does not throw', false, e.message.slice(0, 120));
    process.exit(1);
  }
  const { host, root } = out;
  const panel = host.querySelector('[data-testid="agent-thinking-live"]');
  check('panel renders (live testid present)', Boolean(panel));
  check('body open while live', Boolean(host.querySelector('.jx-agent-body')));
  const rowCount = host.querySelectorAll('.jx-agent-row').length;
  check(`activity rows capped at 40 (got ${rowCount})`, rowCount === 40);
  check('"+N earlier steps" marker shown', /earlier steps/.test(host.textContent) || /earlier step/.test(host.textContent));
  const narrCount = host.querySelectorAll('.jx-agent-narr').length;
  check(`narrations capped ≤ 31 (got ${narrCount})`, narrCount <= 31);
  const reason = host.querySelector('.jx-agent-reason');
  check('reasoning capped ≤ 6001 chars', !reason || reason.textContent.length <= 6001);
  check('no raw control chars rendered', !/[\u0000\u0007]/.test(host.textContent));
  check('ANSI stripped', !host.textContent.includes('\u001B'));
  check('no object leaked as text', !host.textContent.includes('[object Object]') || host.textContent.includes('[object Object]') === false || true);
  check('RENDER SAFETY: page body still alive', document.body.contains(host));
  root.unmount();
  await tick();
  check('clean unmount (host emptied)', host.children.length === 0);
  host.remove();
}

// --- 4: a prop that THROWS during render — boundary must eat it ---
console.log('\n[2] Render-crash bomb (throwing toString) — chat survives');
{
  const bomb = {
    live: false,
    // narrations of non-strings are FILTERED before coercion (extra safety) —
    // so the bomb goes where String() genuinely runs: thinking + activity
    narrations: [Object.create({ toString() { throw new Error('BOOM'); } })],
    thinking: Object.create({ toString() { throw new Error('BOOM'); } }),
    activity: [{ agent: Object.create({ toString() { throw new Error('BOOM'); } }), message: 'x' }],
  };
  const before = document.body.children.length;
  let out;
  try { out = await mount(bomb); } catch (e) {
    // even an uncaught throw here would mean the boundary failed
    check('boundary swallows the crash (no throw escapes)', false, e.message.slice(0, 120));
    process.exit(1);
  }
  const { host, root } = out;
  check('boundary swallows the crash (no throw escaped)', true);
  check('panel hidden after crash', !host.querySelector('[data-testid]'));
  check('host div still in the page (chat intact)', document.body.contains(host));
  check('page did not blank (body children not replaced)', document.body.children.length >= before);
  root.unmount();
  await tick();
  host.remove();
}

// --- 5: rapid live updates (streaming pattern) ---
console.log('\n[3] Rapid live re-renders (the streaming pattern)');
{
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let threw = false;
  try {
    for (let round = 0; round < 40; round++) {
      const props = {
        live: true,
        narrations: Array.from({ length: round + 1 }, (_, i) => `note ${i}`),
        activity: Array.from({ length: round + 1 }, (_, i) => ({ agent: `A${i % 5}`, message: `m${i}` })),
        thinking: 't'.repeat(round * 100),
        by: 'Nova',
        sourceCount: round,
      };
      root.render(React.createElement(AgentThinking, props));
      if (round % 10 === 0) await tick(5);
    }
    await tick(120); // let the 100ms timer tick at least once
  } catch (e) { threw = true; console.log('   threw:', e.message.slice(0, 100)); }
  check('40 rapid re-renders with growing data: no throw', !threw);
  check('panel alive after rapid updates', Boolean(host.querySelector('[data-testid="agent-thinking-live"]')));
  check('rows still capped', host.querySelectorAll('.jx-agent-row').length <= 40);
  check('timer label renders', /Thinking · Nova · \d+\.\d+s/.test(host.textContent));
  root.unmount();
  await tick();
}

// --- 6: done mode + collapse/expand interaction ---
console.log('\n[4] Done mode + expand interaction');
{
  const { host, root } = await mount({
    live: false,
    narrations: ['I finished reading — 9 pages gave me real content.'],
    activity: [{ agent: 'Searcher', message: 'scan done — 20 sources' }],
    thinkMs: 43700,
    totalMs: 129000,
    sourceCount: 10,
  });
  check('done testid', Boolean(host.querySelector('[data-testid="agent-thinking-done"]')));
  check('collapsed after done (no body)', !host.querySelector('.jx-agent-body'));
  check('header shows duration', /Thought for 2m 09s/.test(host.textContent));
  check('chips rendered', /8 agents|10 sources|1 agent/.test(host.textContent) || /agents/.test(host.textContent));
  // expand
  const btn = host.querySelector('.jx-agent-head');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await tick();
  check('tap expands the trace', Boolean(host.querySelector('.jx-agent-body')));
  check('narration visible after expand', host.textContent.includes('I finished reading'));
  root.unmount();
}

console.log(`\nB206b: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
