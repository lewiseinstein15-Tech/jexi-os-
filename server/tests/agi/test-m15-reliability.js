/**
 * M15 — Reliable tool execution and evidence-grounded completion.
 *
 * Guards the two reliability weaknesses M14 found, plus the test-isolation
 * defect that came with them:
 *
 *   F1 — the model writes the tool call it MEANT as prose
 *        (`{"name":"fs_write","parameters":{…}}`) instead of a native
 *        `tool_calls` array, so the round looks like a direct answer and the
 *        task ends with zero tool calls. `recoverToolCallsFromText` recovers
 *        it, narrowly: only a tool already in the menu, only a real argument
 *        object, and the dominant unescaped-quote shape must still parse.
 *
 *   F2 — the turn reports success with no evidence the outcome occurred. The
 *        success gate now refuses a claim when every tool call failed, when a
 *        failure was never successfully retried, or when a coding task
 *        produced no evidence at all.
 *
 *   F3 — a tool whose runtime ring the active sandbox refuses is still
 *        OFFERED (M12: the menu must not withhold what a request named), but
 *        the description now says it will be refused, so the model does not
 *        waste a call discovering it.
 *
 * Determinism: no model, no network — every assertion runs the real module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync as execFileSyncSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { recoverToolCallsFromText, looksLikeToolAttempt } from '../../src/services/agent/ToolCallRecovery.js';
import { CodingLoop } from '../../src/services/agent/CodingLoop.js';
import { registerAllDomains } from '../../src/tools/domains/index.js';
import { domainExecutor } from '../../src/tools/domains/executor.js';
import { buildNativeSchemas, resolveToolDef, toolRunnable } from '../../src/services/ToolRuntime.js';
import { detectSandboxBackends, SessionSandbox, sessionSandbox, _resetSessionSandbox } from '../../src/services/Sandbox.js';

registerAllDomains();
domainExecutor(); // publishes the domain probe resolveToolDef/buildNativeSchemas read

const MENU = ['fs_read', 'fs_write', 'fs_edit', 'term_execute', 'pytest_run', 'request_tools'];

/* ── F1: prose tool-call recovery ───────────────────────────────────────── */

test('M15/F1: a native-shaped prose call is recovered', () => {
  const text = 'I will write the file.\n{"name":"fs_write","parameters":{"path":"hello.py","content":"print(1)"}}';
  const calls = recoverToolCallsFromText(text, MENU);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'fs_write');
  assert.equal(calls[0].arguments.path, 'hello.py');
});

test('M15/F1: the dominant unescaped-quote shape still parses', () => {
  // This was the EXACT failing round: the code being written contains raw
  // quotes, so JSON.parse rejects the object. Recovery must repair it.
  const text = '{"name":"fs_write","parameters":{"path":"hello.py","content":"print("hello world")"}}';
  const calls = recoverToolCallsFromText(text, MENU);
  assert.equal(calls.length, 1, 'the unescaped-quote call must be recovered');
  assert.equal(calls[0].name, 'fs_write');
  assert.match(String(calls[0].arguments.content), /hello world/);
});

test('M15/F1: an OpenAI-shaped prose call is recovered too', () => {
  const text = '{"function":{"name":"pytest_run","arguments":"{\\"path\\":\\".\\"}"}}';
  const calls = recoverToolCallsFromText(text, MENU);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'pytest_run');
  assert.equal(calls[0].arguments.path, '.');
});

test('M15/F1: a call inside a fenced block is recovered', () => {
  const text = 'Sure:\n```json\n{"name":"fs_read","parameters":{"path":"calc.py"}}\n```';
  const calls = recoverToolCallsFromText(text, MENU);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'fs_read');
});

test('M15/F1: an INVENTED tool is never recovered (recovery cannot expand the menu)', () => {
  const calls = recoverToolCallsFromText('{"name":"code_write","parameters":{"content":"x"}}', MENU);
  assert.equal(calls.length, 0, 'a tool not in the offered menu must be refused');
});

test('M15/F1: a call with no argument object is not a call', () => {
  assert.equal(recoverToolCallsFromText('{"name":"fs_write"}', MENU).length, 0);
  assert.equal(recoverToolCallsFromText('{"name":"fs_write","parameters":[]}', MENU).length, 0);
});

