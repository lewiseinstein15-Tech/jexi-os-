#!/usr/bin/env node
/**
 * Phase 16 Scope L — screenshot evidence harness.
 *
 * This is EVIDENCE TOOLING under scripts/, deliberately NOT console UI wiring:
 * Scope L ships the panel model only, and the render is a later scope. It turns
 * the model returned by ui/web/console/chat/artifacts.js into styled HTML and
 * screenshots it with a real headless browser, so the images show the actual
 * model output rather than a hand-drawn mock.
 *
 * Playwright is installed outside the repo (/tmp/shot) so the checkout stays
 * clean; PNGs are written outside the repo too, so `git status --short` in the
 * probe's P9 sees only ui/web/console/chat/** and scripts/phase16-*.mjs.
 *
 *   node scripts/phase16-l-shots.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { artifacts } from '../ui/web/console/chat/artifacts.js';
import { toolcards } from '../ui/web/console/chat/toolcards.js';
import { runtime } from '../ui/web/console/chat/runtime.js';
import { router } from '../ui/web/console/chat/router.js';
import { modes } from '../ui/web/console/chat/modes.js';
import { approvals } from '../ui/web/console/chat/approvals.js';
import { draft } from '../ui/web/console/chat/progress-draft.js';

const require = createRequire('/tmp/shot/package.json');
const { chromium } = require('playwright');

const OUT = '/home/user';
const DISK = '/tmp/scopeL-shots';
fs.rmSync(DISK, { recursive: true, force: true });
fs.mkdirSync(DISK, { recursive: true });

/* ------------------------------------------------------------------ *
 * Content source: 'file' artifacts come from the real filesystem, so
 * staleness in these images is real; 'patch' artifacts are served from
 * the turn's own store, since a patch's content is the patch text.
 * ------------------------------------------------------------------ */
const patchStore = new Map();
artifacts.useSource({
  read(path, entry) {
    if (entry.kind === 'patch' || entry.kind === 'diff') return patchStore.get(path) ?? null;
    try { return fs.readFileSync(path, 'utf8'); } catch { return null; }
  },
});

const hardReset = () => {
  artifacts._reset(); toolcards._reset(); runtime._reset();
  router._reset(); modes._reset(); approvals._reset(); draft._reset();
  patchStore.clear();
};

/** Run a real Scope J turn, building Scope K cards. Auto-approves destructive tools. */
async function runTurn(sess, userInput, tools, modePatch) {
  hardReset();
  runtime.attach(sess);
  if (modePatch) runtime.mode(sess, modePatch);
  const agent = () => (async function* a() { for (const t of tools) yield { kind: 'tool', ...t }; })();
  const { turnId, stream } = runtime.send(sess, userInput, { agent });
  for await (const e of stream) {
    if (e.type === 'approval.requested') {
      runtime.approve(sess, e.event.payload.approvalId, 'yes');
      continue;
    }
    if (toolcards.isToolEvent(e)) toolcards.build(e);
  }
  return { turnId, cards: toolcards.list().map((s) => toolcards.get(s.cardId)) };
}

/* ------------------------------------------------------------------ *
 * Rendering. Terminal chrome + Scope C's --jcx-* tokens. Diff lines are
 * classified by their +/- prefix (Agent Elements' EditTool rule).
 * ------------------------------------------------------------------ */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const humanSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

const KIND_META = {
  patch: { label: 'PATCH', color: 'var(--jcx-peach)' },
  file: { label: 'FILE', color: 'var(--jcx-ember)' },
  diff: { label: 'DIFF', color: 'var(--jcx-gold)' },
  artifact: { label: 'ARTIFACT', color: 'var(--jcx-up)' },
};

