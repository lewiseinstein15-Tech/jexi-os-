#!/usr/bin/env node
// JEXI OS — PHASE 31 SCOPE 2 — live probe (P1..P10): console wiring.
// Zero new dependencies: playwright + vite + react are existing lockfile
// packages (installed via the documented `npm ci` bootstrap at both roots).
// Network: 127.0.0.1 only (vite dev server :3000 + booted JEXI server :3002).
// Screenshots are written OUTSIDE the repo (/home/z/my-project/download/
// phase31-scope2/) so the P9 zone check stays clean. The P5 GUI event replay
// uses REAL Phase 29 loop output captured in this process (Scope B fake
// operator + probe-local fixture PNG + stub VLM client — test-only, the same
// disclosure discipline as the Scope F/K probes) and flows it through the
// shipped computer/events emit seam inside the live page. Nothing fakes live
// GUI progress: the /gui command surface renders the server's verbatim
// envelopes, and the sandbox's truthful unavailable path is shown as-is.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = '/home/z/my-project/download/phase31-scope2';
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31p2-'));
const CONSOLE_URL = 'http://127.0.0.1:3000/ui/web/console/shell/index.html';

const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok, evidence });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` — ${evidence}` : ''}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- infrastructure boots (server + vite) ---------------- */
const serverLog = path.join(TMP, 'server.log');
spawn(process.execPath, ['index.js'], {
  cwd: path.join(ROOT, 'server'),
  env: { ...process.env, PORT: '3002', HOST: '127.0.0.1', COMPUTER_RUNTIME: 'local', JEXI_W31_RUNTIME: path.join(TMP, 'w31-runtime') },
  stdio: ['ignore', fs.openSync(serverLog, 'a'), fs.openSync(serverLog, 'a')],
});
const viteLog = path.join(TMP, 'vite.log');
spawn('npm', ['run', 'dev', '--', '--strictPort'], {
  cwd: ROOT,
  env: { ...process.env, BROWSER: 'none' },
  stdio: ['ignore', fs.openSync(viteLog, 'a'), fs.openSync(viteLog, 'a')],
});

async function waitUrl(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return res.status;
    } catch { /* not up yet */ }
    await pause(600);
  }
  return null;
}

/* ---------------- P4 helpers (node-side, in-process WA4 proof) --------- */
async function wa4Proof() {
  const topologies = await import(path.join(ROOT, 'agents/swarm', 'topologies', 'index.js'));
  const workforce = await import(path.join(ROOT, 'server', 'src', 'workforce', 'registry', 'index.js'));
  workforce.registerAll();
  const stats = workforce.rosterStats();
  const cap = Object.keys(stats.byCapability).sort()[0];
  const composed = workforce.composeWorkforce(cap, { limit: 4 });
  const roster = (composed.length >= 2 ? composed : workforce.listAgents().slice(0, 4));
  const members = roster.map((a) => a.slug || a.agentId).slice(0, 4);
  if (members.length < 2) throw new Error(`workforce index too small: ${members.length}`);
  // Dispatch -> topology selection (passthrough default: no topology arg
  // leaves dispatch byte-identical; an explicit topology is built+validated).
  const topo = topologies.build('star', members);
  const verdict = topologies.validate(topo);
  const hops = topo.route(members[0], members[members.length - 1]);
  return {
    cap,
    members,
    topology: topo.type,
    edges: topo.edges.length,
    valid: verdict.valid,
    route: hops ? [...hops] : null,
    known: topologies.list(),
  };
}

