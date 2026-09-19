#!/usr/bin/env node
/**
 * JEXI OS — Phase 17 Scope B — LIVE PROBES P1–P7.
 *
 * 45+ browser actions + the observe → think → act agent loop.
 * Raw output only. Every PASS is backed by the raw evidence printed above it.
 * When the engine is absent the verdict is NOT VERIFIED (exit 2), never a fake pass.
 *
 * Usage: node scripts/phase17-b-probe.mjs [--only=P1,P2,…]
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrowserRuntime } from '../runtimes/browser/index.js';
import { connectCdp } from '../runtimes/browser/cdp.js';
import { DomService } from '../runtimes/browser/dom-service.js';
import { createActionRegistry, actionInventory } from '../runtimes/browser/actions/index.js';
import { BrowserAgent } from '../runtimes/browser/agent-loop.js';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS_DIR, '..');
const OUT_DIR = path.join(REPO, 'output');

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const runProbe = (id) => !only || only.split(',').includes(id);

const results = {};
const pass = (id, note) => { results[id] = `PASS — ${note}`; };
const fail = (id, note) => { results[id] = `FAIL — ${note}`; };
const skip = (id, note) => { results[id] = `NOT VERIFIED — ${note}`; };

const header = (id, title) => {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`${id} — ${title}`);
  console.log('═══════════════════════════════════════════════════');
};
const show = (label, value) => {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`);
};
const raw = (label, value) => {
  console.log(`--- ${label} ---`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
};

/*
 * A real loopback HTTP server so "form submission" is a genuine POST
 * round-trip, not a mocked return. Obscura's SSRF guard blocks loopback by
 * default, so the engine is started with allowPrivateNetwork for this probe
 * only — and the only private address in play is this server.
 */
function startTestServer() {
  const index = `<!doctype html><html><head><title>JEXI Test Index</title></head><body>
<h1>JEXI Browser Test</h1>
<a id="to-form" href="/form.html">Go to form</a>
</body></html>`;
  const form = `<!doctype html><html><head><title>JEXI Test Form</title></head><body>
<h1>JEXI Test Form</h1>
<form id="the-form" method="POST" action="/submit">
  <label for="name">Name</label>
  <input id="name" name="name" type="text" placeholder="Your name">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" placeholder="Email">
  <button id="go" type="submit">Submit</button>
</form>
</body></html>`;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/submit') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><html><head><title>JEXI Test Result</title></head><body>
<h1 id="result">Submission received</h1>
<p id="echo-name">name=${params.get('name') || ''}</p>
<p id="echo-email">email=${params.get('email') || ''}</p>
</body></html>`);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/form.html' ? form : index);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let runtime = null;
let client = null;
let session = null;
let dom = null;
let registry = null;
let site = null;

async function boot() {
  runtime = await createBrowserRuntime({ stealth: true, allowPrivateNetwork: true, autostart: true });
  client = await connectCdp(runtime.up.cdp.webSocketDebuggerUrl);
  session = await client.createSession({ url: 'about:blank' });
  for (const d of ['Page', 'Runtime', 'DOM', 'Network', 'Emulation']) await session.enable(d);
  dom = new DomService();
  registry = createActionRegistry({ grantedPermissions: ['navigate', 'read', 'interact', 'eval', 'write', 'filesystem'] });
  site = await startTestServer();
  show('engine', { transport: runtime.up.transport, version: runtime.up.obscura_version, cdpUrl: runtime.cdpUrl, rss_kb: runtime.status().rss_kb });
  show('controlled test server', { url: `http://127.0.0.1:${site.port}/`, loopback: true });
}

const call = (name, input) => registry.dispatch(name, input, { session, client, dom, outputDir: OUT_DIR });
const indexOfKey = (snap, key) => snap.elements.find((e) => e.jexi_key === key)?.index ?? null;
const indexOfText = (snap, needle) => {
  const el = snap.elements.find((e) => (e.text || '').toLowerCase().includes(needle.toLowerCase()));
  return el ? el.index : null;
};

/* ── P1 — navigate to a real page ─────────────────────────────────────── */
async function P1() {
  header('P1', 'Navigate to a real page');
  const r = await call('navigate', { url: 'https://example.com' });
  raw('navigate → result', r.result);
  raw('navigate → envelope', { ok: r.ok, action: r.action, attempt: r.attempt, ms: r.ms });
  const ok = r.result.url.startsWith('https://example.com') && r.result.title === 'Example Domain';
  (ok ? pass : fail)('P1', `navigate ${r.result.url} in ${r.ms}ms`);
}