function cardRow(card) {
  const tone = card.status === 'ok' ? 'var(--jcx-up)'
    : card.status === 'refused' ? 'var(--jcx-gold)'
      : card.status === 'failed' ? 'var(--jcx-down)' : 'var(--jcx-ink-3)';
  const glyph = card.status === 'ok' ? '✓' : card.status === 'refused' ? '⊘' : card.status === 'failed' ? '✕' : '·';
  return `<div class="card">
      <span class="glyph" style="color:${tone}">${glyph}</span>
      <span class="tool">${esc(card.cardType)}</span>
      <span class="label">${esc(card.header.label)}</span>
      <span class="badge" style="color:${tone};border-color:${tone}55">${esc(card.status)}</span>
      ${card.footer.error ? `<span class="err">${esc(card.footer.error)}</span>` : ''}
    </div>`;
}

function diffBody(text) {
  const added = text.split('\n').filter((l) => l.startsWith('+')).length;
  const removed = text.split('\n').filter((l) => l.startsWith('-')).length;
  const lines = text.split('\n').map((l) => {
    const cls = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : 'ctx';
    return `<div class="ln ${cls}">${esc(l) || '&nbsp;'}</div>`;
  }).join('');
  return `<div class="stats"><span class="up">+${added}</span><span class="down">−${removed}</span></div>${lines}`;
}

function entryRow(entry, opened, index) {
  const meta = KIND_META[entry.kind] || { label: entry.kind.toUpperCase(), color: 'var(--jcx-ink-3)' };
  const stale = entry.stale
    ? `<span class="stale" title="the file on disk no longer matches the hash Scope K recorded">STALE</span>` : '';
  const head = `<div class="row ${entry.expanded ? 'open' : ''}">
      <span class="chev">${entry.expanded ? '▾' : '▸'}</span>
      <span class="kind" style="color:${meta.color};border-color:${meta.color}44">${meta.label}</span>
      <span class="path">${esc(entry.path)}</span>
      ${stale}
      <span class="meta">${humanSize(entry.size)}</span>
      <span class="hash">#${esc(entry.hash.slice(0, 8))}</span>
      <span class="src">${esc(entry.toolName)}</span>
      <span class="idx">${index}</span>
    </div>`;
  if (!entry.expanded || !opened) return head;
  const isDiffy = entry.kind === 'patch' || entry.kind === 'diff';
  const body = isDiffy ? diffBody(opened.content) : `<div class="plain">${esc(opened.content)}</div>`;
  return head + `<div class="body">${body}</div>`;
}

function panelHtml(panel, cards, openedByPath, note) {
  const counts = Object.entries(panel.countsByKind)
    .map(([k, n]) => `<span class="chip">${esc(k)} <b>${n}</b></span>`).join('');
  const rows = panel.entries.length
    ? panel.entries.map((e, i) => entryRow(e, openedByPath[e.path], i + 1)).join('')
    : `<div class="none">${esc(note || 'This turn produced no artifacts.')}</div>`;

  return `<div class="term">
    <div class="bar">
      <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
      <span class="title">jexi · turn ${esc(panel.turnId)}</span>
    </div>
    <div class="stream">${cards.map(cardRow).join('')}</div>
    <div class="panel">
      <div class="phead">
        <span class="ptitle">ARTIFACTS</span>
        <span class="ptotal">${panel.entries.length}</span>
        ${counts}
        <span class="pid">${esc(panel.panelId)}</span>
      </div>
      ${rows}
    </div>
  </div>`;
}