/* ---------------- P5 helpers (real loop -> raw guiEvents) -------------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodeFixture(width, height, pixelAt) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
const RED_PNG = encodeFixture(8, 6, () => [255, 0, 0, 255]);

async function runRealLoopCaptureRawEvents() {
  const { createGuiAgent } = await import(path.join(ROOT, 'services/computer', 'loop', 'index.js'));
  const { createVlm } = await import(path.join(ROOT, 'services/computer', 'vlm', 'index.js'));
  const { createFakeOperator } = await import(path.join(ROOT, 'services/computer', 'operators', 'index.js'));
  const openAiResponse = (content) => ({
    id: 'chatcmpl-stub-w31s2', object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
  const CONTENT_CLICK = "Thought: The button is visible; I will click it.\nclick(start_box='<|box_start|>(4,3)<|box_end|>')";
  const CONTENT_FINISHED = "Thought: The task is done.\nfinished(content='task complete')";
  const responses = [openAiResponse(CONTENT_CLICK), openAiResponse(CONTENT_FINISHED)];
  const stubClient = (payload) => {
    if (responses.length === 0) throw new Error('stub queue exhausted');
    return responses.shift();
  };
  const fixtureSource = { name: 'fixture-red-8x6', testOnly: true, screenshot: () => RED_PNG };
  const SES = 'console-main';
  const TURN = 'gui-fixture-turn-1';
  const BASE_TS = 1700000000000;
  let tick = 0;
  const raw = [];
  const push = (evt) => raw.push(evt);
  const agent = createGuiAgent({
    vlm: createVlm({ client: stubClient, model: 'stub-ui-tars' }),
    operator: createFakeOperator(),
    captureSource: fixtureSource,
  });
  const run = await agent.run({
    instruction: 'complete the task on screen',
    onStep: (rec) => {
      push({ kind: 'screenshot_taken', ts: BASE_TS + (++tick), sessionId: SES, turnId: TURN, step: rec.step, shot: { width: rec.screenshot.width, height: rec.screenshot.height, dpi: rec.screenshot.dpi } });
      push({ kind: 'vlm_prediction', ts: BASE_TS + (++tick), sessionId: SES, turnId: TURN, step: rec.step, text: rec.prediction });
      push({ kind: 'action_parsed', ts: BASE_TS + (++tick), sessionId: SES, turnId: TURN, step: rec.step, action: rec.action.action });
      if (rec.result && rec.result.ok === true) push({ kind: 'action_result_ok', ts: BASE_TS + (++tick), sessionId: SES, turnId: TURN, step: rec.step, action: rec.action.action, result: rec.result.result });
      else push({ kind: 'action_result_fail', ts: BASE_TS + (++tick), sessionId: SES, turnId: TURN, step: rec.step, action: rec.action.action, error: rec.result.error });
    },
  });
  push({ kind: 'loop_finished', ts: BASE_TS + (++tick), sessionId: SES, turnId: TURN, stoppedBy: run.stoppedBy });
  return { run, raw };
}

/* ================= P1 — server + console boot =========================== */
console.log('\n== P1 server + console boot (default Phase 24 shell) ==');
const hs = await waitUrl('http://127.0.0.1:3002/api/health');
check('P1.server-up', hs === 200, `GET :3002/api/health -> ${hs}`);
const hv = await waitUrl(CONSOLE_URL);
check('P1.vite-up', hv === 200, `GET console shell -> ${hv}`);

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

await page.goto(CONSOLE_URL + '#/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-composer', { timeout: 30000 });
const navItems = await page.$$eval('.jx-nav-item', (els) => els.map((e) => e.textContent.trim()));
check('P1.shell-nav', JSON.stringify(navItems) === JSON.stringify(['Chat', 'Settings', 'Work Graph', 'Agents']),
  `sidebar = ${JSON.stringify(navItems)} (Chat / Settings / Work Graph + WA7 Agents)`);
await page.screenshot({ path: path.join(SHOTS, 'console-default.png') });
console.log(`screenshot: ${path.join(SHOTS, 'console-default.png')}`);

