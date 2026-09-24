/**
 * JEXI CLI — offline tests (no backend spawn, no network).
 *
 * Covers: config roundtrip (temp JEXI_HOME), server-dir discovery, API
 * client headers + NDJSON parsing (incl. split chunks), event renderer,
 * wizard validators, doctor checks with fakes.
 *
 * Run: node test-cli.js   (from cli/)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI_DIR = new URL('.', import.meta.url).pathname;

// Isolate config writes BEFORE importing config.js (it reads env lazily — safe).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-cli-test-'));
process.env.JEXI_HOME = TMP_HOME;
process.env.JEXI_SERVER_DIR = path.resolve(CLI_DIR, '..', 'server');

const { loadConfig, saveConfig, defaultConfig, findServerDir, importServerModule } = await import('./lib/config.js');
const { JexiApi, NdjsonParser } = await import('./lib/api.js');
const { renderEvent } = await import('./lib/repl.js');
const { validPort } = await import('./lib/wizard.js');
const doctor = await import('./lib/doctor.js');

let passed = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${String(e.stack).split('\n').slice(0, 3).join('\n    ')}`);
    process.exitCode = 1;
  }
};

console.log('jexi cli:');

await ok('config: defaults + roundtrip in isolated HOME', () => {
  assert.strictEqual(loadConfig(TMP_HOME), null);
  const cfg = { ...defaultConfig(), port: 3210, unified: { provider: 'groq', apiKey: 'x', model: 'm', baseUrl: 'https://g/v1' } };
  assert.ok(saveConfig(cfg, TMP_HOME));
  const back = loadConfig(TMP_HOME);
  assert.strictEqual(back.port, 3210);
  assert.strictEqual(back.unified.provider, 'groq');
  const st = fs.statSync(path.join(TMP_HOME, 'config.json'));
  if (process.platform !== 'win32') assert.strictEqual(st.mode & 0o777, 0o600, 'config is 0600');
});

await ok('config: corrupt file yields null (never throws)', () => {
  fs.writeFileSync(path.join(TMP_HOME, 'config.json'), '{broken');
  assert.strictEqual(loadConfig(TMP_HOME), null);
});

await ok('config: server dir discovery', () => {
  const dir = findServerDir();
  assert.ok(dir && fs.existsSync(path.join(dir, 'index.js')), `found ${dir}`);
});

await ok('config: server module reuse (catalog)', async () => {
  const cat = await importServerModule(findServerDir(), 'src/services/providers/catalog.js');
  assert.ok(Array.isArray(cat.PROVIDERS) && cat.PROVIDERS.length >= 10);
});

await ok('api: headers carry session, no key (open backend)', async () => {
  let seen = null;
  const api = new JexiApi({
    baseUrl: 'http://x:1/', session: 's1',
    fetchImpl: async (url, init) => { seen = { url, init }; return { status: 200, ok: true, text: async () => '{"ok":true}' }; },
  });
  const r = await api.get('/api/health');
  assert.ok(r.ok && r.data.ok);
  assert.strictEqual(seen.url, 'http://x:1/api/health');
  assert.ok(!('x-jexi-key' in seen.init.headers));
  assert.strictEqual(seen.init.headers['x-jexi-session'], 's1');
});

await ok('api: ndjson parser survives split chunks + bad lines', () => {
  const evts = [];
  const p = new NdjsonParser((e) => evts.push(e));
  p.push('{"type":"stream","text":"Hel');
  p.push('lo"}\nnot-json\n{"type":"done","summary":"S"}\n{"type":"st');
  p.push('ream","text":"!"}\n');
  p.flush();
  assert.strictEqual(evts.length, 3);
  assert.strictEqual(evts[0].text, 'Hello');
  assert.strictEqual(p.terminal.type, 'done');
  assert.strictEqual(p.count, 3);
});

await ok('repl: renderer routes event types', () => {
  const out = [];
  const fakeStdout = { write: (s) => out.push(s) };
  const errLines = [];
  const origErr = process.stderr.write;
  process.stderr.write = (s) => { errLines.push(s); return true; };
  try {
    renderEvent({ type: 'stream', text: 'Hi' }, { stdout: fakeStdout });
    renderEvent({ type: 'log', agent: 'Coder', message: 'wrote x.js' });
    renderEvent({ type: 'think', text: 'hmm' });
    const ask = renderEvent({ type: 'ask.secret', conv: 'c', id: 'gk-1', tool: 'github', reason: 'to push' });
    assert.deepStrictEqual(ask.secretAsk, { conv: 'c', id: 'gk-1', tool: 'github', reason: 'to push' });
    const term = renderEvent({ type: 'done', summary: 'Done.', by: 'Jexi', firstTokenMs: 5 }, { stdout: fakeStdout });
    assert.ok(term.terminal && !term.failed);
    const fail = renderEvent({ type: 'error', error: 'boom' });
    assert.ok(fail.terminal && fail.failed);
  } finally {
    process.stderr.write = origErr;
  }
  assert.ok(out.join('').includes('Hi') && out.join('').includes('Done.'));
  assert.ok(errLines.join('').includes('Coder') && errLines.join('').includes('boom'));
});

await ok('wizard: port validation', () => {
  assert.ok(validPort('3210') && validPort(1024) && validPort(65535));
  assert.ok(!validPort('80') && !validPort('abc') && !validPort('99999'));
});

await ok('wizard: server validators load', async () => {
  const v = await importServerModule(findServerDir(), 'src/services/providers/modelConfig.js');
  const r = v.validateModelConfig({ provider: 'groq', apiKey: 'k', model: 'm' });
  assert.ok(r.ok && r.normalized.provider === 'groq');
});

await ok('doctor: node/server/deps/browser shapes', () => {
  assert.ok(doctor.checkNodeVersion('v20.1.0').ok);
  assert.ok(!doctor.checkNodeVersion('v18.0.0').ok);
  const dir = findServerDir();
  assert.ok(doctor.checkServerDir(dir).ok);
  assert.ok(!doctor.checkServerDir('/nope').ok);
  assert.strictEqual(typeof doctor.checkServerDeps(dir).ok, 'boolean');
  assert.strictEqual(typeof doctor.checkBrowser(dir).ok, 'boolean');
});

await ok('doctor: git + backend + model with fakes', async () => {
  const g1 = await doctor.checkGit({ execOk: async () => 'git version 2.4' });
  assert.ok(g1.ok);
  const g2 = await doctor.checkGit({ execOk: async () => null });
  assert.ok(!g2.ok);
  const fakeApi = {
    baseUrl: 'http://127.0.0.1:9',
    health: async () => ({ ok: true, data: { ok: true, name: 'B', version: '1', uptime: 3 } }),
    providersActive: async () => ({ ok: true, data: { active: { configured: true, provider: 'groq', model: 'm', source: 'env', hasKey: true, keyLast4: '…1' } } }),
  };
  assert.ok((await doctor.checkBackendHealth(fakeApi)).ok);
  assert.ok((await doctor.checkModel(fakeApi)).ok);
  const dead = { baseUrl: 'http://127.0.0.1:9', health: async () => { throw new Error('conn refused'); }, providersActive: async () => { throw new Error('x'); } };
  assert.ok(!(await doctor.checkBackendHealth(dead)).ok);
  assert.ok(!(await doctor.checkModel(dead)).ok);
});

// cleanup temp home
fs.rmSync(TMP_HOME, { recursive: true, force: true });

console.log(`\njexi cli: ${passed} checks passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
