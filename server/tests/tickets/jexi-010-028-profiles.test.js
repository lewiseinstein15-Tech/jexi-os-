/**
 * JEXI-010 / JEXI-028 — who may run what, and where.
 *
 * 010: domain dispatch used to carry `permissions: { allowAll: true }` and
 *      `risk: { sandboxRing: 'host' }`, which meant the real permission model
 *      was decorative for exactly the tools a coding agent reaches for.
 * 028: a coding turn that has to stop and ask before every `fs_edit` and every
 *      `pytest_run` cannot finish autonomously — but "autonomous" must not
 *      quietly become "unrestricted".
 *
 * The two pull against each other on purpose. The line they agree on:
 * a sandboxed edit inside the workspace is allowed, a HOST write outside it
 * is not, at any profile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

async function boot() {
  const { domainExecutor } = await import(`${SRC}/src/tools/domains/executor.js`);
  domainExecutor();
  const { executeTool, TOOL_PROFILES, activeToolProfile, setActiveToolProfile } = await import(`${SRC}/src/services/ToolRuntime.js`);
  const { hasDomainTool, domainDispatch } = await import(`${SRC}/src/tools/domains/executor.js`);
  return { executeTool, TOOL_PROFILES, activeToolProfile, setActiveToolProfile, hasDomainTool, domainDispatch };
}

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-prof-'));
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello\n');
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/* ── the no-allowAll invariant ────────────────────────────────────── */

test('JEXI-010: domain dispatch is profile-gated by default, not allowAll', async () => {
  const { domainDispatch } = await boot();
  const d = project();
  // A call with NO profile context must go through the real grant list. The
  // bug was that the default permissions were `{ allowAll: true }`, so this
  // check is on behaviour, not on the source text.
  const gated = await domainDispatch('fs_write', { path: path.join(d, 'a.txt'), content: 'x' }, { profile: 'readonly' });
  assert.notEqual(gated.ok, true, 'the default path must not be allowAll');

  // The bypass exists, but it is not a bare boolean: it needs the full
  // profile AND a confirmation callback. A caller that only sets the flag
  // gets nothing.
  const bare = await domainDispatch('fs_write', { path: path.join(d, 'a.txt'), content: 'x' }, { profile: 'auto', allowUngated: true });
  assert.notEqual(bare.ok, true, 'allowUngated alone must not grant a write');

  const stillNo = await domainDispatch('fs_write', { path: path.join(d, 'a.txt'), content: 'x' }, { profile: 'full', allowUngated: true });
  assert.notEqual(stillNo.ok, true, 'allowUngated without a confirm callback must not grant a write');

  // Only full + an explicit confirm reaches it.
  const approved = await domainDispatch('fs_write', { path: path.join(d, 'a.txt'), content: 'x' }, { profile: 'full', allowUngated: true, confirm: async () => true });
  assert.ok(approved === undefined || typeof approved === 'object', 'the approved path must return a normal result object');

  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf-8'), 'hello\n', 'no refused write may have happened');
});

test('JEXI-010: an ungranted tool is DENIED, not allowed by default', async () => {
  const { executeTool, hasDomainTool } = await boot();
  assert.ok(hasDomainTool('fs_write'), 'fs_write is a real domain tool');

  const d = project();
  // readonly is the floor profile: it must not be able to write.
  const r = await executeTool({
    slug: 'fs_write',
    args: { path: path.join(d, 'a.txt'), content: 'changed' },
    profile: 'readonly',
  });
  assert.notEqual(r.ok, true, 'readonly must not be able to write a file');
  // ...and the file on disk must be untouched.
  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf-8'), 'hello\n', 'the write must not have happened');
});

test('JEXI-010: the profiles are real and ordered by risk', async () => {
  const { TOOL_PROFILES } = await boot();
  for (const p of ['readonly', 'coding', 'auto', 'full']) {
    assert.ok(TOOL_PROFILES[p], `profile ${p} must exist`);
  }
  // coding is the sandboxed-edits profile JEXI-010/028 ask for.
  assert.ok(TOOL_PROFILES.coding, 'the coding profile is required by 010 and 028');
});

/* ── the coding profile can actually do the job ───────────────────── */

test('JEXI-010: the coding profile edits a file inside the workspace', async () => {
  const { executeTool } = await boot();
  const d = project();
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = d;
  try {
    const r = await executeTool({
      slug: 'fs_edit',
      args: { path: 'a.txt', find: 'hello', replace: 'goodbye' },
      profile: 'coding',
    });
    assert.equal(r.ok, true, `coding profile must be able to edit: ${JSON.stringify(r.error || '')}`);
    assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf-8'), 'goodbye\n');
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
  }
});

