#!/usr/bin/env node
/**
 * Phase 16 Scope M — screenshot evidence harness (queued + steer).
 * Evidence tooling under scripts/; NOT console UI wiring. Renders the live
 * routed timeline (runtime + queue + steer events) plus a queue panel into a
 * terminal view and screenshots it with the shared headless Chromium.
 * PNGs are written outside the repo so the probe's P8 zone check stays clean.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { queue } from '../ui/web/console/chat/queue.js';
import { steer } from '../ui/web/console/chat/steer.js';
import { runtime } from '../ui/web/console/chat/runtime.js';
import { router } from '../ui/web/console/chat/router.js';
import { modes } from '../ui/web/console/chat/modes.js';
import { approvals } from '../ui/web/console/chat/approvals.js';
import { draft } from '../ui/web/console/chat/progress-draft.js';

const require = createRequire('/tmp/shot/package.json');
const { chromium } = require('playwright');
const OUT = '/home/user';
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const hardReset = () => { queue._reset(); steer._reset(); runtime._reset(); router._reset(); modes._reset(); approvals._reset(); draft._reset(); };
const slowAgent = (tools) => (ctx) => (async function* a() { for (const t of tools) { yield { kind: 'tool', ...t }; await tick(6); } })();

const live = {};
const watch = (sess) => { live[sess] = []; router.subscribe(sess, (env) => live[sess].push(env)); };

/* ---------------- rendering ---------------- */
function rowFor(env) {
  const p = env.event.payload || {};
  const ctx = p.ctx || {};
  switch (env.event.type) {
    case 'message.delta': {
      const isSteer = String(p.delta || '').startsWith('[steer]');
      if (isSteer) return `<div class="line steerline">↳ ${esc(p.delta)}</div>`;
      return `<div class="line ${env.first ? 'user' : 'agent'}">${esc(p.delta)}</div>`;
    }
    case 'tool.started':
      return `<div class="toolrow"><span class="g" style="color:var(--jcx-peach)">▸</span> ${esc(p.toolName)} <span class="dim">${esc((p.args && (p.args.command || p.args.path)) || '')}</span></div>`;
    case 'tool.completed':
      return `<div class="toolrow done"><span class="g" style="color:var(--jcx-up)">✓</span> ${esc(p.toolName)}</div>`;
    case 'approval.requested':
      return `<div class="chiprow"><span class="chip gold">approval requested</span></div>`;
    case 'approval.resolved':
      return `<div class="chiprow"><span class="chip up">approved</span></div>`;
    case 'narration.line': {
      if (ctx.queue === 'enqueued') return `<div class="chiprow"><span class="chip ember">queued #${ctx.position}</span> <span class="dim">${''}</span></div>`;
      if (ctx.queue === 'started') return `<div class="chiprow"><span class="chip up">auto-started</span> <span class="dim">→ ${esc(ctx.turnId || '')}</span></div>`;
      if (ctx.queue === 'cancelled') return `<div class="chiprow"><span class="chip down">cancelled</span></div>`;
      if (ctx.steer === 'injected') return `<div class="chiprow"><span class="chip coral">steer injected</span></div>`;
      if (ctx.steer === 'delivered') return `<div class="chiprow"><span class="chip coral">steer delivered</span></div>`;
      return '';
    }
    case 'turn.completed':
      return `<div class="turnend">— turn ${esc(env.turnId || '')} ${esc(p.status || '')} —</div>`;
    default: return '';
  }
}

function chatHtml(envs, sess, extra) {
  // group by turnId preserving order
  const turns = [];
  const seen = new Map();
  const firstDelta = new Set();
  for (const e of envs) { if (e.event.type === 'message.delta' && !seen.has(e.turnId)) { seen.set(e.turnId, true); firstDelta.add(e); } }
  for (const e of envs) {
    const key = e.turnId || 'global';
    let t = turns.find((x) => x.id === key);
    if (!t) { t = { id: key, rows: [] }; turns.push(t); }
    t.rows.push(rowFor({ ...e, first: firstDelta.has(e) }));
  }
  const blocks = turns.map((t) => `<div class="turn"><div class="turnhead">${esc(t.id)}</div>${t.rows.join('')}</div>`).join('');
  return `<div class="term">
    <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">jexi · ${esc(sess)}</span></div>
    <div class="body">${blocks}</div>
    ${extra || ''}
  </div>`;
}

function queuePanel(sess, cancelled = []) {
  const items = queue.list(sess);
  const rows = items.length
    ? items.map((it) => `<div class="qrow"><span class="pos">${it.position}</span><span class="qmsg">${esc(it.message)}</span><span class="qstate held">held</span></div>`).join('')
    : `<div class="qempty">queue empty</div>`;
  const cancelledRows = cancelled.map((c) => `<div class="qrow struck"><span class="pos">–</span><span class="qmsg">${esc(c)}</span><span class="qstate down">cancelled</span></div>`).join('');
  return `<div class="qpanel"><div class="qhead">QUEUE <span class="qcount">${items.length}</span></div>${rows}${cancelledRows}</div>`;
}

