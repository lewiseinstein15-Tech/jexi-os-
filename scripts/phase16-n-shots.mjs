#!/usr/bin/env node
/**
 * Phase 16 Scope N — screenshot evidence harness (chat checkpoints).
 * Evidence tooling under scripts/; NOT console UI wiring. Renders the live
 * routed transcript plus checkpoint markers / preview dialog / branch columns
 * and screenshots with the shared headless Chromium. PNGs outside the repo.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { checkpoints } from '../ui/web/console/chat/checkpoints.js';
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

const hardReset = () => { checkpoints._reset(); queue._reset(); steer._reset(); runtime._reset(); router._reset(); modes._reset(); approvals._reset(); draft._reset(); };
const agent = (tools) => (ctx) => (async function* a() { for (const t of tools) { yield { kind: 'tool', ...t }; await tick(3); } })();
const runTurn = async (sess, tag, tools) => { runtime.send(sess, tag, { agent: agent(tools) }); await runtime.settle(sess); };

const live = {};
const watch = (sess) => { live[sess] = []; return router.subscribe(sess, (env) => live[sess].push(env)); };

/* ---------------- rendering ---------------- */
function rowFor(env) {
  const p = env.event.payload || {};
  const ctx = p.ctx || {};
  switch (env.event.type) {
    case 'message.delta':
      return String(p.delta || '').startsWith('[steer]')
        ? `<div class="line steerline">↳ ${esc(p.delta)}</div>`
        : `<div class="line ${env.first ? 'user' : 'agent'}">${esc(p.delta)}</div>`;
    case 'tool.started':
      return `<div class="toolrow"><span style="color:var(--jcx-peach)">▸</span> ${esc(p.toolName)} <span class="dim">${esc((p.args && (p.args.command || p.args.path)) || '')}</span></div>`;
    case 'tool.completed':
      return `<div class="toolrow"><span style="color:var(--jcx-up)">✓</span> ${esc(p.toolName)}</div>`;
    case 'narration.line':
      if (ctx.checkpoint === 'restored') return `<div class="cpmarker restored">⟲ restored to ${esc(ctx.checkpointId)} — discarded ${ctx.discarded} events</div>`;
      if (ctx.checkpoint === 'branched') return `<div class="cpmarker branch">⎇ branched ${esc(ctx.newSessionId)} from ${esc(ctx.checkpointId)}</div>`;
      return '';
    case 'turn.completed':
      return `<div class="turnend">— ${esc(env.turnId || '')} ${esc(p.status || '')} —</div>`;
    default: return '';
  }
}

function transcript(envs, title, markers = []) {
  const firstDelta = new Set(); const seen = new Set();
  for (const e of envs) { if (e.event.type === 'message.delta' && !seen.has(e.turnId)) { seen.add(e.turnId); firstDelta.add(e); } }
  const rows = [];
  envs.forEach((e, i) => {
    rows.push(rowFor({ ...e, first: firstDelta.has(e) }));
    const m = markers.find((x) => x.at === i + 1);
    if (m) rows.push(`<div class="cpmarker">◆ checkpoint ${esc(m.id)} ${m.label ? '· ' + esc(m.label) : ''} · ${m.eventCount} events</div>`);
  });
  return `<div class="term"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${esc(title)}</span></div><div class="tbody">${rows.join('')}</div></div>`;
}

function previewDialog(pv, cp) {
  return `<div class="dialog">
    <div class="dhead">RESTORE PREVIEW — ${esc(cp.checkpointId)}</div>
    <div class="drow"><span class="k">will restore</span><span class="v up">${pv.willRestore} events</span></div>
    <div class="drow"><span class="k">will discard</span><span class="v down">${pv.willDiscard} events</span></div>
    <div class="drow"><span class="k">modes become</span><span class="v">${esc(pv.modes.displayMode)} / ${esc(pv.modes.interactionMode)}</span></div>
    <div class="drow"><span class="k">clears</span><span class="v gold">${pv.pending.queue} queued · ${pv.pending.steer} steer</span></div>
    <div class="dbtns"><span class="btn">Restore</span><span class="btn ghost">Cancel</span></div>
  </div>`;
}