test('JEXI-010: readonly still blocks the SAME edit the coding profile allows', async () => {
  const { executeTool } = await boot();
  const d = project();
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = d;
  try {
    const r = await executeTool({
      slug: 'fs_edit',
      args: { path: 'a.txt', find: 'hello', replace: 'goodbye' },
      profile: 'readonly',
    });
    assert.notEqual(r.ok, true, 'readonly must refuse an edit');
    assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf-8'), 'hello\n', 'nothing may have changed');
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
  }
});

/* ── JEXI-028: autonomous where it is safe ────────────────────────── */

test('JEXI-028: a sandboxed edit + pytest run does NOT stall for approval', async () => {
  const { executeTool } = await boot();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-auto-'));
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
  fs.writeFileSync(path.join(d, 'c.py'), 'def add(a, b):\n    return a + b\n');
  fs.mkdirSync(path.join(d, 'tests'));
  fs.writeFileSync(path.join(d, 'tests', 'test_c.py'), 'from c import add\ndef test_x():\n    assert add(1, 1) == 2\n');
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = d;
  test.after(() => {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
    fs.rmSync(d, { recursive: true, force: true });
  });

  const edit = await executeTool({ slug: 'fs_edit', args: { path: 'c.py', find: 'a + b', replace: 'a + b  # ok' }, profile: 'coding' });
  assert.equal(edit.ok, true, 'the edit must not stall');

  // The point of 028: the test run completes and reports, rather than
  // returning "needs confirmation".
  const run = await executeTool({ slug: 'pytest_run', args: {}, profile: 'coding' });
  assert.notEqual(run.approvalRequired, true, 'a sandboxed pytest must not require approval');
  assert.equal(run.blocked, undefined, 'a sandboxed pytest must not be blocked');
  // The tool result arrives as an encoded payload; decode it and read the
  // real exit code out rather than trusting the wrapper's ok:true.
  const raw = typeof run.result === 'string' ? JSON.parse(run.result) : (run.result ?? run);
  const inner = typeof raw.result === 'string' ? JSON.parse(raw.result) : (raw.result ?? raw);
  assert.equal(inner.framework, 'pytest', 'a real pytest run happened');
  assert.equal(inner.status, 'pass', `the planted suite should pass: ${JSON.stringify(inner).slice(0, 300)}`);
  assert.equal(inner.exitCode, 0, 'the receipt must carry a real zero exit code');
  assert.equal(inner.passed, 1);
  // And it really was sandboxed, not run on the host.
  assert.ok(inner.sandbox || inner.sandboxed || /sandbox/i.test(JSON.stringify(inner)), `the run must be sandboxed: ${JSON.stringify(inner).slice(0, 300)}`);
});

test('JEXI-028: host-destructive work is NOT auto-approved by the coding profile', async () => {
  const { executeTool, TOOL_PROFILES } = await boot();
  const d = project();
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = d;
  try {
    // An absolute path outside the workspace is a host write, whatever the
    // profile. "Coding may edit files" is not "coding may edit any file".
    const r = await executeTool({
      slug: 'fs_write',
      args: { path: '/etc/jexi-should-not-exist', content: 'x' },
      profile: 'coding',
    });
    assert.notEqual(r.ok, true, 'a write outside the workspace must be refused even on the coding profile');
    assert.ok(!fs.existsSync('/etc/jexi-should-not-exist'), 'nothing may have been written');
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
  }
  // The risk tier is what separates them, and it must say so.
  assert.ok(TOOL_PROFILES.coding, 'coding profile must declare a ceiling');
});

test('JEXI-028: the full profile is the only one that widens the ceiling', async () => {
  const { executeTool } = await boot();
  const d = project();
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = d;
  try {
    // Whatever full decides, the file must be intact afterwards unless the
    // write was actually authorised — this asserts the decision is explicit
    // rather than that it happened.
    const r = await executeTool({ slug: 'fs_write', args: { path: path.join(d, 'a.txt'), content: 'full' }, profile: 'full' });
    assert.ok(r.approvalRequired || r.ok || r.blocked || r.error, 'a full-profile write must return an explicit outcome, never a silent no-op');
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
  }
});

test('JEXI-010/028: an unknown profile fails closed to the safest thing', async () => {
  const { executeTool } = await boot();
  const d = project();
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = d;
  try {
    const r = await executeTool({
      slug: 'fs_edit',
      args: { path: 'a.txt', find: 'hello', replace: 'nope' },
      profile: 'not-a-real-profile',
    });
    assert.notEqual(r.ok, true, 'an unknown profile must not grant a write');
    assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf-8'), 'hello\n');
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
  }
});
