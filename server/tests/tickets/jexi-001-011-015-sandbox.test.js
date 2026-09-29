/**
 * JEXI-001 (real execution sandbox) · JEXI-011 (description matches reality)
 * · JEXI-015 (argv-only, no blanket `bash -lc`).
 *
 * These run REAL commands through the REAL sandbox on this host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SessionSandbox, detectSandboxBackends } from '../../src/services/Sandbox.js';
import { registerTerminalTools } from '../../src/tools/domains/terminal/index.js';
import { getTool } from '../../src/tools/registry/ToolRegistry.js';

const caps = detectSandboxBackends();
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ws-'));
fs.writeFileSync(path.join(ws, 'existing.txt'), 'I live in the workspace\n');
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-host-'));
fs.writeFileSync(path.join(outside, 'host-only.txt'), 'HOST SECRET\n');

// Registered once at file scope so the definition lookup does not depend on
// test execution order.
const { engines } = registerTerminalTools({ useSandbox: true });
const { engines: hostEngines } = registerTerminalTools({ useSandbox: false });

test.after(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

/* ── JEXI-001: backend selection and honest reporting ─────────── */

test('JEXI-001: backend is selected from what the host actually provides', () => {
  const sbx = new SessionSandbox({ root: ws, owner: 'probe' });
  if (caps.docker.available) assert.equal(sbx.backend, 'docker');
  else if (caps.namespaces) assert.equal(sbx.backend, 'namespace');
  else assert.equal(sbx.backend, 'cwd');
  assert.equal(sbx.degraded, sbx.backend !== 'docker', 'only a container is non-degraded');
});

test('JEXI-001: an explicit docker request FAILS LOUD when docker is absent (no silent downgrade)', () => {
  if (caps.docker.available) return; // nothing to prove on a docker host
  assert.throws(() => new SessionSandbox({ root: ws, backend: 'docker' }), /docker requested but unavailable/);
});

test('JEXI-001: describe() states guarantees and never overclaims', () => {
  const sbx = new SessionSandbox({ root: ws });
  const d = sbx.describe();
  assert.ok(['container', 'linux-namespaces + chroot', 'none'].includes(d.isolation));
  assert.equal(d.backend, sbx.backend);
  if (d.backend === 'namespace') {
    assert.match(d.honest, /NOT a container/);
    assert.ok(d.guarantees.some((g) => /network namespace/.test(g)));
  }
  if (d.backend === 'cwd') {
    assert.match(d.honest, /No isolation primitive/);
    assert.equal(d.isolation, 'none');
  }
});

/* ── JEXI-001: the containment itself (integration) ───────────── */

test('JEXI-001: a command CAN read and write inside the workspace', async () => {
  const sbx = new SessionSandbox({ root: ws, owner: 'rw' });
  const read = await sbx.run(['cat', 'existing.txt']);
  assert.equal(read.ok, true, 'the workspace must be visible: ' + read.stderr);
  assert.match(read.stdout, /workspace/);

  const write = await sbx.run(['sh', '-c', 'echo "made by the agent" > agent-made.txt']);
  assert.equal(write.ok, true, write.stderr);
  assert.equal(fs.readFileSync(path.join(ws, 'agent-made.txt'), 'utf8').trim(), 'made by the agent');
  sbx.dispose();
});

test('JEXI-001: PATH ESCAPE IS REFUSED — the host filesystem is not reachable', async () => {
  const sbx = new SessionSandbox({ root: ws, owner: 'escape' });
  const target = path.join(outside, 'host-only.txt');

  // every one of these reaches OUTSIDE the workspace
  for (const attempt of [
    ['cat', target],
    ['cat', '../../jexi-host-' + path.basename(outside).replace('jexi-host-', '') + '/host-only.txt'],
    ['sh', '-c', `cat ${target}`],
  ]) {
    const r = await sbx.run(attempt);
    assert.equal(r.ok === false || !/HOST SECRET/.test(r.stdout || ''), true,
      `escape must not succeed: ${JSON.stringify(attempt)} -> ${r.stdout}`);
    assert.ok(!/HOST SECRET/.test(r.stdout || ''), 'host file contents must never appear: ' + r.stdout);
  }
  sbx.dispose();
});

test('JEXI-001: a write attempt outside the workspace does not land on the host', async () => {
  const sbx = new SessionSandbox({ root: ws, owner: 'escape-write' });
  const victim = path.join(outside, 'pwned-by-agent.txt');

  await sbx.run(['sh', '-c', `echo PWNED > ${victim}`]);
  assert.equal(fs.existsSync(victim), false, 'the write must NOT have reached the host filesystem');
  sbx.dispose();
});

test('JEXI-001: a chrooted backend cannot even SEE outside the workspace', async function () {
  if (!caps.namespaces) return this.skip?.();
  const sbx = new SessionSandbox({ root: ws, backend: 'namespace', owner: 'chroot' });
  // The staging dir has its own bin/lib/etc mount points, so the meaningful
  // check is whether HOST content is reachable through them.
  const r = await sbx.run(['sh', '-c', 'cat /etc/passwd 2>/dev/null | head -1; echo "---"; ls /']);
  assert.ok(!/root:x:0:0/.test(r.stdout || ''), 'the host /etc/passwd must not be readable: ' + r.stdout);
  assert.ok(/workspace/.test(r.stdout || ''), 'the workspace should be visible: ' + r.stdout);
  sbx.dispose();
});