test('M15/F1: plain prose is not mistaken for a call', () => {
  assert.equal(recoverToolCallsFromText('I have fixed the bug and the tests pass.', MENU).length, 0);
  assert.equal(looksLikeToolAttempt('I have fixed the bug.'), false);
  assert.equal(looksLikeToolAttempt('{"name":"fs_write"}'), true);
});

test('M15/F1: an empty menu recovers nothing (no tools were disclosed)', () => {
  assert.equal(recoverToolCallsFromText('{"name":"fs_write","parameters":{}}', []).length, 0);
});

test('M15/F1: duplicate calls in one message are de-duplicated', () => {
  const text = '{"name":"fs_read","parameters":{"path":"a.py"}}\n{"name":"fs_read","parameters":{"path":"a.py"}}';
  assert.equal(recoverToolCallsFromText(text, MENU).length, 1);
});

/* ── F2: evidence-grounded completion ───────────────────────────────────── */

const gateOf = (loop) => loop.successGate();

test('M15/F2: a turn whose every tool call failed cannot claim success', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('fs_read', false, { error: 'ENOENT: no such file' });
  const gate = gateOf(loop);
  assert.equal(gate.status, 'unverified');
  assert.equal(gate.canClaimSuccess, false);
  assert.match(gate.annotation, /Every tool call in this turn failed/);
  assert.match(gate.annotation, /ENOENT/);
});

test('M15/F2: a failure never retried successfully blocks the claim, even with other successes', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('fs_read', false, { error: 'path escapes root' });
  loop.noteToolCall('mem_store', true); // an unrelated success must not launder the failure
  const gate = gateOf(loop);
  assert.equal(gate.status, 'unverified');
  assert.equal(gate.canClaimSuccess, false);
  assert.match(gate.annotation, /not successfully retried/);
});

test('M15/F2: a failure later retried successfully is resolved', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('fs_read', false, { error: 'ENOENT (probe)' });
  loop.noteToolCall('fs_read', true); // the real read succeeds
  const gate = gateOf(loop);
  assert.equal(gate.canClaimSuccess, true);
  assert.equal(gate.status, 'not_applicable');
});

test('M15/F2: a coding task with no evidence at all cannot claim success', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.evidenceRequired = true;
  const gate = gateOf(loop);
  assert.equal(gate.status, 'unverified');
  assert.equal(gate.canClaimSuccess, false);
  assert.match(gate.annotation, /required real tool evidence/);
});

test('M15/F2: a plain answer with no tool use is still allowed (asking is not completing)', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  const gate = gateOf(loop);
  assert.equal(gate.status, 'not_applicable');
  assert.equal(gate.canClaimSuccess, true);
});

test('M15/F2: an edit with a real green verify is a verified success (no regression)', async () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [{ layer: 'unit', status: 'pass' }] }) });
  loop.noteToolCall('fs_write', true);
  await loop.verify('fs_write');
  const gate = gateOf(loop);
  assert.equal(gate.status, 'verified');
  assert.equal(gate.canClaimSuccess, true);
});

/* ── F3: honest disclosure of a tool the ring will refuse ───────────────── */

test('M15/F3: an unrunnable tool is still OFFERED (never withheld) but says so', () => {
  const caps = detectSandboxBackends();
  const liveRing = (caps.docker.available || caps.namespaces) ? 1 : 2;
  // Pick a real domain tool that declares a ring above what the session
  // enforces; if the environment enforces the host ring there is nothing to
  // assert (every tool is runnable) — skip honestly.
  const blocked = ['git_status', 'data_json', 'web_search', 'gh_issue_list']
    .map((s) => resolveToolDef(s))
    .find((d) => d && Number.isFinite(d.runtimeRing) && d.runtimeRing > liveRing);
  if (!blocked) return; // host ring: no ring-blocked tool exists to assert on

  assert.equal(toolRunnable(blocked.slug), false, `${blocked.slug} is ring-blocked here`);
  const [schema] = buildNativeSchemas([blocked]);
  assert.ok(schema, 'the tool must still be offered — the menu is not narrowed by the ring');
  assert.equal(schema.function.name, blocked.slug);
  assert.match(schema.function.description, /NOT RUNNABLE/i, 'the description must disclose the refusal');
});