/* ── P2 — DOM extraction → indexed element list ───────────────────────── */
async function P2() {
  header('P2', 'DOM extraction → indexed element list');
  await call('navigate', { url: `http://127.0.0.1:${site.port}/form.html` });
  const snap = await dom.extract(session);
  raw('indexed elements (raw snapshot)', snap.elements.map((e) => ({ index: e.index, tag: e.tag, key: e.jexi_key, is_new: e.is_new, text: (e.text || '').slice(0, 40) })));
  raw('model-readable snapshot text', snap.text);
  const shot = await call('screenshot', { path: path.join(OUT_DIR, 'phase17-b-form.png'), full_page: false });
  raw('screenshot → result', shot.result);
  const ok = snap.elements.length >= 4 && snap.text.includes('INTERACTIVE ELEMENTS');
  (ok ? pass : fail)('P2', `${snap.elements.length} interactive elements indexed; screenshot ${shot.result.bytes} bytes`);
}

/* ── P3 — multi-step agent loop ───────────────────────────────────────── */
async function P3() {
  header('P3', 'Agent loop — navigate → click link → type → submit → extract');
  await call('navigate', { url: `http://127.0.0.1:${site.port}/` });

  const plan = [
    ({ snapshot }) => ({ action: 'click_element', input: { index: indexOfText(snapshot, 'Go to form') }, reasoning: 'click the link to the form page (index read from the snapshot)' }),
    ({ snapshot }) => ({ action: 'type_text', input: { index: indexOfKey(snapshot, 'id:name'), text: 'Ada Lovelace' }, reasoning: 'type the name field' }),
    ({ snapshot }) => ({ action: 'type_text', input: { index: indexOfKey(snapshot, 'id:email'), text: 'ada@example.com' }, reasoning: 'type the email field' }),
    ({ snapshot }) => ({ action: 'submit_form', input: { index: indexOfKey(snapshot, 'id:the-form') }, reasoning: 'submit the form' }),
    () => ({ action: 'get_text', input: { selector: '#result' }, reasoning: 'extract the result heading' }),
    () => ({ action: 'get_text', input: { selector: '#echo-name' }, reasoning: 'extract the echoed name' }),
  ];

  const agent = new BrowserAgent({
    session,
    decide: async ({ snapshot, step }) => (plan[step]
      ? plan[step]({ snapshot })
      : { action: 'finish', input: { reason: 'plan complete' } }),
    registry,
    dom,
    maxSteps: 12,
    outputDir: OUT_DIR,
    onEvent: (ev) => {
      if (ev.phase === 'observe') console.log(`  observe  elements=${ev.elements} new=${ev.new_count} url=${ev.url}`);
      if (ev.phase === 'think') console.log(`  think    step=${ev.step} action=${ev.action} input=${JSON.stringify(ev.input)}`);
      if (ev.phase === 'act') console.log(`  act      action=${ev.action} ok=${ev.ok} ms=${ev.ms} ${ev.ok ? `result=${JSON.stringify(ev.result).slice(0, 160)}` : `error=${JSON.stringify(ev.error)}`}`);
    },
  });

  const report = await agent.run('Navigate to the form, fill it in, submit it, and read the result.');
  session = agent.session;
  raw('run report (history)', report.history);
  raw('run summary', {
    finished: report.finished, finish_reason: report.finish_reason,
    steps: report.steps, final_url: report.final_url, final_title: report.final_title, elapsed_ms: report.elapsed_ms,
  });
  const texts = report.history.filter((h) => h.action === 'get_text').map((h) => h.result?.text);
  const ok = report.finished === true
    && report.final_title === 'JEXI Test Result'
    && texts.some((t) => (t || '').includes('Submission received'))
    && texts.some((t) => (t || '').includes('Ada Lovelace'));
  (ok ? pass : fail)('P3', `${report.steps} steps, final "${report.final_title}", extracted ${JSON.stringify(texts)}`);
}

/* ── P4 — form submission against the controlled target ───────────────── */
async function P4() {
  header('P4', 'Form submission — real POST to the controlled target');
  await call('navigate', { url: `http://127.0.0.1:${site.port}/form.html` });
  const typed = await call('type_text', { selector: '#name', text: 'Grace Hopper' });
  raw('type_text → result', typed.result);
  const before = await call('get_value', { selector: '#name' });
  raw('get_value before submit', before.result);
  const submitted = await call('submit_form', { selector: '#the-form' });
  raw('submit_form → result', submitted.result);
  const echoed = await call('get_text', { selector: '#echo-name' });
  raw('server-echoed value after POST', echoed.result);
  const ok = submitted.result.submitted === true && (echoed.result.text || '').includes('Grace Hopper');
  (ok ? pass : fail)('P4', `POST round-trip echoed "${echoed.result.text}"`);
}