/* ================= P2 — WA6 chat runtime surfaces ======================= */
console.log('\n== P2 WA6 — chat runtime modules surfaced ==');
// 2a. queue chip while a turn is active: write-intent message -> approval
// (turn ACTIVE) -> second message goes through queue.enqueue -> HELD.
await page.click('.p24-input');
await page.keyboard.type('write a wiring note for scope two', { delay: 8 });
await page.click('.p24-send');
await page.waitForSelector('.p24-approval', { timeout: 15000 });
// The Phase 24 composer disables sends while a turn streams; the Scope M
// hold path is surfaced by the mount strip's queue affordance (WA6).
await page.fill('[data-testid="p31-queue-input"]', 'add a queued follow-up line');
await page.click('[data-testid="p31-queue-btn"]');
await page.waitForSelector('[data-testid="p31-queue-chip"]', { timeout: 10000 });
const queueChip = await page.$eval('[data-testid="p31-queue-chip"]', (e) => e.textContent.trim());
const queuedRows = await page.$$eval('.p24-narration', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes('queued')));
check('P2.queue-chip', queueChip === 'queue: 1' && queuedRows.length >= 1,
  `chip="${queueChip}"; narration rows=${JSON.stringify(queuedRows)}`);
await page.screenshot({ path: path.join(SHOTS, 'chat-queue.png') });
console.log(`screenshot: ${path.join(SHOTS, 'chat-queue.png')}`);

// 2b. steer injection path while the turn is still active.
await page.fill('[data-testid="p31-steer-input"]', 'keep the note terse');
await page.click('[data-testid="p31-steer-btn"]');
await page.waitForSelector('[data-testid="p31-steer-chip"]', { timeout: 10000 });
const steerChip = await page.$eval('[data-testid="p31-steer-chip"]', (e) => e.textContent.trim());
const steerRows = await page.$$eval('.p24-narration', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes('steer injected')));
check('P2.steer-injection', steerChip.includes('steer pending: 1') && steerRows.length >= 1,
  `chip="${steerChip}"; narration=${JSON.stringify(steerRows)} (delivery requires the queue's wrapped-agent seam; console turns use the runtime's internal default agent — pending state shown truthfully)`);
await page.screenshot({ path: path.join(SHOTS, 'chat-steer.png') });
console.log(`screenshot: ${path.join(SHOTS, 'chat-steer.png')}`);

// 2c. approve -> turn completes -> queue auto-flushes the held message.
await page.click('.p24-approve');
await page.waitForFunction(() => document.querySelectorAll('.p24-turnend').length >= 2, { timeout: 20000 });
const queueAfter = await page.$('[data-testid="p31-queue-chip"]');
const startedRows = await page.$$eval('.p24-narration', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes('queue started')));
check('P2.queue-auto-flush', !queueAfter && startedRows.length >= 1,
  `chip cleared=${!queueAfter}; auto-start rows=${JSON.stringify(startedRows)}`);

// 2d. checkpoints: create + list through the REAL checkpoints module.
await page.click('[data-testid="p31-checkpoints-btn"]');
await page.click('[data-testid="p31-checkpoint-create"]');
await page.waitForSelector('.p31-checkpoints .p31-checkpoint-note, [data-testid="p31-checkpoints-panel"]', { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll('[data-testid="p31-checkpoints-panel"] button').length >= 1, { timeout: 10000 });
const cpItems = await page.$$eval('[data-testid="p31-checkpoints-panel"] span', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes(':ck-')));
check('P2.checkpoints', cpItems.length >= 1, `checkpoint items=${JSON.stringify(cpItems)}`);
await page.screenshot({ path: path.join(SHOTS, 'chat-checkpoints.png') });
console.log(`screenshot: ${path.join(SHOTS, 'chat-checkpoints.png')}`);

// 2e. multi-agent view: real multiagent.view projection over the routed log.
await page.click('[data-testid="p31-multiagent-btn"]');
await page.waitForSelector('[data-testid="p31-multiagent-panel"]', { timeout: 10000 });
const maAgents = await page.$$eval('[data-testid="p31-multiagent-panel"] span', (els) => els.map((e) => e.textContent.trim()));
const maModes = await page.$$eval('[data-testid="p31-multiagent-panel"] button', (els) => els.map((e) => e.textContent.trim()));
check('P2.multiagent', maAgents.some((t) => t.includes('agent-runtime')) && ['single', 'split', 'interleaved', 'nested'].every((m) => maModes.includes(m)),
  `agent lanes=${JSON.stringify(maAgents)}; modes=${JSON.stringify(maModes)}`);