test('JEXI-001: the network is cut (namespace backend)', async function () {
  if (!caps.namespaces) return this.skip?.();
  const sbx = new SessionSandbox({ root: ws, backend: 'namespace', owner: 'net' });
  const r = await sbx.run(['sh', '-c', 'getent hosts github.com || echo NO_DNS']);
  assert.match(r.stdout || '', /NO_DNS|NO_DNS|no such host/i, 'a sandboxed command must not resolve external hosts');
  sbx.dispose();
});

test('JEXI-001: the host environment is NOT inherited (no API keys in the sandbox)', async () => {
  process.env.JEXI_FAKE_SECRET = 'sk-should-never-appear';
  const sbx = new SessionSandbox({ root: ws, backend: caps.namespaces ? 'namespace' : 'cwd', owner: 'env' });
  const r = await sbx.run(['sh', '-c', 'echo "secret=[${JEXI_FAKE_SECRET:-unset}] home=$HOME"']);
  assert.ok(!/sk-should-never-appear/.test(r.stdout || ''), 'a host secret leaked into the sandbox: ' + r.stdout);
  assert.match(r.stdout || '', /secret=\[unset\]|secret=\[\]/);
  delete process.env.JEXI_FAKE_SECRET;
  sbx.dispose();
});

/* ── JEXI-001: the docker spec, even though it cannot run here ── */

test('JEXI-001: the docker backend is built with no network, no host binds, no socket, capped', () => {
  const spec = SessionSandbox.dockerSpec(ws, ['pytest', '-q']);
  const a = spec.args;
  assert.ok(a.includes('--network=none'), 'network must be none');
  assert.ok(a.includes('--cap-drop=ALL'));
  assert.ok(a.includes('--security-opt=no-new-privileges'));
  assert.ok(a.includes('--read-only'));
  assert.ok(a.includes('--pids-limit=256'));
  assert.ok(a.some((x) => /^--memory=/.test(x)));
  assert.ok(a.some((x) => /^--cpus=/.test(x)));
  assert.ok(a.includes('--tmpfs'), 'a writable /tmp must be provided explicitly');
  // exactly ONE host path crosses in: the workspace itself
  const binds = a.filter((x, i) => a[i - 1] === '-v' || a[i - 1] === '--volume');
  assert.equal(binds.length, 1, `exactly one bind expected, got ${JSON.stringify(binds)}`);
  assert.ok(binds[0].startsWith(ws));
  assert.ok(binds[0].endsWith('/workspace:rw'));
  assert.ok(!JSON.stringify(a).includes('/var/run/docker.sock'), 'the docker socket must never be mounted');
  assert.deepEqual(a.slice(-2), ['pytest', '-q'], 'the payload argv must come last');
});

/* ── JEXI-011 + JEXI-015 through the tool ──────────────────────── */

test('JEXI-011: the tool description no longer claims unconditional "in the sandbox"', () => {
  const def = getTool('term_execute');
  assert.ok(def, 'term_execute must be registered');
  assert.ok(!/in the sandbox and return/.test(def.description), 'the unconditional claim must be gone');
  assert.match(def.description, /session sandbox/);
  assert.match(def.description, /degraded/, 'it must admit the runtime can be degraded');
});

test('JEXI-015: a simple command runs argv-only, with no shell', async () => {
  const r = await engines.term_execute({ command: 'echo hello world' }, { root: ws });
  assert.deepEqual(r.argv, ['echo', 'hello', 'world'], 'must be split into argv, not bash -lc');
  assert.ok(!r.argv.includes('-lc'));
  assert.equal(r.stdout.trim(), 'hello world');
});

test('JEXI-015: shell form is opt-in via shell:true', async () => {
  const r = await hostEngines.term_execute({ command: 'echo a && echo b', shell: true }, { root: ws });
  assert.ok(r.argv.includes('-lc'), 'explicit shell:true is allowed');
  assert.equal(r.sandbox.degraded, true, 'the host opt-out path must still declare itself degraded');
});

test('JEXI-015: an explicit argv array bypasses parsing entirely', async () => {
  const r = await hostEngines.term_execute({ argv: ['echo', 'quoted arg with spaces'] }, { root: ws });
  assert.equal(r.stdout.trim(), 'quoted arg with spaces');
});

test('JEXI-001 + JEXI-011: the tool result records the real backend, degraded flag included', async () => {
  const r = await engines.term_execute({ argv: ['cat', 'existing.txt'] }, { root: ws });
  assert.equal(r.ok, true, r.stderr);
  assert.match(r.stdout, /workspace/);
  assert.ok(r.sandbox, 'every terminal receipt must carry the sandbox description');
  assert.ok(['docker', 'namespace', 'cwd'].includes(r.sandbox.backend));
  assert.equal(typeof r.sandbox.degraded, 'boolean');
  assert.ok(r.sandbox.isolation, 'the isolation level must be reported, not assumed');
});