test('M15/F3: a runnable tool carries NO disclosure note', () => {
  const def = resolveToolDef('fs_write');
  assert.ok(def, 'fs_write is registered');
  assert.equal(toolRunnable('fs_write'), true, 'fs_write runs inside the workspace ring');
  const [schema] = buildNativeSchemas([def]);
  assert.doesNotMatch(schema.function.description, /NOT RUNNABLE/i);
});

test('M15/F3: disclosure never changes the tool name or its parameters', () => {
  const def = resolveToolDef('fs_write');
  const [schema] = buildNativeSchemas([def]);
  assert.equal(schema.function.name, 'fs_write');
  assert.ok(schema.function.parameters.properties.path, 'the real schema must survive');
});

/* ── F2 (execution): the container can actually write the workspace ─────── */

test('M15/F2: the docker sandbox runs as the HOST user, so the rw bind is usable', () => {
  const user = SessionSandbox.sandboxUser();
  if (Number.isInteger(process.getuid?.())) {
    assert.equal(user, `${process.getuid()}:${process.getgid()}`,
      'a fixed container uid only has permission when the host user happens to be 1000');
  }
  const spec = SessionSandbox.dockerSpec('/tmp/ws', ['python3', 'hello.py']);
  const i = spec.args.indexOf('--user');
  assert.ok(i >= 0, 'the spec must pin a user');
  assert.equal(spec.args[i + 1], user, 'the spec must use the host-mapped user');
});

test('M15/F2: JEXI_SANDBOX_UID overrides the sandbox user', () => {
  const prev = process.env.JEXI_SANDBOX_UID;
  process.env.JEXI_SANDBOX_UID = '4321:8765';
  try {
    assert.equal(SessionSandbox.sandboxUser(), '4321:8765');
    process.env.JEXI_SANDBOX_UID = '4321';
    assert.equal(SessionSandbox.sandboxUser(), '4321:4321', 'a bare uid maps gid to the same value');
    process.env.JEXI_SANDBOX_UID = 'not-a-uid';
    assert.notEqual(SessionSandbox.sandboxUser(), 'not-a-uid', 'garbage must fall back, never be passed through');
  } finally {
    if (prev === undefined) delete process.env.JEXI_SANDBOX_UID; else process.env.JEXI_SANDBOX_UID = prev;
  }
});

test('M15/F2: term_execute is offered AND runnable (the tool the model needs to run code)', () => {
  const def = resolveToolDef('term_execute');
  assert.ok(def, 'term_execute must be registered');
  assert.equal(def.runtimeRing, 1, 'it runs inside SessionSandbox, like pytest_run');
  assert.equal(toolRunnable('term_execute'), true, 'a coding turn must be able to run a command');
  const [schema] = buildNativeSchemas([def]);
  assert.ok(schema, 'and it must reach the menu');
  assert.doesNotMatch(schema.function.description, /NOT RUNNABLE/i);
});

test('M15/F2: a real session sandbox can WRITE then RUN (the failure the model hit)', async (t) => {
  const caps = detectSandboxBackends();
  if (!caps.docker?.available) return t.skip('no docker runtime — the container half cannot be exercised here');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'm15-wr-'));
  try {
    fs.writeFileSync(path.join(ws, 'hello.py'), 'print("WRITE-RUN-OK")\n');
    const sbx = sessionSandbox({ root: ws });
    assert.equal(sbx.backend, 'docker');
    const r = await sbx.run(['python3', 'hello.py']);
    assert.equal(r.ok, true, `write-then-run must succeed, got ${JSON.stringify({ code: r.code, stderr: r.stderr })}`);
    assert.match(String(r.stdout), /WRITE-RUN-OK/);
    // A file the container creates must land on the host owned by the host
    // user — that is what makes the read-write bind usable in both directions.
    const w = await sbx.run(['sh', '-c', 'echo GEN > gen.txt']);
    assert.equal(w.ok, true);
    const hostFile = path.join(ws, 'gen.txt');
    assert.ok(fs.existsSync(hostFile), 'the container write must be visible on the host');
    if (Number.isInteger(process.getuid?.())) assert.equal(fs.statSync(hostFile).uid, process.getuid());
    sbx.dispose();
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    _resetSessionSandbox();
  }
});