await page.screenshot({ path: path.join(SHOTS, 'chat-multiagent.png') });
console.log(`screenshot: ${path.join(SHOTS, 'chat-multiagent.png')}`);

// 2f. artifacts panel: the write_file turn produced a REAL card artifact
// (extractArtifacts: edit card + args.content). Open -> honest content view.
await page.click('[data-testid="p31-artifacts-btn"]');
await page.waitForSelector('[data-testid="p31-artifacts-panel"]', { timeout: 10000 });
const artEntries = await page.$$eval('[data-testid="p31-artifacts-panel"] span', (els) => els.map((e) => e.textContent.trim()));
check('P2.artifacts-entries', artEntries.some((t) => t.includes('/tmp/out.txt')) && artEntries.some((t) => t === 'file'),
  `panel spans=${JSON.stringify(artEntries.slice(0, 8))}`);
await page.click('[data-testid="p31-artifact-open"]');
await page.waitForSelector('[data-testid="p31-artifact-view"]', { timeout: 10000 });
const artView = await page.$eval('[data-testid="p31-artifact-view"]', (e) => e.textContent.trim().slice(0, 160));
check('P2.artifacts-open', artView.length > 0, `open() view -> ${JSON.stringify(artView)}`);
await page.screenshot({ path: path.join(SHOTS, 'chat-artifacts.png') });
console.log(`screenshot: ${path.join(SHOTS, 'chat-artifacts.png')}`);

/* ================= P3 — WA7 Agents View route =========================== */
console.log('\n== P3 WA7 — Agents View wired into nav ==');
await page.click('.jx-nav-item:has-text("Agents")');
await page.waitForSelector('[data-testid="agents-host"]', { timeout: 15000 });
await page.waitForSelector('.jcx .rowline', { timeout: 20000 });
const agentRows = await page.$$eval('.jcx .rowline', (els) => els.length);
const headerMeta = await page.$eval('.jcx .meta', (e) => e.textContent.trim()).catch(() => 'n/a');
check('P3.agents-view', agentRows >= 1, `AgentsView rows=${agentRows}; header="${headerMeta}" (live /api/agents/definitions)`);
await page.screenshot({ path: path.join(SHOTS, 'agents-view.png') });
console.log(`screenshot: ${path.join(SHOTS, 'agents-view.png')}`);

/* ================= P5 — S2-COMP /gui dispatch + Scope K stream ========== */
console.log('\n== P5 S2-COMP — /gui command + Phase 29 Scope K event stream ==');
await page.click('.jx-nav-item:has-text("Chat")');
await page.waitForSelector('.p24-composer', { timeout: 15000 });
await page.fill('.p24-input', '/gui open the settings page and screenshot it');
await page.click('.p24-send');
await page.waitForFunction(() => document.body.textContent.includes('operator unavailable'), { timeout: 20000 });
const guiRows = await page.$$eval('.p24-toolcard, .p24-text', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes('gui') || t.includes('computer runtime')));
check('P5.gui-truthful-path', guiRows.some((t) => t.includes('provider=local')) && guiRows.some((t) => t.includes('operator unavailable')),
  `rows=${JSON.stringify(guiRows.map((t) => t.slice(0, 90)))} (COMPUTER_RUNTIME=local envelope, verbatim; live GUI loop NOT VERIFIED — no display/VLM creds)`);

