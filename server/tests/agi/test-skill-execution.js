/**
 * AGI Scope C — SKILLS executor contracts.
 *
 *   executable:  SKILL.md `## Steps` block parses into real-tool steps
 *   executor:    executeSkill runs each step through a dispatcher and
 *                returns a structured result (not a wall of prompt text)
 *   trigger:     findSkillFor maps a query to the best EXECUTABLE skill
 *                from catalog metadata WITHOUT loading the body
 *   failure:     a tool-level failure aborts with the failing step named
 *                (a test that FAILS is evidence, not an executor crash)
 *
 * Uses a temp store (JEXI_SKILLS_STORE) so the repo store is untouched.
 * Keyless, deterministic, no model calls — the default dispatcher is
 * overridden with a deterministic fake so no real subprocess/registry is
 * needed inside the node:test harness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-skill-exec-'));
process.env.JEXI_SKILLS_STORE = STORE;

const { catalog, parseSteps } = await import('../../src/skills/catalog.js');
const { readSkill } = await import('../../src/skills/loader.js');
const { executeSkill, findSkillFor } = await import('../../src/skills/executor.js');

function writeSkill(slug, stepsMd) {
  const dir = path.join(STORE, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---
name: ${slug}
description: Executes a real procedure on the target.
whenToUse: target needs checking
allowedTools: [test_run, fs_read]
---
# Body

Prose guidance is fine — the machine-executable part lives in Steps.

${stepsMd}
`);
}

const TEST_STEPS = `## Steps

- step: run the failing test to capture evidence
  tool: test_run
  args: { "file": "$args.file" }

- step: read the test file that failed
  tool: fs_read
  args: { "path": "$args.file" }
`;

writeSkill('exec-debug-tests', TEST_STEPS);

/** Deterministic dispatcher: echoes the call, no real registry. */
function fakeDispatch(tool, args) {
  if (tool === 'test_run') {
    const file = String(args.file || 'suite');
    return {
      ok: true,
      result: file.includes('good')
        ? { ok: true, status: 'pass', pass: 1, fail: 0 }
        : { ok: false, status: 'fail', pass: 0, fail: 1 },
    };
  }
  if (tool === 'fs_read') return { ok: true, result: `file:${args.path}` };
  if (tool === 'boom') return { ok: false, error: 'engine exploded' };
  return { ok: false, error: `unknown tool ${tool}` };
}

test('parseSteps extracts tool + args from the Steps block', () => {
  const steps = parseSteps(TEST_STEPS);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].tool, 'test_run');
  assert.deepEqual(steps[0].args, { file: '$args.file' });
  assert.equal(steps[1].tool, 'fs_read');
});

test('readSkill advertises executability + parsed steps', () => {
  const skill = readSkill('exec-debug-tests');
  assert.equal(skill.executable, true);
  assert.equal(skill.steps.length, 2);
  assert.equal(skill.steps.every((s) => s.tool), true);
});

test('catalog exposes executable flag (metadata only, no body)', async () => {
  const index = await catalog();
  assert.equal(index['exec-debug-tests'].executable, true);
  assert.equal(index['exec-debug-tests'].stepCount, 2);
});

test('findSkillFor matches the executable skill from metadata', async () => {
  assert.equal(await findSkillFor('target needs checking'), 'exec-debug-tests');
  assert.equal(await findSkillFor('unrelated thing'), null);
});

test('executeSkill runs every step through the dispatcher', async () => {
  const events = [];
  const res = await executeSkill({
    slug: 'exec-debug-tests',
    root: '/tmp/proj',
    args: { file: 'src/bad.test.js' },
    onEvent: (t) => events.push(t),
    toolDispatch: fakeDispatch,
  });
  assert.equal(res.ok, true);
  assert.equal(res.steps.length, 2);
  assert.equal(res.steps[0].tool, 'test_run');
  assert.equal(res.steps[0].output.result.status, 'fail'); // evidence, not crash
  assert.equal(res.steps[1].output.result, 'file:src/bad.test.js');
  assert.deepEqual(events, ['start', 'step.start', 'step.result', 'step.start', 'step.result', 'done']);
});

test('a test that PASSES still executes the same procedure', async () => {
  const res = await executeSkill({
    slug: 'exec-debug-tests',
    root: '/tmp/proj',
    args: { file: 'src/good.test.js' },
    toolDispatch: fakeDispatch,
  });
  assert.equal(res.ok, true);
  assert.equal(res.steps[0].output.result.status, 'pass');
  assert.equal(res.steps[1].output.result, 'file:src/good.test.js');
});

test('a tool-level failure aborts and names the failing step', async () => {
  writeSkill('exec-bad-tool', `## Steps

- step: first step is fine
  tool: fs_read
  args: { "path": "a.js" }

- step: this engine blows up
  tool: boom
  args: {  }
`);
  const res = await executeSkill({ slug: 'exec-bad-tool', toolDispatch: fakeDispatch });
  assert.equal(res.ok, false);
  assert.equal(res.failedStep, 1);
  assert.equal(res.tool, 'boom');
  assert.equal(res.error.code, 'STEP_FAILED');
});

test('a prose-only skill is not executable', async () => {
  const res = await executeSkill({ slug: 'exec-debug-tests' });
  assert.equal(res.ok, false);
});

test('unknown slug returns a structured failure', async () => {
  const res = await executeSkill({ slug: 'nope' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'SKILL_NOT_FOUND');
});

test('$prev interpolation passes the previous step output forward', async () => {
  writeSkill('exec-prev', `## Steps

- step: read a file to seed the next args
  tool: fs_read
  args: { "path": "seed.txt" }

- step: report what the previous step read
  tool: test_run
  args: { "file": "$prev.result" }
`);
  const res = await executeSkill({ slug: 'exec-prev', toolDispatch: fakeDispatch });
  assert.equal(res.ok, true);
  assert.equal(res.steps[1].tool, 'test_run');
  assert.equal(res.steps[1].args.file, 'file:seed.txt');
});

test('$args and $root templates resolve at execute time', async () => {
  writeSkill('exec-tpl', `## Steps

- step: interpolate caller args + root
  tool: fs_read
  args: { "path": "$args.target", "base": "$root" }

- step: read default when arg missing
  tool: fs_read
  args: { "path": "$args.missing" }
`);
  const res = await executeSkill({
    slug: 'exec-tpl',
    root: '/work/root',
    args: { target: 'src/main.js' },
    toolDispatch: fakeDispatch,
  });
  assert.equal(res.steps[0].args.path, 'src/main.js');
  assert.equal(res.steps[0].args.base, '/work/root');
  // missing arg stays unresolved (harmless), tool still executes
  assert.equal(res.ok, true);
});