/* ── P5 — element stability across snapshots and navigation ───────────── */
async function P5() {
  header('P5', 'Element stability — same page, and navigate away and back');
  await call('navigate', { url: `http://127.0.0.1:${site.port}/form.html` });
  const s1 = await dom.extract(session);
  const s2 = await dom.extract(session);
  const within = {
    snapshot_1: { name: indexOfKey(s1, 'id:name'), form: indexOfKey(s1, 'id:the-form') },
    snapshot_2: { name: indexOfKey(s2, 'id:name'), form: indexOfKey(s2, 'id:the-form') },
    new_in_2: s2.new_count,
  };
  raw('same page, two snapshots', within);

  await call('navigate', { url: 'https://example.com' });
  await call('navigate', { url: `http://127.0.0.1:${site.port}/form.html` });
  const s3 = await dom.extract(session);
  const after = {
    name: indexOfKey(s3, 'id:name'),
    form: indexOfKey(s3, 'id:the-form'),
    new_count: s3.new_count,
    durable_key_present: s3.elements.some((e) => e.jexi_key === 'id:name'),
    is_new: s3.elements.find((e) => e.jexi_key === 'id:name')?.is_new ?? null,
  };
  raw('after navigating away and back', after);

  const stableWithin = within.snapshot_1.name === within.snapshot_2.name
    && within.snapshot_1.form === within.snapshot_2.form;
  const ok = stableWithin && after.durable_key_present === true;
  (ok ? pass : fail)('P5', `indices stable across snapshots (${within.snapshot_1.name}==${within.snapshot_2.name}); durable key survives navigation (is_new=${after.is_new})`);
}

/* ── P6 — one action failing cleanly ──────────────────────────────────── */
async function P6() {
  header('P6', 'A failing action errors cleanly — no crash');
  let notFound = null;
  try { await call('click_element', { selector: '#does-not-exist' }); } catch (e) {
    notFound = { name: e.name, code: e.code, message: e.message };
  }
  raw('click_element on a non-existent selector', notFound || 'DID NOT THROW (BUG)');

  let unknownIndex = null;
  try { await call('click_element', { index: 9999 }); } catch (e) {
    unknownIndex = { name: e.name, code: e.code, message: e.message };
  }
  raw('click_element with an unknown snapshot index', unknownIndex || 'DID NOT THROW (BUG)');

  let badInput = null;
  try { await call('navigate', {}); } catch (e) {
    badInput = { name: e.name, code: e.code, message: e.message };
  }
  raw('navigate with a missing required field', badInput || 'DID NOT THROW (BUG)');

  const alive = await call('get_page_info', {});
  raw('session still alive after the failures', alive.result);

  const ok = notFound?.code === 'E_ELEMENT_NOT_FOUND'
    && unknownIndex?.code === 'E_ELEMENT_UNKNOWN_INDEX'
    && badInput?.name === 'ActionValidationError'
    && alive.ok === true;
  (ok ? pass : fail)('P6', 'E_ELEMENT_NOT_FOUND + E_ELEMENT_UNKNOWN_INDEX + validation error; session survives');
}

/* ── P7 — action inventory ────────────────────────────────────────────── */
async function P7() {
  header('P7', 'Action inventory — count derived from the registry, not a claim');
  const inv = actionInventory();
  raw('actionInventory()', { total: inv.total, by_group: inv.by_group, by_risk: inv.by_risk, duplicate_names: inv.duplicate_names });
  raw('registry.size()', registry.size());
  raw('all action names', inv.names.join(' '));
  const ok = inv.total >= 45 && inv.duplicate_names.length === 0 && registry.size() === inv.total;
  (ok ? pass : fail)('P7', `${inv.total} actions across ${Object.keys(inv.by_group).length} groups, 0 duplicates`);
}

/* ── runner ───────────────────────────────────────────────────────────── */
const PROBES = [['P1', P1], ['P2', P2], ['P3', P3], ['P4', P4], ['P5', P5], ['P6', P6], ['P7', P7]];

try {
  await boot();
  for (const [id, fn] of PROBES) {
    if (!runProbe(id)) continue;
    try { await fn(); } catch (e) { fail(id, `${e.name}: ${e.message}`); }
  }
} catch (e) {
  console.log(`\nBOOT FAILED: ${e.name}: ${e.message}`);
  for (const [id] of PROBES) if (runProbe(id) && !results[id]) skip(id, `engine unavailable — ${e.message}`);
} finally {
  try { client?.close(); } catch { /* best effort */ }
  try { await runtime?.stop(); } catch { /* best effort */ }
  try { site?.server?.close(); } catch { /* best effort */ }
}

console.log('\n═══════════════════════════════════════════════════');
console.log('PROBE SUMMARY');
console.log('═══════════════════════════════════════════════════');
for (const [id] of PROBES) console.log(`${id}: ${results[id] || '(skipped)'}`);

const anyFail = PROBES.some(([id]) => results[id]?.startsWith('FAIL'));
const anySkip = PROBES.some(([id]) => results[id]?.startsWith('NOT VERIFIED'));
process.exit(anyFail ? 1 : anySkip ? 2 : 0);