// Real Phase 29 loop -> raw guiEvents -> shipped emit seam INSIDE the page.
const { run: loopRun, raw: rawEvents } = await runRealLoopCaptureRawEvents();
const routedCount = await page.evaluate(async (evts) => {
  const mod = await import('/computer/events/index.js');
  let routed = 0;
  for (const e of evts) { const r = mod.emit(e); if (r && r.routed) routed += 1; }
  return routed;
}, rawEvents);
await page.waitForFunction(() => document.body.textContent.includes('gui loop stoppedBy=finished'), { timeout: 15000 });
const narrThoughts = await page.$$eval('.p24-narration', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes('start_box') || t.includes('finished(content')));
const guiTurnEnd = await page.$$eval('.p24-turnend', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.includes('gui loop stoppedBy')));
check('P5.scopeK-stream', loopRun.stoppedBy === 'finished' && rawEvents.length === 9 && routedCount === 9 && narrThoughts.length === 2 && guiTurnEnd.length === 1,
  `loop stoppedBy=${loopRun.stoppedBy}; raw guiEvents=${rawEvents.length}; routed in-page=${routedCount}; vlm narration rows=${narrThoughts.length}; loop turn-end="${guiTurnEnd[0] || 'MISSING'}" (fixture loop: fake operator + stub VLM + fixture PNG — disclosed test-only; rendered through the REAL map->router->rows path)`);
await page.screenshot({ path: path.join(SHOTS, 'computer-agent-events.png') });
console.log(`screenshot: ${path.join(SHOTS, 'computer-agent-events.png')}`);

/* ================= P7 — regression: existing console behavior =========== */
console.log('\n== P7 regression — existing routes still work ==');
await page.goto(CONSOLE_URL + '#/settings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-section', { timeout: 20000 });
check('P7.settings', true, 'Settings renders (.p24-section)');
await page.goto(CONSOLE_URL + '#/graph', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="graph-counts"], .p24-gnode-card', { timeout: 30000 });
check('P7.graph', true, 'Work Graph renders (graph-counts/gnode-card)');
await page.goto(CONSOLE_URL + '#/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-composer', { timeout: 20000 });
await page.click('.p24-input');
await page.keyboard.type('regression check');
const composerOk = await page.$eval('.p24-send', (e) => !e.disabled);
check('P7.chat', composerOk, 'Chat composer present; send enabled after input (fresh-boot idle state)');

/* ================= P4 — WA4 swarm topologies -> workforce dispatch ====== */
console.log('\n== P4 WA4 — swarm topologies reachable from workforce dispatch ==');
try {
  const w4 = await wa4Proof();
  check('P4.swarm-workforce', w4.members.length >= 2 && w4.valid && w4.route !== null,
    `in-process: composeWorkforce('${w4.cap}') -> [${w4.members.join(', ')}]; topologies.build('star') -> ${w4.edges} edges, validate=${w4.valid}, route=${w4.route ? w4.route.join('->') : 'null'}; known=[${w4.known.join(', ')}] | default dispatch passthrough = behavior-neutral (no topology arg). LIVE-SERVER MOUNT: needs a call-site outside the Scope 2 named list — disclosed, pending lead approval (see report)`);
} catch (e) {
  check('P4.swarm-workforce', false, `in-process proof failed: ${String(e && e.message || e).slice(0, 140)}`);
}

