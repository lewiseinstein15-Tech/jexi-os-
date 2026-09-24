// PHASE 21 — SCOPE B — LIVE PROBE: read-only constraint enforcement.
// Zone-compliant: runtime writes only inside the research/.probes sandbox.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { guardEdit, guardedWriteFile } from '../services/research/constraints/guards.js';
import { mutableSet } from '../services/research/constraints/mutable.js';
import { READ_ONLY, MUTABLE } from '../services/research/constraints/read-only.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const verdictOf = (v) => `${v.allowed ? 'ALLOWED' : 'BLOCKED'}  ${v.allowed ? '' : '— '}${v.reason ?? ''}`;

async function sha256(p) {
  return createHash('sha256').update(await readFile(p)).digest('hex');
}

try {
  console.log('[policy] READ_ONLY patterns:', READ_ONLY.length, '| MUTABLE files:', MUTABLE.length);
  console.log('[policy] mutable set:', JSON.stringify(mutableSet()));

  // ---- attempt 1: edit a read-only file (the judge) -> BLOCKED ----
  let v1 = guardEdit('research/fixtures/toy-target/train.js', { operation: 'edit' });
  console.log(`[attempt 1] edit judge train.js\n  -> ${verdictOf(v1)}`);

  // ---- attempt 2: edit the mutable candidate -> ALLOWED ----
  let v2 = guardEdit('research/fixtures/toy-target/candidate.js', { operation: 'edit' });
  console.log(`[attempt 2] edit candidate.js\n  -> ${verdictOf(v2)}`);

  // ---- attempt 3: create a NEW file outside the mutable set -> BLOCKED ----
  let v3 = guardEdit('research/fixtures/toy-target/cheat.js', { operation: 'create' });
  console.log(`[attempt 3] create new file cheat.js\n  -> ${verdictOf(v3)}`);

  // ---- extra coverage: human-owned strategy file, out-of-zone server path, sandbox ----
  let v4 = guardEdit('research/program/program.md', { operation: 'edit' });
  console.log(`[attempt 4] edit human-owned program.md\n  -> ${verdictOf(v4)}`);
  let v5 = guardEdit('server/src/services/ToolRuntime.js', { operation: 'edit' });
  console.log(`[attempt 5] edit out-of-zone server file\n  -> ${verdictOf(v5)}`);
  let v6 = guardEdit('research/.probes/scope-b-sandbox/notes.md', { operation: 'create' });
  console.log(`[attempt 6] create scratch file in sandbox\n  -> ${verdictOf(v6)}`);

  // ---- runtime enforcement: blocked write never touches disk ----
  const judgePath = join(root, 'research', 'fixtures', 'toy-target', 'train.js');
  const before = await sha256(judgePath);
  let caught = null;
  try {
    await guardedWriteFile(judgePath, '// tampered\n', { extraMutable: ['**/*'] });
  } catch (err) {
    caught = err;
  }
  const after = await sha256(judgePath);
  console.log(`[runtime] guardedWriteFile(judge) threw: ${caught?.code ?? 'NO-THROW'}`);
  console.log(`[runtime] judge bytes unchanged: ${before === after} (sha256 ${before.slice(0, 12)}…)`);
  console.log(
    '[runtime] even a blanket extraMutable grant cannot unlock a read-only file: ' +
      `${caught !== null}`,
  );

  // ---- runtime enforcement: allowed write lands ----
  const sandboxFile = join(root, 'research', '.probes', 'scope-b-sandbox.md');
  await guardedWriteFile(sandboxFile, 'sandbox write ok\n');
  const sandboxContent = await readFile(sandboxFile, 'utf8');
  console.log(`[runtime] sandbox write landed: ${sandboxContent.trim() === 'sandbox write ok'}`);

  // ---- assertions ----
  assert.equal(v1.allowed, false, 'judge must be blocked');
  assert.match(v1.reason, /read-only/);
  assert.equal(v2.allowed, true, 'candidate must be allowed');
  assert.equal(v3.allowed, false, 'new file outside mutable set must be blocked');
  assert.match(v3.reason, /outside-mutable-set/);
  assert.equal(v4.allowed, false, 'program.md is human-owned');
  assert.equal(v5.allowed, false, 'server paths are out of zone');
  assert.equal(v6.allowed, true, 'sandbox scratch is allowed');
  assert.ok(caught, 'guardedWriteFile must throw on a read-only path');
  assert.equal(caught.code, 'EDIT_BLOCKED');
  assert.equal(before, after, 'blocked attempt must not modify the target');
  assert.equal(sandboxContent, 'sandbox write ok\n', 'allowed write must land');

  console.log('SCOPE B PROBE PASSED');
} finally {
  const { rmSync } = await import('node:fs');
  rmSync(join(root, 'research', '.probes', 'scope-b-sandbox.md'), { force: true });
}
