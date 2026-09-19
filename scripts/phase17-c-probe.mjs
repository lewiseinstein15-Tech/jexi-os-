#!/usr/bin/env node
/**
 * PHASE 17 SCOPE C PROBE — vision-based browser control.
 *
 * Every probe drives a REAL WebSocket CDP server through the runtime's own
 * CdpClient / CdpSession / DomService / BrowserAgent — the identical code
 * path a Chromium-backed engine uses. The server implements a FIXTURE page
 * (labeled FIXTURE everywhere): a virtual page whose DOM and rendered pixels
 * are fully specified below, plus a minimal RFC6455 WebSocket endpoint. No
 * browser binary is needed because the page itself is the fixture.
 *
 * The ONE honest limitation, labeled on every relevant line: there is no
 * image model in this sandbox, so target DETECTION runs a labeled fixture
 * detector (ground-truth lookup, not a model). Vision-decision MODEL quality
 * is NOT VERIFIED here. Everything around it — capture, PNG codec, crop,
 * DPR mapping, DOM→vision priority, coordinate actions, durable-key
 * round-trip, refusal, loop integration, timing — is executed for real.
 *
 * Probes:
 *   P1  capture        real Page.captureScreenshot over WS → PNG sanity
 *   P2  crop           dependency-free PNG codec: crop + pixel truth
 *   P3  DOM priority   DOM match wins, detector never consulted
 *   P4  vision-only    canvas-drawn button (no DOM node) → vision click
 *   P5  coord→key      viewport point → durable key round-trip
 *   P6  multi-step     real BrowserAgent loop: DOM step then vision step
 *   P7  refusal        no DOM, no pixels → E_NO_TARGET, zero input events
 *   P8  DOM decider    plain DOM-only loop still clicks by index
 *   P9  reasoning      vision plan carries a human-readable rationale
 *   P10 timing         real wall-clock measurements, printed raw
 *
 * Usage: node scripts/phase17-c-probe.mjs [--only=P1,P4]
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { connectCdp } from '../runtimes/browser/cdp.js';
import { DomService } from '../runtimes/browser/dom-service.js';
import { BrowserAgent } from '../runtimes/browser/agent-loop.js';
import { createActionRegistry } from '../runtimes/browser/actions/index.js';
import { chainDeciders } from '../runtimes/browser/agent-loop.js';
import * as vision from '../runtimes/browser/vision/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/tmp/phase17-c';
fs.mkdirSync(ART, { recursive: true });

/* ────────────────────────── helpers (b-probe conventions) ───────────────── */