/* ================= P6 — shipped modules read-only ======================= */
console.log('\n== P6 read-only proof — shipped module diffs EMPTY ==');
const diffList = execSync('git diff --name-only HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const NAMED = ['interfaces/ui/web/console/chat/mount.js', 'interfaces/ui/web/console/shell/Sidebar.jsx', 'interfaces/ui/web/console/shell/Shell.jsx', 'scripts/phase31-scope-2-probe.mjs'];
const nonNamed = diffList.filter((f) => !NAMED.includes(f));
const shippedTrees = ['services/computer', 'agents/swarm', 'server/src/workforce', 'interfaces/console/components/console/views', 'interfaces/console/components/ChatWindow.jsx', 'interfaces/console/styles', 'runtime/events'];
const shippedDirty = diffList.filter((f) => shippedTrees.some((t) => f.startsWith(t)));
const chatDirty = diffList.filter((f) => f.startsWith('interfaces/ui/web/console/chat/') && f !== 'interfaces/ui/web/console/chat/mount.js');
const shellDirty = diffList.filter((f) => f.startsWith('interfaces/ui/web/console/shell/') && f !== 'interfaces/ui/web/console/shell/Sidebar.jsx' && f !== 'interfaces/ui/web/console/shell/Shell.jsx');
check('P6.shipped-untouched', nonNamed.length === 0 && shippedDirty.length === 0 && chatDirty.length === 0 && shellDirty.length === 0,
  `diff files=[${diffList.join(', ') || 'NONE'}]; outside named=${nonNamed.length}; shipped trees dirty=${shippedDirty.length}; chat (excl mount.js)=${chatDirty.length}; shell (excl Sidebar/Shell)=${shellDirty.length}`);

/* ================= P9 — zone check ====================================== */
console.log('\n== P9 zone check ==');
const statusList = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const statusPaths = statusList.map((l) => l.replace(/^(.{1,2})\s+/, ''));
const zoneBad = statusPaths.filter((p) => !NAMED.includes(p));
check('P9.zone', zoneBad.length === 0, `status=[${statusList.join(' | ')}]; violations=${JSON.stringify(zoneBad)} (screenshots written outside the repo)`);

/* ================= P10 — determinism: same boot + nav twice ============= */
console.log('\n== P10 determinism — two boots, identical rendered structure ==');
// DOM tree SHA: structural serialization (tag/id/class/data-testid, no text,
// no volatile styles) hashed in node — "DOM tree SHA or equivalent".
const structureOf = async (p) => p.evaluate(() => {
  const out = [];
  const walk = (node) => {
    if (node.nodeType !== 1) return;
    let s = node.tagName;
    if (node.id) s += `#${node.id}`;
    if (node.className && typeof node.className === 'string' && node.className.trim()) s += `.${node.className.trim().split(/\s+/).join('.')}`;
    const dt = node.getAttribute && node.getAttribute('data-testid');
    if (dt) s += `@${dt}`;
    out.push(s);
    for (const c of node.children) walk(c);
  };
  walk(document.querySelector('.jx-shell'));
  return out.join('|');
});
const sha = (s) => createHash('sha256').update(s).digest('hex');
async function navAndHash(freshPage) {
  await freshPage.goto(CONSOLE_URL + '#/chat', { waitUntil: 'domcontentloaded' });
  await freshPage.waitForSelector('.p24-composer', { timeout: 30000 });
  await freshPage.goto(CONSOLE_URL + '#/agents', { waitUntil: 'domcontentloaded' });
  await freshPage.waitForSelector('.jcx .rowline', { timeout: 20000 });
  await freshPage.goto(CONSOLE_URL + '#/chat', { waitUntil: 'domcontentloaded' });
  await freshPage.waitForSelector('.p24-composer', { timeout: 30000 });
  return sha(await structureOf(freshPage));
}
const pageA = await context.newPage();
pageA.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
const hashA = await navAndHash(pageA);
const pageB = await context.newPage();
pageB.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
const hashB = await navAndHash(pageB);
check('P10.deterministic-dom', hashA === hashB, `dom sha256[16] A=${hashA.slice(0, 16)} B=${hashB.slice(0, 16)} ${hashA === hashB ? 'IDENTICAL' : 'DIFFER'}`);
check('P10.no-page-errors', errors.length === 0, `pageerror count=${errors.length}${errors.length ? `: ${JSON.stringify(errors.slice(0, 3))}` : ''}`);

/* ================= cleanup + summary ==================================== */
await browser.close();
console.log('\n== server boot W31 lines (context, Scope 1 wiring intact) ==');
const w31 = fs.readFileSync(serverLog, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
console.log(`${w31.length} W31 lines, FAIL-SOFT=${w31.filter((l) => l.includes('FAIL-SOFT')).length}`);

console.log('\n== SUMMARY ==');
const pass = results.filter((r) => r.ok).length;
for (const r of results) if (!r.ok) console.log(`  FAILED: ${r.name} — ${r.evidence}`);
console.log(`[PHASE 31 SCOPE 2] ${pass}/${results.length} PASS`);
console.log(`screenshots: ${fs.readdirSync(SHOTS).sort().join(', ')}`);
process.exit(pass === results.length ? 0 : 1);