const CSS = `
  :root{--jcx-ink:#f3eee6;--jcx-ink-2:#a99f90;--jcx-ink-3:#7a7163;--jcx-ember:#ff7a3d;--jcx-peach:#ffb88c;--jcx-coral:#ff6b5e;--jcx-gold:#e5b567;--jcx-up:#4cc38a;--jcx-down:#ff5d5d;--bg:#15120f;--panel:#1c1815;--line:#2b2622;}
  *{box-sizing:border-box}body{margin:0;padding:24px;background:#0d0b0a;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--jcx-ink)}
  .cols{display:flex;gap:16px;align-items:flex-start}
  .term{width:640px;background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .wide{width:760px}
  .bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:#100e0c;border-bottom:1px solid var(--line)}
  .dot{width:11px;height:11px;border-radius:50%}.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
  .title{margin-left:10px;font-size:12px;color:var(--jcx-ink-3)}
  .tbody{padding:12px 14px;display:flex;flex-direction:column;gap:4px}
  .line{padding:6px 10px;font-size:12.5px;white-space:pre-wrap;border-radius:4px}
  .line.user{color:var(--jcx-ink);background:#232019;border-left:3px solid var(--jcx-ember)}
  .line.agent{color:var(--jcx-ink-2)}
  .line.steerline{color:var(--jcx-coral);background:#2a1a17;border-left:3px solid var(--jcx-coral)}
  .toolrow{padding:4px 10px;font-size:12px;color:var(--jcx-ink-2)}
  .toolrow .dim{color:var(--jcx-ink-3)}
  .turnend{padding:4px 10px;font-size:10.5px;color:var(--jcx-ink-3)}
  .cpmarker{margin:6px 4px;padding:6px 10px;font-size:11px;color:var(--jcx-gold);border:1px dashed #6b5a33;border-radius:6px;background:#221c12}
  .cpmarker.restored{color:var(--jcx-up);border-color:#2c5a44;background:#16241b}
  .cpmarker.branch{color:var(--jcx-peach);border-color:#6b4a33;background:#241a12}
  .dialog{width:760px;margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .dhead{padding:9px 14px;font-size:11px;letter-spacing:.12em;color:var(--jcx-ember);border-bottom:1px solid var(--line)}
  .drow{display:flex;justify-content:space-between;padding:8px 14px;font-size:12.5px;border-bottom:1px solid #241f1b}
  .k{color:var(--jcx-ink-3)}.v{color:var(--jcx-ink)}
  .v.up{color:var(--jcx-up)}.v.down{color:var(--jcx-down)}.v.gold{color:var(--jcx-gold)}
  .dbtns{display:flex;gap:10px;padding:12px 14px}
  .btn{padding:6px 16px;border-radius:6px;background:var(--jcx-ember);color:#15120f;font-size:12px;font-weight:700}
  .btn.ghost{background:transparent;color:var(--jcx-ink-2);border:1px solid var(--line)}
`;

async function shot(name, html, selector = '.term') {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  const el = await page.$(selector);
  const file = `${OUT}/phase16-scopeN-${name}.png`;
  await el.screenshot({ path: file });
  await browser.close();
  console.log(`${name.padEnd(20)} -> ${file}`);
}

/* S1 — checkpoint created */
{
  hardReset(); const s = 'shots-ck'; runtime.attach(s); watch(s);
  await runTurn(s, 'load data', [{ name: 'read_file', args: { path: 'data.csv' }, destructive: false }]);
  await runTurn(s, 'parse it', [{ name: 'edit_file', args: { path: 'src/parse.js', patch: '@@ -1 +1 @@' }, destructive: false }]);
  const cp = checkpoints.create(s, 'before experiments');
  await shot('checkpoint-created', transcript(live[s], `jexi · ${s}`, [{ at: cp.eventCount, id: 'ck-1', label: cp.label, eventCount: cp.eventCount }]));
}