const RESULTS = [];
let FILTER = null;
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--only=')) FILTER = a.slice(7).split(',').map((s) => s.trim().toUpperCase());
}
function pass(name, detail) { RESULTS.push({ name, ok: true, detail }); console.log(`  PASS  ${name}  ${detail}`); }
function fail(name, detail) { RESULTS.push({ name, ok: false, detail }); console.log(`  FAIL  ${name}  ${detail}`); }
function skip(name, detail) { RESULTS.push({ name, ok: null, detail }); console.log(`  SKIP  ${name}  ${detail} — NOT VERIFIED`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(1, 66 - t.length))}`); }
function want(name) { return !FILTER || FILTER.includes(name.split(' ')[0].toUpperCase()); }
function assert(cond, name, okDetail, badDetail) { (cond ? pass : fail)(name, cond ? okDetail : badDetail); }

/* ───────────────────────────── virtual page model ───────────────────────── */

const PAGE = {
  url: 'http://fixture.jexi/page',
  title: 'Vision Fixture',
  viewport: { width: 1024, height: 768 },
  elements: [
    { tag: 'a', text: 'Open documentation', attributes: { href: '/docs', 'data-jexi-id': 'a-docs' }, jexi_key: 'data-jexi-id:a-docs', rect: { x: 40, y: 80, w: 180, h: 24 } },
    { tag: 'button', text: 'Save form', attributes: { type: 'button', 'data-jexi-id': 'btn-save' }, jexi_key: 'data-jexi-id:btn-save', rect: { x: 40, y: 140, w: 120, h: 36 } },
    { tag: 'canvas', text: '', attributes: { width: '320', height: '180', 'data-jexi-id': 'canvas-1' }, jexi_key: 'data-jexi-id:canvas-1', rect: { x: 40, y: 220, w: 320, h: 180 } },
  ],
  // Drawn INSIDE the canvas: exists in pixels, has NO DOM node of its own.
  canvasButton: { label: 'Export report', box: { x: 220, y: 330, w: 120, h: 32 } },
};

const CANVAS_BTN_RED = [220, 38, 38]; // #dc2626

/** Paint the fixture page into RGBA pixels — the truth the PNG must match. */
function paintPage() {
  const { width: W, height: H } = PAGE.viewport;
  const px = Buffer.alloc(W * H * 4, 255); // white bg, opaque
  const set = (x, y, [r, g, b]) => { const o = (y * W + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; };
  const rect = (b, c, border) => {
    for (let y = Math.round(b.y); y < Math.round(b.y + b.h); y++) {
      for (let x = Math.round(b.x); x < Math.round(b.x + b.w); x++) {
        const edge = border && (x < b.x + 1 || x >= b.x + b.w - 1 || y < b.y + 1 || y >= b.y + b.h - 1);
        set(x, y, edge ? border : c);
      }
    }
  };
  rect({ x: 0, y: 0, w: W, h: 60 }, [30, 58, 95]);                 // header band
  rect(PAGE.elements[0].rect, [26, 86, 219]);                      // link
  rect(PAGE.elements[1].rect, [229, 231, 235], [156, 163, 175]);   // button
  rect(PAGE.elements[2].rect, [255, 255, 255], [156, 163, 175]);   // canvas
  rect(PAGE.canvasButton.box, CANVAS_BTN_RED);                     // drawn button
  return { px, width: W, height: H };
}

/** The DOM extraction the real page-side extractor would return for PAGE. */
const CANNED_EXTRACTION = JSON.stringify({
  url: PAGE.url,
  title: PAGE.title,
  elements: PAGE.elements.map(({ tag, text, attributes, jexi_key }) => ({ tag, text, attributes, jexi_key })),
});

/** Hit-test a viewport point against the virtual page (elementFromPoint truth). */
function hitTest(x, y) {
  const cb = PAGE.canvasButton.box;
  if (x >= cb.x && x < cb.x + cb.w && y >= cb.y && y < cb.y + cb.h) {
    return { key: 'data-jexi-id:canvas-1', tag: 'canvas', text: PAGE.canvasButton.label }; // canvas is the top element
  }
  for (const el of PAGE.elements) {
    const r = el.rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      return { key: el.jexi_key, tag: el.tag, text: el.text };
    }
  }
  return { key: null, tag: null, text: '' };
}

/* ───────────────────── minimal RFC6455 WebSocket server (FIXTURE) ───────── */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
class WsConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.onmessage = null;
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this._drain(); });
    socket.on('error', () => {});
  }
  _drain() {
    while (this.buf.length >= 2) {
      const fin = this.buf[0] & 0x80, op = this.buf[0] & 0x0f;
      const masked = this.buf[1] & 0x80;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      let payload = Buffer.from(this.buf.subarray(off + maskLen, off + maskLen + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.buf = this.buf.subarray(off + maskLen + len);
      if (op === 8) { this.socket.end(); return; }
      if (op === 9) { this._frame(10, payload); continue; } // ping → pong
      if (op === 1 && fin && this.onmessage) this.onmessage(payload.toString('utf8'));
    }
  }
  _frame(op, payload) {
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { /* gone */ }
  }
  send(text) { this._frame(1, Buffer.from(text, 'utf8')); }
}

/* ─────────────────────────── CDP fixture server ─────────────────────────── */

async function startFixtureServer() {
  const events = []; // real dispatch log: every Input event + nav + eval signature
  let pngPaint = null;
  const server = http.createServer((req, res) => {
    if (req.url === '/json/list' || req.url === '/json/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'page-fixture-1', type: 'page', url: PAGE.url, title: PAGE.title, webSocketDebuggerUrl: `ws://${req.headers.host}/devtools/page/page-fixture-1` }]));
      return;
    }
    res.writeHead(404); res.end();
  });
  const conns = new Set();
  const sessions = new Map(); // sessionId → targetId
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const conn = new WsConn(socket);
    conns.add(conn);
    conn.onmessage = (text) => {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      const reply = (result) => conn.send(JSON.stringify({ id: msg.id, result }));
      const { method, params = {}, sessionId } = msg;
      if (method === 'Target.createTarget') return reply({ targetId: 'page-fixture-1' });
      if (method === 'Target.attachToTarget') { sessions.set(params.sessionId || 'sess-fixture-1', params.targetId); return reply({ sessionId: params.sessionId || 'sess-fixture-1' }); }
      if (method === 'Target.closeTarget' || method === 'Browser.getVersion' || method === 'Target.getTargets') return reply(method === 'Browser.getVersion' ? { product: 'fixture-cdp/1.0', userAgent: 'FixtureCDP' } : {});
      if (!sessionId) return reply({}); // any other browser-level call
      if (method === 'Page.captureScreenshot') {
        if (!pngPaint) pngPaint = paintPage();
        const { px, width: W, height: H } = pngPaint;
        let rgba = px, w = W, h = H;
        const clip = params.clip;
        if (clip) { // CSS px == image px at dpr 1
          w = Math.round(clip.width); h = Math.round(clip.height);
          rgba = Buffer.alloc(w * h * 4, 255);
          const x0 = Math.round(clip.x), y0 = Math.round(clip.y);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const sx = x0 + x, sy = y0 + y;
            if (sx >= 0 && sx < W && sy >= 0 && sy < H) px.copy(rgba, (y * w + x) * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + 4);
          }
        }
        return reply({ data: vision.encodePng(rgba, w, h).toString('base64') });
      }
      if (method === 'Input.dispatchMouseEvent' || method === 'Input.dispatchKeyEvent') {
        events.push({ t: method === 'Input.dispatchMouseEvent' ? 'mouse' : 'key', ...(method.includes('Mouse') ? { type: params.type, x: params.x, y: params.y } : { type: params.type, key: params.key }) });
        return reply({});
      }
      if (method === 'Page.navigate') {
        events.push({ t: 'nav', url: params.url });
        reply({ frameId: 'f-1' });
        setTimeout(() => { for (const c of conns) c.send(JSON.stringify({ method: 'Page.loadEventFired', sessionId })); }, 10);
        return undefined;
      }
      if (method === 'Runtime.evaluate') return reply(evaluateFixture(params.expression));
      return reply({}); // Page.enable, Runtime.enable, addScriptToEvaluateOnNewDocument, …
    };
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, events, conns, port: () => server.address().port, close: () => new Promise((r) => server.close(r)) };
}