const CSS = `
  :root{--jcx-ink:#f3eee6;--jcx-ink-2:#a99f90;--jcx-ink-3:#7a7163;--jcx-ember:#ff7a3d;--jcx-peach:#ffb88c;--jcx-coral:#ff6b5e;--jcx-gold:#e5b567;--jcx-up:#4cc38a;--jcx-down:#ff5d5d;--bg:#15120f;--panel:#1c1815;--line:#2b2622;}
  *{box-sizing:border-box}body{margin:0;padding:24px;background:#0d0b0a;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--jcx-ink)}
  .term{width:860px;background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:#100e0c;border-bottom:1px solid var(--line)}
  .dot{width:11px;height:11px;border-radius:50%}.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
  .title{margin-left:10px;font-size:12px;color:var(--jcx-ink-3)}
  .body{padding:12px 14px;display:flex;flex-direction:column;gap:12px}
  .turn{border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}
  .turnhead{padding:6px 12px;font-size:10.5px;letter-spacing:.12em;color:var(--jcx-ink-3);background:#221d19;border-bottom:1px solid var(--line)}
  .line{padding:7px 12px;font-size:12.5px;white-space:pre-wrap}
  .line.user{color:var(--jcx-ink);background:#232019;border-left:3px solid var(--jcx-ember)}
  .line.agent{color:var(--jcx-ink-2)}
  .line.steerline{color:var(--jcx-coral);background:#2a1a17;border-left:3px solid var(--jcx-coral)}
  .toolrow{padding:5px 12px;font-size:12px;color:var(--jcx-ink-2)}
  .toolrow .dim{color:var(--jcx-ink-3)}
  .chiprow{padding:5px 12px}
  .chip{display:inline-block;font-size:10px;letter-spacing:.08em;border:1px solid;border-radius:20px;padding:2px 9px}
  .chip.ember{color:var(--jcx-peach);border-color:#6b4a33}
  .chip.up{color:var(--jcx-up);border-color:#2c5a44}
  .chip.down{color:var(--jcx-down);border-color:#6b3330}
  .chip.coral{color:var(--jcx-coral);border-color:#6b3a34}
  .chip.gold{color:var(--jcx-gold);border-color:#6b5a33}
  .turnend{padding:6px 12px;font-size:10.5px;color:var(--jcx-ink-3)}
  .qpanel{margin:0 14px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
  .qhead{padding:7px 12px;font-size:11px;letter-spacing:.14em;color:var(--jcx-ember);border-bottom:1px solid var(--line)}
  .qcount{background:#33291f;border-radius:20px;padding:1px 8px;color:var(--jcx-ink)}
  .qrow{display:flex;gap:10px;align-items:center;padding:7px 12px;font-size:12.5px;border-bottom:1px solid #241f1b}
  .qrow.struck .qmsg{text-decoration:line-through;color:var(--jcx-ink-3)}
  .pos{width:14px;color:var(--jcx-ink-3);text-align:right}
  .qmsg{color:var(--jcx-ink)}
  .qstate{margin-left:auto;font-size:10px;letter-spacing:.08em}
  .qstate.held{color:var(--jcx-gold)}
  .qstate.down{color:var(--jcx-down)}
  .qempty{padding:12px;text-align:center;color:var(--jcx-ink-3);font-size:12px}
`;

/* ---------------- scenarios ---------------- */
async function shot(name, html) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 940, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  const el = await page.$('.term');
  const file = `${OUT}/phase16-scopeM-${name}.png`;
  await el.screenshot({ path: file });
  await browser.close();
  console.log(`${name.padEnd(10)} -> ${file}`);
}

// S1 — queued: turn streaming, 3 held in queue (chip visible).
{
  hardReset(); const sess = 'shots-queued'; runtime.attach(sess); watch(sess);
  queue.enqueue(sess, 'ship the parser', { agent: slowAgent([{ name: 'bash', args: { command: 'npm test' }, destructive: false }, { name: 'bash', args: { command: 'npm run build' }, destructive: false }]) });
  await tick(3);
  queue.enqueue(sess, 'then update the docs');
  queue.enqueue(sess, 'and bump the version');
  queue.enqueue(sess, 'finally tag a release');
  await tick(2);
  await shot('queued', chatHtml(live[sess], sess, queuePanel(sess)));
}

// S2 — steered: mid-stream steer applied; redirect visible in chat.
{
  hardReset(); const sess = 'shots-steered'; runtime.attach(sess); watch(sess);
  queue.enqueue(sess, 'refactor the whole module', { agent: slowAgent([{ name: 'bash', args: { command: 'rg parser' }, destructive: false }, { name: 'edit_file', args: { path: 'src/parser.js', patch: '@@ -1 +1 @@' }, destructive: false }, { name: 'bash', args: { command: 'npm test' }, destructive: false }]) });
  await tick(9);
  steer.inject(sess, 'stop refactoring — just fix the off-by-one');
  await runtime.settle(sess); await tick(3);
  await shot('steered', chatHtml(live[sess], sess, queuePanel(sess)));
}

// S3 — flushed: active turn ends, queued message auto-starts as next turn.
{
  hardReset(); const sess = 'shots-flushed'; runtime.attach(sess); watch(sess);
  queue.enqueue(sess, 'first: read the config', { agent: slowAgent([{ name: 'read_file', args: { path: 'config.json' }, destructive: false }]) });
  await tick(2);
  queue.enqueue(sess, 'second: apply the migration');
  await runtime.settle(sess); await tick(20);
  await shot('flushed', chatHtml(live[sess], sess, queuePanel(sess)));
}

// S4 — cancelled: a queued message cancelled before it starts.
{
  hardReset(); const sess = 'shots-cancelled'; runtime.attach(sess); watch(sess);
  queue.enqueue(sess, 'long running analysis', { agent: slowAgent([{ name: 'bash', args: { command: 'make lint' }, destructive: false }, { name: 'bash', args: { command: 'make test' }, destructive: false }]) });
  await tick(2);
  const a = queue.enqueue(sess, 'also rewrite history');
  queue.enqueue(sess, 'and notify the channel');
  queue.cancel(sess, a.queueId);
  await tick(2);
  await shot('cancelled', chatHtml(live[sess], sess, queuePanel(sess, ['also rewrite history'])));
}

console.log('\n4 screenshots written.');