/* S2 — restore preview */
{
  hardReset(); const s = 'shots-pv'; runtime.attach(s); watch(s);
  await runTurn(s, 'setup', [{ name: 'bash', args: { command: 'npm i' }, destructive: false }]);
  await runTurn(s, 'build', [{ name: 'bash', args: { command: 'npm run build' }, destructive: false }]);
  const cp = checkpoints.create(s, 'stable');
  await runTurn(s, 'experiment', [{ name: 'bash', args: { command: 'npm run exp' }, destructive: false }]);
  await runTurn(s, 'more', [{ name: 'bash', args: { command: 'npm run exp2' }, destructive: false }]);
  const pv = checkpoints.preview(cp.checkpointId);
  const html = transcript(live[s], `jexi · ${s}`, [{ at: cp.eventCount, id: 'ck-1', label: cp.label, eventCount: cp.eventCount }]) + previewDialog(pv, cp);
  await shot('restore-preview', html, '.dialog');
}

/* S3 — restored */
{
  hardReset(); const s = 'shots-rs'; runtime.attach(s); const w1 = watch(s);
  await runTurn(s, 'setup', [{ name: 'bash', args: { command: 'npm i' }, destructive: false }]);
  await runTurn(s, 'build', [{ name: 'bash', args: { command: 'npm run build' }, destructive: false }]);
  const cp = checkpoints.create(s, 'stable');
  await runTurn(s, 'experiment', [{ name: 'bash', args: { command: 'npm run exp' }, destructive: false }]);
  checkpoints.restore(s, cp.checkpointId);
  w1(); // stop first capture
  const after = []; router.subscribe(s, (env) => after.push(env));
  await runTurn(s, 'new direction', [{ name: 'bash', args: { command: 'npm run safe' }, destructive: false }]);
  const prefix = live[s].slice(0, cp.eventCount);
  const marker = live[s].find((e) => e.event.payload && e.event.payload.ctx && e.event.payload.ctx.checkpoint === 'restored');
  const html = transcript([...prefix, marker, ...after], `jexi · ${s} (restored)`, [{ at: cp.eventCount, id: 'ck-1', label: cp.label, eventCount: cp.eventCount }]);
  await shot('restored', html);
}

/* S4 — branch: two divergent paths from same saved point */
{
  hardReset(); const s = 'shots-br'; runtime.attach(s); watch(s);
  await runTurn(s, 'setup', [{ name: 'bash', args: { command: 'npm i' }, destructive: false }]);
  await runTurn(s, 'build', [{ name: 'bash', args: { command: 'npm run build' }, destructive: false }]);
  const cp = checkpoints.create(s, 'fork point');
  const br = checkpoints.branch(s, cp.checkpointId);
  watch(br.newSessionId);
  // source continues one way, branch another
  await runTurn(s, 'source: keep going', [{ name: 'bash', args: { command: 'npm run main' }, destructive: false }]);
  runtime.send(br.newSessionId, 'branch: try risky idea', { agent: agent([{ name: 'bash', args: { command: 'npm run experiment' }, destructive: false }]) });
  await runtime.settle(br.newSessionId);
  const src = transcript(live[s], `source · ${s}`, [{ at: cp.eventCount, id: 'ck-1', label: cp.label, eventCount: cp.eventCount }]);
  const brw = transcript([...live[s].slice(0, cp.eventCount), ...live[br.newSessionId]], `branch · ${br.newSessionId}`, [{ at: cp.eventCount, id: 'ck-1', label: cp.label, eventCount: cp.eventCount }]);
  await shot('branch', `<div class="cols">${src}${brw}</div>`, '.cols');
}

console.log('\n4 screenshots written.');