test('M15/F2: backend detection reports a namespace only when unshare ACTUALLY works', () => {
  const caps = detectSandboxBackends();
  if (!caps.namespaces) {
    // The binary may be installed while the kernel refuses the namespace; that
    // must be reported as unavailable, not claimed.
    assert.ok(caps.namespacesReason, 'an unavailable namespace backend must explain why');
    assert.equal(caps.unshare, null, 'no unshare path when the capability is absent');
  } else {
    assert.equal(typeof caps.unshare, 'string');
    // And when it IS claimed, a trivial command must really run.
    const r = execFileSyncSync(caps.unshare, ['--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--', '/bin/sh', '-c', 'echo NS_OK']);
    assert.match(String(r), /NS_OK/);
  }
});

/* ── F1 (end-to-end): prose recovery through the REAL provider loop ─────── */

test('M15/F1: a prose call is recovered, EXECUTED, and fed back through the real loop', async () => {
  const http = await import('node:http');
  const { generateWithToolsLoop } = await import('../../src/providers/runtime/LLMClient.js');
  const ROUNDS = [
    { content: 'I will write the file.\n{"name":"fs_write","parameters":{"path":"hello.py","content":"print(42)"}}' },
    { content: 'DONE: wrote hello.py' },
  ];
  let call = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        const r = ROUNDS[Math.min(call++, ROUNDS.length - 1)];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'c', model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: r.content }, finish_reason: 'stop' }] }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const prevHost = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${srv.address().port}`;
  const executed = [];
  const recoveredSeen = [];
  try {
    const tools = [{ type: 'function', function: { name: 'fs_write', description: 'write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }];
    const res = await generateWithToolsLoop('write hello.py', 'you are jexi', tools, {
      provider: 'ollama', model: 'mock',
      executeToolCalls: async (calls) => { executed.push(...calls.map((c) => c.name)); return calls.map((c) => ({ tool_call_id: c.id, content: 'OK' })); },
      onRecoveredToolCalls: (c) => recoveredSeen.push(...c.map((x) => x.name)),
    });
    assert.deepEqual(executed, ['fs_write'], 'the recovered call must actually run through the gated executor');
    assert.deepEqual(recoveredSeen, ['fs_write'], 'and the recovery must be observable, not silent');
    assert.match(res.text, /DONE/, 'the loop must continue to the direct answer after the tool round');
    assert.deepEqual(res.toolCalls.map((c) => c.name), ['fs_write']);
  } finally {
    srv.close();
    if (prevHost === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = prevHost;
  }
});

/* ── F4: settings.json test isolation (both directions) ─────────────────── */

test('M15/F4: JEXI_SETTINGS_FILE pins the settings path so a test cannot read the dev config', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm15-set-'));
  const real = path.join(process.cwd(), 'settings.json');
  const hadReal = fs.existsSync(real);
  const saved = hadReal ? fs.readFileSync(real, 'utf8') : null;
  fs.writeFileSync(real, JSON.stringify({ developer: 'REAL-CONFIG-MUST-NOT-LEAK' }));
  process.env.JEXI_SETTINGS_FILE = path.join(tmp, 'settings.json');
  try {
    const { loadSettings, saveSettings } = await import('../../src/services/SettingsManager.js');
    assert.ok(!JSON.stringify(loadSettings()).includes('REAL-CONFIG-MUST-NOT-LEAK'),
      'the test must not read the developer config');
    saveSettings({ provider: 'test-wrote-here' });
    assert.ok(fs.existsSync(path.join(tmp, 'settings.json')), 'the write must land in the pinned file');
    assert.ok(fs.readFileSync(real, 'utf8').includes('REAL-CONFIG-MUST-NOT-LEAK'),
      'and the developer config must be untouched (the test must not clobber it)');
  } finally {
    delete process.env.JEXI_SETTINGS_FILE;
    if (saved !== null) fs.writeFileSync(real, saved); else fs.rmSync(real, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('M15/F4: absent the override the settings path is still cwd/settings.json', async () => {
  const { settingsFile } = await import('../../src/services/SettingsManager.js');
  const prev = process.env.JEXI_SETTINGS_FILE;
  delete process.env.JEXI_SETTINGS_FILE;
  try {
    assert.equal(settingsFile(), path.join(process.cwd(), 'settings.json'), 'the default must be unchanged');
  } finally {
    if (prev !== undefined) process.env.JEXI_SETTINGS_FILE = prev;
  }
});