const CSS = `
  :root{
    --jcx-ink:#f3eee6; --jcx-ink-2:#a99f90; --jcx-ink-3:#7a7163;
    --jcx-ember:#ff7a3d; --jcx-peach:#ffb88c; --jcx-coral:#ff6b5e;
    --jcx-gold:#e5b567; --jcx-up:#4cc38a; --jcx-down:#ff5d5d;
    --bg:#15120f; --panel:#1c1815; --line:#2b2622;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:26px;background:#0d0b0a;
       font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--jcx-ink)}
  .term{width:880px;background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:#100e0c;border-bottom:1px solid var(--line)}
  .dot{width:11px;height:11px;border-radius:50%}
  .dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
  .title{margin-left:10px;font-size:12px;color:var(--jcx-ink-3);letter-spacing:.03em}
  .stream{padding:12px 14px 4px;display:flex;flex-direction:column;gap:6px}
  .card{display:flex;align-items:center;gap:9px;font-size:12.5px;padding:5px 8px;border-radius:6px;background:#191512}
  .glyph{width:12px;text-align:center}
  .tool{color:var(--jcx-ink-2)}
  .label{color:var(--jcx-ink);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:330px}
  .badge{margin-left:auto;font-size:10px;padding:1px 7px;border:1px solid;border-radius:20px;letter-spacing:.08em}
  .err{color:var(--jcx-gold);font-size:11px}
  .panel{margin:12px 14px 16px;border:1px solid var(--line);border-radius:9px;background:var(--panel);overflow:hidden}
  .phead{display:flex;align-items:center;gap:9px;padding:9px 13px;background:#221d19;border-bottom:1px solid var(--line)}
  .ptitle{font-size:11px;letter-spacing:.16em;color:var(--jcx-ember);font-weight:700}
  .ptotal{font-size:11px;color:var(--jcx-ink);background:#33291f;border-radius:20px;padding:1px 8px}
  .chip{font-size:10.5px;color:var(--jcx-ink-2);border:1px solid var(--line);border-radius:20px;padding:1px 8px}
  .chip b{color:var(--jcx-ink)}
  .pid{margin-left:auto;font-size:10.5px;color:var(--jcx-ink-3)}
  .row{display:flex;align-items:center;gap:10px;padding:9px 13px;border-bottom:1px solid #241f1b;font-size:12.5px}
  .row.open{background:#221c17}
  .chev{color:var(--jcx-ink-3);width:10px}
  .kind{font-size:9.5px;letter-spacing:.1em;border:1px solid;border-radius:4px;padding:2px 6px}
  .path{color:var(--jcx-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}
  .stale{font-size:9.5px;letter-spacing:.1em;color:#15120f;background:var(--jcx-gold);border-radius:4px;padding:2px 6px;font-weight:700}
  .meta{margin-left:auto;color:var(--jcx-ink-2);font-size:11.5px}
  .hash{color:var(--jcx-ink-3);font-size:11.5px}
  .src{color:var(--jcx-ink-3);font-size:11px;min-width:74px;text-align:right}
  .idx{color:#3a332c;font-size:10px;width:14px;text-align:right}
  .body{padding:10px 13px 13px 33px;background:#171310;border-bottom:1px solid #241f1b}
  .stats{margin-bottom:7px;display:flex;gap:10px;font-size:11.5px}
  .stats .up{color:var(--jcx-up)}.stats .down{color:var(--jcx-down)}
  .ln{font-size:12px;line-height:1.65;white-space:pre-wrap;padding:0 8px;border-radius:3px}
  .ln.add{color:#b9f2d4;background:#16301f}
  .ln.del{color:#ffc9c4;background:#331a18}
  .ln.hunk{color:var(--jcx-ink-3)}
  .ln.ctx{color:var(--jcx-ink-2)}
  .plain{font-size:12px;line-height:1.65;white-space:pre-wrap;color:var(--jcx-ink-2)}
  .none{padding:20px 14px;font-size:12px;color:var(--jcx-ink-3);text-align:center;letter-spacing:.02em}
`;

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

/**
 * 1. default — a multi-tool turn (bash, edit, edit, edit, search) yielding 3
 *    artifacts. Note: a 'diff'-kind artifact needs a tool whose OUTPUT is a
 *    diff, and Scope J's runtime fabricates its own result ({ok,tool,
 *    approvalId}), so 'diff' is unreachable through a live Scope J turn —
 *    hence three real edits here.
 */