/** Real page semantics for the expressions the runtime sends (known ones exactly; unknown → null). */
function evaluateFixture(expression) {
  const v = (value) => ({ result: { type: typeof value === 'string' ? 'string' : typeof value, value } });
  if (expression.includes('__JEXI_VISION_PT__')) {
    const m = expression.match(/elementFromPoint\(([\d.]+),\s*([\d.]+)\)/);
    return v(JSON.stringify(m ? hitTest(parseFloat(m[1]), parseFloat(m[2])) : { key: null, tag: null, text: '' }));
  }
  if (expression.includes('INTERACTIVE_TAGS')) return v(CANNED_EXTRACTION);
  if (expression.includes('devicePixelRatio')) return v(1);
  if (expression.includes('document.readyState')) return v('complete');
  if (expression.includes('location.href') && expression.includes('document.title')) {
    return v(JSON.stringify({ url: PAGE.url, title: PAGE.title, readyState: 'complete' }));
  }
  if (expression.includes('getBoundingClientRect')) {
    // Locator sources (buildLocatorJs): key form concatenates
    // `'[attr="' + CSS.escape("value") + '"]'`; selector form embeds the selector.
    const val = expression.match(/CSS\.escape\("([^"]+)"\)/);
    const attr = expression.match(/'\[(data-jexi-id|id|data-testid|data-test|data-qa|name)=/);
    const sel = expression.match(/document\.querySelector\("(\[^"]+|[^"]*)"\)/);
    const el = (val && attr && PAGE.elements.find((e) => e.attributes[attr[1]] === val[1]))
      || (sel && sel[1] && PAGE.elements.find((e) => `[data-jexi-id="${e.attributes['data-jexi-id']}"]` === sel[1]));
    if (!el) return v('null');
    const { x, y, w, h } = el.rect;
    return v(JSON.stringify({ x: x + Math.round(w / 2), y: y + Math.round(h / 2), width: w, height: h }));
  }
  if (expression.includes('.click()')) return v('true');
  if (expression.includes('elementFromPoint') && !expression.includes('__JEXI_VISION_PT__')) return v('null');
  return v(null); // dialog shim probes and any other page-side call
}

/* ─────────────────────────────── deciders ───────────────────────────────── */

/** Stand-in DOM decider (the deterministic text matcher; an LLM fills this role in production). */
function createDomTextDecider() {
  return async function domTextDecider({ snapshot, task }) {
    const needle = String(task).toLowerCase();
    const el = (snapshot.elements || []).find((e) => (e.text || '').toLowerCase().includes(needle));
    if (!el) return null;
    return { action: 'click_element', input: { index: el.index }, reasoning: `DOM snapshot contains "${el.text}" at index ${el.index}` };
  };
}

/** Fixture detector — labeled; ground truth from PAGE. NOT a model. */
function makeFixtureDetector() {
  return vision.createFixtureDetector({
    'export report': { ...PAGE.canvasButton.box },
    'save form': { ...PAGE.elements[1].rect },
  });
}

/* ────────────────────────────────── probes ──────────────────────────────── */

async function probeP1({ session }) {
  const t0 = performance.now();
  const shot = await vision.captureScreenshot(session);
  const ms = performance.now() - t0;
  const sigOk = shot.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = shot.buffer.readUInt32BE(16), h = shot.buffer.readUInt32BE(20);
  fs.writeFileSync(`${ART}/p1-page.png`, shot.buffer);
  assert(sigOk && w === 1024 && h === 768 && shot.bytes > 0, 'P1 capture',
    `${w}x${h} png, ${shot.bytes} B, capture ${ms.toFixed(1)} ms → /tmp/phase17-c/p1-page.png`,
    `sig=${sigOk} ${w}x${h} bytes=${shot.bytes}`);
  return shot;
}

async function probeP2({ pageShot }) {
  const t0 = performance.now();
  const cb = PAGE.canvasButton.box;
  const crop = vision.cropPng(pageShot.buffer, cb);
  const cropMs = performance.now() - t0;
  const img = vision.decodePng(crop);
  const mid = ((16) * img.width + 60) * 4; // pixel (60,16) — inside the drawn button
  const rgb = [img.rgba[mid], img.rgba[mid + 1], img.rgba[mid + 2]];
  const redOk = Math.abs(rgb[0] - 220) <= 10 && Math.abs(rgb[1] - 38) <= 10 && Math.abs(rgb[2] - 38) <= 10;
  fs.writeFileSync(`${ART}/p2-crop.png`, crop);
  assert(img.width === cb.w && img.height === cb.h && redOk, 'P2 crop',
    `${img.width}x${img.height} crop, pixel(60,16)=rgb(${rgb}) in ${cropMs.toFixed(1)} ms → /tmp/phase17-c/p2-crop.png`,
    `${img.width}x${img.height} pixel=${rgb}`);
  const canvas = vision.cropPng(pageShot.buffer, PAGE.elements[2].rect);
  const ci = vision.decodePng(canvas);
  fs.writeFileSync(`${ART}/p2-canvas.png`, canvas);
  assert(ci.width === 320 && ci.height === 180, 'P2 crop canvas region', 'canvas crop 320x180', `${ci.width}x${ci.height}`);
}

async function probeP3({ dom, detector, session }) {
  const decide = vision.createVisionDecider({ domDecider: createDomTextDecider(), getSession: () => session, detector });
  const snapshot = dom.index(JSON.parse(CANNED_EXTRACTION));
  const plan = await decide({ snapshot, snapshot_text: snapshot.text, task: 'Save form', step: 0, history: [] });
  assert(plan && plan.action === 'click_element' && plan.decided_by === 'dom' && detector.calls === 0, 'P3 DOM priority',
    `decided_by=dom, action=${plan.action}, detector.calls=${detector.calls} (vision not consulted)`,
    `plan=${JSON.stringify(plan && { action: plan.action, by: plan.decided_by })} detector.calls=${detector.calls}`);
  return plan;
}

async function probeP4({ dom, detector, session, eventsBefore }) {
  const decide = vision.createVisionDecider({ domDecider: createDomTextDecider(), getSession: () => session, detector });
  const snapshot = dom.index(JSON.parse(CANNED_EXTRACTION));
  const t0 = performance.now();
  const plan = await decide({ snapshot, snapshot_text: snapshot.text, task: 'Export report', step: 0, history: [] });
  const decideMs = performance.now() - t0;
  const visionOk = plan && plan.decided_by === 'vision' && plan.action === 'vision_click' && /fixture/i.test(plan.vision.detector);
  const cb = PAGE.canvasButton.box;
  const centerOk = plan && Math.abs(plan.input.center.x - (cb.x + cb.w / 2)) < 1 && Math.abs(plan.input.center.y - (cb.y + cb.h / 2)) < 1;
  assert(visionOk && centerOk, 'P4 vision-only target (canvas button)',
    `decided_by=vision, center=(${Math.round(plan.input.center.x)},${Math.round(plan.input.center.y)}), detector=${plan.vision.detector}, decide ${decideMs.toFixed(1)} ms`,
    `plan=${JSON.stringify(plan && { action: plan.action, by: plan.decided_by, center: plan.input && plan.input.center })}`);
  const click = await vision.performVisionClick(session, plan);
  const mouse = eventsAfter(eventsBefore).filter((e) => e.t === 'mouse');
  const pressed = mouse.find((e) => e.type === 'mousePressed');
  const underOk = click.under_point && click.under_point.key === 'data-jexi-id:canvas-1' && click.under_point.text === 'Export report';
  assert(mouse.length === 3 && pressed && pressed.x === 280 && pressed.y === 346 && underOk, 'P4 vision click → real Input events',
    `3 mouse events, mousePressed at (${pressed ? pressed.x : '?'},${pressed ? pressed.y : '?'}), element under point = canvas (drawn button has no DOM node)`,
    `events=${mouse.length} under=${JSON.stringify(click.under_point)}`);
  return plan;
}

async function probeP5({ session, dom }) {
  const link = PAGE.elements[0].rect, btn = PAGE.elements[1].rect;
  const k1 = await vision.keyAtPoint(session, link.x + link.w / 2, link.y + link.h / 2);
  const k2 = await vision.keyAtPoint(session, btn.x + btn.w / 2, btn.y + btn.h / 2);
  const k3 = await vision.keyAtPoint(session, 280, 346); // drawn button → canvas
  const roundTrip = dom.keyFor(0) === 'data-jexi-id:a-docs';
  const allOk = k1.key === 'data-jexi-id:a-docs' && k1.tag === 'a' && k2.key === 'data-jexi-id:btn-save' && k3.key === 'data-jexi-id:canvas-1' && roundTrip;
  assert(allOk, 'P5 coordinate → durable key',
    `(${Math.round(link.x + link.w / 2)},${link.y + 12})→${k1.key}; btn→${k2.key}; in-canvas→${k3.key}; dom.keyFor(0)=${dom.keyFor(0)}`,
    `k1=${k1.key} k2=${k2.key} k3=${k3.key} roundtrip=${roundTrip}`);
}

async function probeP6({ session, dom, detector, eventsBefore }) {
  const HINTS = ['Open documentation', 'Export report']; // scripted hint sequence — no LLM key
  // The documented composition: chainDeciders([domDecider, visionDecider]). The
  // vision decider's inner DOM stage is a no-op here because the standalone DOM
  // decider already ran upstream in the chain.
  const visionStage = vision.createVisionDecider({ domDecider: () => null, getSession: () => session, detector });
  const chained = chainDeciders([createDomTextDecider(), visionStage]);
  // Register the vision actions on the loop's registry (default granted set
  // covers 'interact') so vision_click dispatches through the standard path.
  const registry = createActionRegistry();
  registry.registerAll([vision.visionClickAction(), vision.capturePageAction()]);
  const decide = async (ctx) => {
    const hint = HINTS[ctx.step];
    if (!hint) return { action: 'finish', input: { reason: 'scripted goals complete' }, reasoning: 'all scripted goals completed' };
    return chained({ ...ctx, task: hint });
  };
  const stepEvents = [];
  const agent = new BrowserAgent({
    session, decide, registry, dom, installDialogShim: false, maxSteps: 4,
    onEvent: (e) => stepEvents.push(e),
  });
  const t0 = performance.now();
  const run = await agent.run('open docs, then export the report (fixture task)');
  const runMs = performance.now() - t0;
  const actions = (run.history || []).map((h) => h.action);
  const visionStep = (run.history || []).find((h) => h.action === 'vision_click');
  const mouse = eventsAfter(eventsBefore).filter((e) => e.t === 'mouse' && e.type === 'mousePressed');
  const clickedLink = mouse.some((e) => e.x === 130 && e.y === 92);
  const clickedCanvas = mouse.some((e) => e.x === 280 && e.y === 346);
  const ok = run.finished && actions[0] === 'click_element' && actions[1] === 'vision_click' && clickedLink && clickedCanvas
    && visionStep && /fixture/i.test(String(visionStep.input.detector || ''));
  assert(ok, 'P6 multi-step (DOM step + vision step) through the real loop',
    `finished=${run.finished}, actions=${actions.join(' → ')}, real clicks at (130,92)+(${mouse.length} pressed), ${runMs.toFixed(1)} ms`,
    `finished=${run.finished} actions=${actions.join(',')} link=${clickedLink} canvas=${clickedCanvas} reason=${run.reason || ''}`);
  return run;
}

async function probeP7({ dom, detector, session, eventsBefore }) {
  const decide = vision.createVisionDecider({ domDecider: createDomTextDecider(), getSession: () => session, detector });
  const snapshot = dom.index(JSON.parse(CANNED_EXTRACTION));
  let err = null;
  try { await decide({ snapshot, snapshot_text: snapshot.text, task: 'zzz nonexistent widget', step: 0, history: [] }); } catch (e) { err = e; }
  const mouseAfter = eventsAfter(eventsBefore).filter((e) => e.t === 'mouse').length;
  assert(err && err.code === vision.E_NO_TARGET && err instanceof vision.VisionNoTargetError && mouseAfter === 0, 'P7 no-target refusal',
    `threw VisionNoTargetError code=E_NO_TARGET, "${err ? err.message.slice(0, 60) : ''}…", 0 input events dispatched`,
    `err=${err ? `${err.name}/${err.code}` : 'none'} mouseEvents=${mouseAfter}`);
}

async function probeP8({ dom, session, eventsBefore }) {
  // DOM decider only — the unchanged OpenHands path. One click, then finish.
  let clicked = false;
  const domOnce = async (ctx) => {
    if (clicked) return { action: 'finish', input: { reason: 'DOM click executed' }, reasoning: 'DOM decider path verified' };
    clicked = true;
    return createDomTextDecider()(ctx);
  };
  const decide = chainDeciders([domOnce]);
  const agent = new BrowserAgent({ session, decide, dom, installDialogShim: false, maxSteps: 3 });
  const run = await agent.run('Save form');
  const first = (run.history || [])[0] || {};
  const pressed = eventsAfter(eventsBefore).filter((e) => e.t === 'mouse' && e.type === 'mousePressed');
  const atButton = pressed.some((e) => e.x === 100 && e.y === 158);
  assert(run.finished && first.action === 'click_element' && atButton, 'P8 DOM decider works (unchanged path)',
    `click_element by index → real mousePressed at (100,158), finished=${run.finished}`,
    `action=${first.action} atButton=${atButton} finished=${run.finished}`);
}

async function probeP9() {
  const detector = makeFixtureDetector();
  const fakeSession = {
    enable: async () => {},
    send: async (m, p) => (m === 'Page.captureScreenshot' ? { data: vision.encodePng(...paintToArgs()).toString('base64') } : {}),
    eval: async (expr) => (expr.includes('__JEXI_VISION_PT__') ? JSON.stringify(hitTest(280, 346)) : (expr.includes('devicePixelRatio') ? 1 : 'null')),
  };
  const decide = vision.createVisionDecider({ domDecider: createDomTextDecider(), getSession: () => fakeSession, detector });
  const dom = new DomService();
  const snapshot = dom.index(JSON.parse(CANNED_EXTRACTION));
  const plan = await decide({ snapshot, snapshot_text: snapshot.text, task: 'Export report', step: 0, history: [] });
  const r = String(plan.reasoning || '');
  const ok = r.length > 40 && r.includes('viewport') && /fixture/i.test(r) && plan.vision && typeof plan.vision.screenshot_ms === 'number';
  assert(ok, 'P9 reasoning field',
    `"${r.slice(0, 120)}…"`,
    `reasoning=${JSON.stringify(r).slice(0, 120)}`);
}

function paintToArgs() {
  const { px, width, height } = paintPage();
  return [px, width, height];
}

async function probeP10({ timings }) {
  const rows = Object.entries(timings).map(([k, v]) => `${k}=${v == null ? '—' : `${Number(v).toFixed(1)}ms`}`);
  const allFinite = Object.values(timings).every((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0));
  assert(allFinite, 'P10 real timing', rows.join(', '), rows.join(', '));
}

/* ──────────────────────────────── harness ───────────────────────────────── */

function eventsAfter(before) { return globalThis.__FX_EVENTS.slice(before); }

async function main() {
  console.log('PHASE 17 — SCOPE C PROBE — vision-based browser control');
  console.log('runtime: node ' + process.version);
  console.log('NOTE: target detection uses a labeled FIXTURE detector (no image model in this');
  console.log('      sandbox) — vision-decision MODEL quality is NOT VERIFIED here; every other');
  console.log('      step runs for real over a WebSocket CDP fixture server through the runtime.');

  const fixture = await startFixtureServer();
  globalThis.__FX_EVENTS = fixture.events;
  const port = fixture.port();
  const client = await connectCdp(`ws://127.0.0.1:${port}/devtools/browser/fixture`);
  const session = await client.createSession({ url: PAGE.url });
  const dom = new DomService();
  const pageShot = await vision.captureScreenshot(session);
  const detector = makeFixtureDetector();
  const timings = { screenshot: null, crop: null, decide_vision: null, click_vision: null, agent_run: null };

  const only = (n) => !FILTER || FILTER.includes(n);

  try {
    if (only('P1')) { const t0 = performance.now(); await probeP1({ session }); timings.screenshot = performance.now() - t0; }
    if (only('P2')) { const t0 = performance.now(); await probeP2({ pageShot }); timings.crop = performance.now() - t0; }
    if (only('P3')) await probeP3({ dom, detector, session });
    if (only('P4')) { const before = fixture.events.length; const t0 = performance.now(); await probeP4({ dom, detector, session, eventsBefore: before }); timings.click_vision = performance.now() - t0; }
    if (only('P5')) await probeP5({ session, dom });
    if (only('P6')) { const before = fixture.events.length; const t0 = performance.now(); await probeP6({ session, dom, detector, eventsBefore: before }); timings.agent_run = performance.now() - t0; }
    if (only('P7')) await probeP7({ dom, detector, session, eventsBefore: fixture.events.length });
    if (only('P8')) await probeP8({ dom, session, eventsBefore: fixture.events.length });
    if (only('P9')) { const t0 = performance.now(); await probeP9(); timings.decide_vision = performance.now() - t0; }
    if (only('P10')) await probeP10({ timings });
  } finally {
    try { await session.close(); } catch { /* fixture */ }
    try { client.close && client.close(); } catch { /* fixture */ }
    fixture.close();
  }

  const nPass = RESULTS.filter((r) => r.ok === true).length;
  const nFail = RESULTS.filter((r) => r.ok === false).length;
  const nSkip = RESULTS.filter((r) => r.ok === null).length;
  console.log(`\n══ SUMMARY: ${nPass} pass / ${nFail} fail / ${nSkip} skipped (skips are NOT VERIFIED, never failures) ══`);
  console.log(`artifacts: ${ART}/ (p1-page.png, p2-crop.png, p2-canvas.png)`);
  console.log('verdict: capture/crop/priority/coordinates/refusal/loop/timing VERIFIED on the CDP');
  console.log('         fixture wire; image-model detection NOT VERIFIED — no model in this runtime.');
  process.exitCode = nFail > 0 ? 1 : 0;
}

main().catch((e) => { console.error('PROBE CRASH:', e); process.exitCode = 1; });
