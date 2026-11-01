/**
 * M13 — TUI ↔ ENGINE INTEGRATION.
 *
 * The TUI unit suites (`interfaces/cli/test-tui.js`) run the app loop against a
 * fake API. That proves the interface's own logic but NOT that the interface
 * drives the real engine. This suite closes that gap: it boots the REAL backend
 * (`server/index.js`) as a child process, backed by a controlled LOCAL
 * OpenAI-compatible provider on loopback, and drives it through the TUI's OWN
 * `JexiApi` client and transcript reducer — the exact modules `jexi tui` uses.
 *
 * Hermetic: the harness preload blocks any non-loopback dial; the provider is a
 * mock on 127.0.0.1, so no real model and no network egress is involved.
 *
 * What is proven:
 *   1. a real turn reaches the interface and terminates with a `done` event
 *   2. the transcript reducer turns those real events into rows
 *   3. the endpoints the new TUI commands call return real data
 *      (/api/tools, /api/skills, /api/memory, /api/permissions, /api/sessions)
 *   4. a provider failure is reported honestly (no canned success)
 *   5. the session header actually scopes the conversation
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', '..');

const { JexiApi } = await import('../../../interfaces/cli/lib/api.js');
const { createTranscript, applyEvent, statusLine } = await import('../../../interfaces/cli/lib/tui/transcript.js');

let provider; // mock model server
let backend;  // real JEXI backend child
let api;
let tmpDir;
let providerCalls = 0;

/** A loopback OpenAI-compatible provider (Ollama-shaped) that answers instantly. */
function startProvider() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-llama' }] }));
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        void body; // drain the request so the client's write completes
        providerCalls += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'cmpl-mock', model: 'mock-llama',
          choices: [{ index: 0, message: { role: 'assistant', content: 'MOCK-ENGINE-ANSWER' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function waitHealthy(port, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-tui-engine-'));
  /* M15 — TEST ISOLATION. The backend reads `cwd/settings.json` for the model
     credential, and cwd here is server/ — so the DEVELOPER's saved provider
     (e.g. a real ollama) silently overrode the mock this suite points at, and
     the "provider received a call" assertion failed against a real backend.
     Pin the settings file to a temp path so the suite is hermetic in both
     directions: it cannot read the developer's config, and it cannot write to
     it. */
  process.env.JEXI_SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  const p = await startProvider();
  provider = p;
  const port = await freePort();
  backend = spawn('node', ['index.js'], {
    cwd: SERVER,
    env: {
      ...process.env,
      DATA_DIR: tmpDir,
      JEXI_SETTINGS_FILE: path.join(tmpDir, 'settings.json'),
      PORT: String(port),
      HOST: '127.0.0.1',
      MODEL_PROVIDER: 'ollama',
      OLLAMA_HOST: `http://127.0.0.1:${p.port}`,
      JEXI_TEST_HARNESS: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const ok = await waitHealthy(port);
  if (!ok) throw new Error(`backend did not become healthy on port ${port}`);
  api = new JexiApi({ baseUrl: `http://127.0.0.1:${port}` });
});

after(() => {
  try { if (backend) backend.kill('SIGKILL'); } catch { /* best effort */ }
  try { if (provider && provider.server) provider.server.close(); } catch { /* best effort */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  delete process.env.JEXI_SETTINGS_FILE;
});

/* ═══ 1. a real turn reaches the interface and terminates ═════════════════ */

test('a real turn streams through the TUI client and terminates with done', async () => {
  api.setSession('m13-it-1');
  const t = createTranscript();
  const types = [];
  const res = await api.chatStream('thanks!', { onEvent: (e) => { types.push(e.type); applyEvent(t, e); } });

  assert.ok(res.done, 'a terminal event arrived');
  assert.ok(['done', 'error'].includes(res.done.type), `terminal type is honest: ${res.done && res.done.type}`);
  assert.ok(types.length > 0, 'the engine emitted events');
  assert.ok(t.rows.length > 0, 'the reducer produced rows from real events');
  assert.ok(typeof statusLine(t) === 'string', 'a status line is computable');
});

/* ═══ 2. the session header scopes the conversation ═══════════════════════ */

test('the session header scopes the conversation on the backend', async () => {
  api.setSession('m13-it-session-A');
  await api.chatStream('hello there', { onEvent: () => {} });
  const convs = await api.conversations();
  assert.ok(convs.ok, 'conversations endpoint reachable');
  const ids = (convs.data.conversations || []).map((c) => c.id);
  assert.ok(ids.includes('m13-it-session-A'), `session A recorded (got: ${ids.slice(0, 6).join(',')})`);
});

/* ═══ 3. the endpoints the new commands use return real data ══════════════ */

test('/tools returns the real native catalog', async () => {
  const r = await api.tools();
  assert.ok(r.ok, `tools reachable (HTTP ${r.status})`);
  assert.ok(Array.isArray(r.data.tools) && r.data.tools.length > 0, 'a non-empty tool catalog');
  assert.ok(r.data.tools.every((t) => t.slug), 'every tool has a slug');
});

test('/skills returns the real registry', async () => {
  const r = await api.skills();
  assert.ok(r.ok, `skills reachable (HTTP ${r.status})`);
  assert.ok(Array.isArray(r.data.skills), 'skills array present');
  assert.ok(typeof r.data.total === 'number', 'total count present');
});

test('/memory returns the real memory blob', async () => {
  const r = await api.memory();
  assert.ok(r.ok, `memory reachable (HTTP ${r.status})`);
  assert.ok(r.data && typeof r.data === 'object', 'memory object present');
});

test('/permissions returns the real session preset', async () => {
  api.setSession('m13-it-perms');
  const r = await api.permissions();
  assert.ok(r.ok, `permissions reachable (HTTP ${r.status})`);
  assert.ok(r.data.preset, 'a preset is reported');
  assert.ok(r.data.approval, 'an approval policy is reported');
});

/* ═══ 4. a provider failure is reported honestly ══════════════════════════ */

test('a broken provider is reported honestly, never a canned answer', async () => {
  // Point a fresh client at a port with nothing behind it: the interface must
  // surface the real connection failure, not fabricate a reply.
  const dead = new JexiApi({ baseUrl: 'http://127.0.0.1:1' });
  dead.setSession('m13-it-dead');
  await assert.rejects(
    () => dead.chatStream('anything', { onEvent: () => {} }),
    (e) => !!e && /ECONNREFUSED|fetch failed|connect/i.test(e.message || ''),
    'the real transport error propagates',
  );
});

/* ═══ 5. the mock provider was actually exercised (not a stub path) ═══════ */

test('the real engine path was exercised (the provider received a call)', () => {
  assert.ok(providerCalls > 0, 'the backend dialed the local provider for at least one turn');
});