async function viewDefault() {
  const patchA = '@@ -12,7 +12,9 @@ export function retry(fn, opts) {\n-  const tries = 1;\n+  const tries = opts?.retries ?? 3;\n+  const backoff = opts?.backoff ?? 250;\n   let last;';
  const patchB = '@@ -3,3 +3,4 @@ export function attach(sessionId, opts) {\n-  const s = new Session(sessionId);\n+  const s = new Session(sessionId, opts);\n+  s.retries = opts?.retries ?? 3;\n   return s;';
  const cfgPath = `${DISK}/config.json`;
  const cfg = '{\n  "retries": 3,\n  "backoff": 250\n}\n';

  const { turnId, cards } = await runTurn('sess-shots', 'harden the retry loop', [
    { name: 'bash', args: { command: 'git status --short | head -20' }, destructive: false },
    { name: 'edit_file', args: { path: 'ui/web/console/chat/runtime.js', patch: patchA }, destructive: false },
    { name: 'edit_file', args: { path: 'ui/web/console/chat/router.js', patch: patchB }, destructive: false },
    { name: 'edit_file', args: { path: cfgPath, content: cfg }, destructive: false },
    { name: 'read_file', args: { path: 'ui/web/console/chat/runtime.js' }, destructive: false },
  ]);
  patchStore.set('ui/web/console/chat/runtime.js', patchA);
  patchStore.set('ui/web/console/chat/router.js', patchB);
  fs.writeFileSync(cfgPath, cfg);

  const p = artifacts.panel(turnId);
  return { panel: p, cards, openedByPath: {} };
}

/** 2. expanded — the same turn, one artifact opened inline. */
async function viewExpanded() {
  const base = await viewDefault();
  const opened = artifacts.open(base.panel.panelId, 'ui/web/console/chat/runtime.js');
  const panel = artifacts.panel(base.panel.turnId);
  return { panel, cards: base.cards, openedByPath: { [opened.path]: opened } };
}

/** 3. empty — a turn whose tools produced nothing. */
async function viewEmpty() {
  const { turnId, cards } = await runTurn('sess-shots-empty', 'what changed?', [
    { name: 'bash', args: { command: 'git log --oneline -3' }, destructive: false, result: '5ab1b02 phase-16(K): tool-call cards' },
    { name: 'read_file', args: { path: 'ui/web/console/chat/toolcards.js' }, destructive: false, result: 'export const CARD_TYPES = [' },
  ]);
  return { panel: artifacts.panel(turnId), cards, openedByPath: {}, note: 'This turn only inspected the tree — nothing was written.' };
}

/** 4. refused — a write refused in plan mode; no artifact may appear. */
async function viewRefused() {
  const { turnId, cards } = await runTurn('sess-shots-refused', 'rewrite the config', [
    { name: 'read_file', args: { path: '/srv/jexi/config.json' }, destructive: false, result: '{ "retries": 1 }' },
    { name: 'edit_file', args: { path: '/srv/jexi/config.json', content: '{\n  "retries": 99\n}\n' }, destructive: true, result: 'written' },
  ], { interactionMode: 'plan' });
  return {
    panel: artifacts.panel(turnId),
    cards,
    openedByPath: {},
    note: 'The edit was refused in plan mode, so it produced no artifact.',
  };
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */
const browser = await chromium.launch();
const shot = async (name, view) => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${panelHtml(view.panel, view.cards, view.openedByPath, view.note)}</body></html>`);
  const el = await page.$('.term');
  const file = `${OUT}/phase16-scopeL-${name}.png`;
  await el.screenshot({ path: file });
  await ctx.close();
  const p = view.panel;
  console.log(`${name.padEnd(9)} -> ${file}`);
  console.log(`            panelId=${p.panelId} entries=${p.entries.length} empty=${p.empty} countsByKind=${JSON.stringify(p.countsByKind)}`);
  console.log(`            entries=${JSON.stringify(p.entries.map((e) => ({ path: e.path, kind: e.kind, size: e.size, hash: e.hash, expanded: e.expanded, stale: e.stale })))}`);
};

await shot('default', await viewDefault());
await shot('expanded', await viewExpanded());
await shot('empty', await viewEmpty());
await shot('refused', await viewRefused());

await browser.close();
console.log('\n4 screenshots written.');
