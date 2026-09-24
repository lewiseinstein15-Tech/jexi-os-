#!/usr/bin/env node
/**
 * Phase 16 Scope O — screenshot evidence harness (multi-agent chat view).
 * Evidence tooling under scripts/; NOT console UI wiring. Feeds a parent+2
 * subagent log, then renders the four view modes from multiagent.view() and
 * screenshots each. PNGs outside the repo.
 */
import { createRequire } from 'node:module';
import { multiagent } from '../interfaces/ui/web/console/chat/multiagent.js';
import { runtime } from '../interfaces/ui/web/console/chat/runtime.js';
import { router } from '../interfaces/ui/web/console/chat/router.js';
import { modes } from '../interfaces/ui/web/console/chat/modes.js';

const require = createRequire('/tmp/shot/package.json');
const { chromium } = require('playwright');
const OUT = '/home/user';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

[multiagent, runtime, router, modes].forEach((m) => m._reset && m._reset());

function feed(sess, type, payload, { agentId, ts } = {}) {
  const evt = { type, version: 1, ts, sessionId: sess, payload };
  if (agentId) evt.agentId = agentId;
  router.route(sess, evt);
}

const sess = 'shots-ma';
runtime.attach(sess);
feed(sess, 'message.delta', { delta: 'Orchestrating the release work.', messageId: 'm0' }, { ts: 90 });
feed(sess, 'tool.started', { toolCallId: 'tc-a', toolName: 'task' }, { ts: 100 });
feed(sess, 'message.delta', { delta: 'agent-a: scanning the parser', messageId: 'a1' }, { agentId: 'agent-a', ts: 110 });
feed(sess, 'tool.started', { toolCallId: 'tc-a1', toolName: 'bash' }, { agentId: 'agent-a', ts: 115 });
feed(sess, 'tool.completed', { toolCallId: 'tc-a1' }, { agentId: 'agent-a', ts: 120 });
feed(sess, 'message.delta', { delta: 'agent-a: parser cleaned up', messageId: 'a2' }, { agentId: 'agent-a', ts: 130 });
feed(sess, 'tool.completed', { toolCallId: 'tc-a' }, { ts: 140 });
feed(sess, 'tool.started', { toolCallId: 'tc-b', toolName: 'task' }, { ts: 150 });
feed(sess, 'message.delta', { delta: 'agent-b: writing the tests', messageId: 'b1' }, { agentId: 'agent-b', ts: 160 });
feed(sess, 'message.delta', { delta: 'agent-b: 12 tests passing', messageId: 'b2' }, { agentId: 'agent-b', ts: 170 });
feed(sess, 'tool.completed', { toolCallId: 'tc-b' }, { ts: 180 });
feed(sess, 'message.delta', { delta: 'All workers reported in. Done.', messageId: 'm9' }, { ts: 190 });

function rowHtml(e, opts = {}) {
  const rail = e.rail ? `border-left:3px solid ${e.rail};` : 'border-left:3px solid transparent;';
  const indent = `margin-left:${(e.indent || 0) * 26}px;`;
  let body = '';
  if (e.type === 'tool.started') body = `<span class="t">▸</span> ${esc(e.toolName)}`;
  else if (e.type === 'tool.completed') body = `<span class="ok">✓</span> ${esc(e.toolName || 'tool done')}`;
  else body = esc(e.delta || '');
  const tag = opts.tag ? `<span class="atag" style="color:${e.rail || '#a99f90'}">${esc(e.agentId)}</span>` : '';
  return `<div class="row" style="${rail}${indent}">${tag}<span class="txt ${e.type}">${body}</span></div>`;
}

function legend(agents) {
  return `<div class="legend">${agents.map((a) => `<span class="litem"><span class="ldot" style="background:${a.color}"></span>${esc(a.agentId)} <i>${a.eventCount}</i></span>`).join('')}</div>`;
}

function singleHtml(v) {
  return term(`single — merged`, legend(v.agents) + v.layout[0].events.map((e) => rowHtml(e)).join(''));
}
function interleavedHtml(v) {
  return term(`interleaved — per-agent rail`, legend(v.agents) + v.layout[0].events.map((e) => rowHtml(e, { tag: true })).join(''));
}
function nestedHtml(v) {
  return term(`nested — subagents indented`, legend(v.agents) + v.layout[0].events.map((e) => rowHtml(e, { tag: true })).join(''));
}
function splitHtml(v) {
  const cols = v.layout.map((p) => {
    const a = v.agents.find((x) => x.agentId === p.agentId);
    return `<div class="pane"><div class="phead" style="border-left:4px solid ${a.color}"><span class="ldot" style="background:${a.color}"></span>${esc(p.agentId)}</div>${p.events.map((e) => rowHtml(e)).join('')}</div>`;
  }).join('');
  return `<div class="term wide"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">split — one pane per agent</span></div><div class="cols">${cols}</div></div>`;
}

function term(title, inner) {
  return `<div class="term wide"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${esc(title)}</span></div><div class="tbody">${inner}</div></div>`;
}

const CSS = `
  :root{--ink:#f3eee6;--ink2:#a99f90;--ink3:#7a7163;--bg:#15120f;--panel:#1c1815;--line:#2b2622;--up:#4cc38a;}
  *{box-sizing:border-box}body{margin:0;padding:24px;background:#0d0b0a;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--ink)}
  .term{background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:8px}
  .wide{width:860px}
  .bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:#100e0c;border-bottom:1px solid var(--line)}
  .dot{width:11px;height:11px;border-radius:50%}.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
  .title{margin-left:10px;font-size:12px;color:var(--ink3)}
  .tbody{padding:12px 14px}
  .legend{display:flex;gap:16px;padding:4px 2px 10px}
  .litem{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--ink2)}
  .litem i{color:var(--ink3);font-style:normal}
  .ldot{width:9px;height:9px;border-radius:50%;display:inline-block}
  .row{padding:6px 10px;font-size:12.5px;border-radius:4px;margin-bottom:2px}
  .atag{font-size:10px;letter-spacing:.06em;margin-right:8px}
  .txt{color:var(--ink2)}
  .txt.tool.started,.t{color:#ffb88c}
  .ok{color:var(--up)}
  .cols{display:flex;gap:12px;padding:12px}
  .pane{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .phead{display:flex;gap:8px;align-items:center;padding:8px 12px;font-size:11.5px;color:var(--ink);background:#221d19;border-bottom:1px solid var(--line)}
`;

async function shot(name, html, selector = '.term') {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 940, height: 980 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  const el = await page.$(selector);
  const file = `${OUT}/phase16-scopeO-${name}.png`;
  await el.screenshot({ path: file });
  await browser.close();
  console.log(`${name.padEnd(12)} -> ${file}`);
}

await shot('single', singleHtml(multiagent.view(sess, 'single')));
await shot('split', splitHtml(multiagent.view(sess, 'split')), '.term.wide');
await shot('interleaved', interleavedHtml(multiagent.view(sess, 'interleaved')));
await shot('nested', nestedHtml(multiagent.view(sess, 'nested')));
console.log('\n4 screenshots written.');
