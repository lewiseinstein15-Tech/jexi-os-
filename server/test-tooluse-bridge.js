/**
 * test-tooluse-bridge — the mission/director tool events → `tool_use` rows bridge.
 *
 * Proves: STARTED→running (0ms), COMPLETED/FAILED share the SAME row id with
 * the producer-measured duration, kinds map to Bash/Read, and anything
 * without a toolId (narration, permission gates, artifact bookkeeping)
 * never becomes a row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionEventToToolUse, toolUseRowId } from './src/services/director/ToolUseBridge.js';

const searchStarted = {
  type: 'SEARCH_STARTED', summary: 'Search: node version',
  data: { toolId: 'eabc123', kind: 'Read', slug: 'web-search', detail: '$ web-search node version' },
};
const searchDone = {
  type: 'SEARCH_COMPLETED', summary: 'Search finished: node version.',
  data: { toolId: 'eabc123', kind: 'Read', slug: 'web-search', durationMs: 1842, detail: '$ web-search node version\n7 sources' },
};
const cmdStarted = {
  type: 'COMMAND_STARTED', summary: 'Forge runs `node --version`.',
  data: { toolId: 'exyz9', kind: 'Bash', slug: 'command', command: 'node --version', detail: '$ node --version' },
};
const cmdBlocked = {
  type: 'COMMAND_FAILED', summary: '`date` → blocked ("date" is not in the allowlist).',
  data: { toolId: 'ed1', kind: 'Bash', slug: 'command', command: 'date', ms: 3, durationMs: 3, detail: '$ date\n[exit 1 · blocked]\n' },
};

test('STARTED becomes a running row with 0ms and the $ command head', () => {
  const row = missionEventToToolUse(searchStarted);
  assert.equal(row.status, 'running');
  assert.equal(row.duration_ms, 0);
  assert.equal(row.tool, 'Read');
  assert.equal(row.id, toolUseRowId('eabc123'));
  assert.equal(row.detail, '$ web-search node version');
});

test('COMPLETED shares the row id with success + the measured duration', () => {
  const row = missionEventToToolUse(searchDone);
  assert.equal(row.status, 'success');
  assert.equal(row.id, toolUseRowId('eabc123'));
  assert.equal(row.id, missionEventToToolUse(searchStarted).id);
  assert.equal(row.duration_ms, 1842);
  assert.match(row.detail, /7 sources/);
});

test('FAILED becomes an error row (blocked commands stay honest)', () => {
  const started = missionEventToToolUse({ ...cmdStarted, data: { ...cmdStarted.data, toolId: 'ed1' } });
  const failed = missionEventToToolUse(cmdBlocked);
  assert.equal(started.status, 'running');
  assert.equal(failed.status, 'error');
  assert.equal(failed.id, started.id);
  assert.equal(failed.tool, 'Bash');
  assert.equal(failed.duration_ms, 3);
});

test('Bash kind preserved; missing/odd kinds fall back to Read', () => {
  assert.equal(missionEventToToolUse(cmdStarted).tool, 'Bash');
  const noKind = missionEventToToolUse({ ...searchStarted, data: { ...searchStarted.data, kind: undefined } });
  assert.equal(noKind.tool, 'Read');
  const weird = missionEventToToolUse({ ...searchStarted, data: { ...searchStarted.data, kind: 'Browser' } });
  assert.equal(weird.tool, 'Read');
});

test('events without a toolId never become rows', () => {
  assert.equal(missionEventToToolUse({ type: 'TOOL_STARTED', summary: 'Searching: x' }), null);
  assert.equal(missionEventToToolUse({ type: 'PERMISSION_DENIED', summary: 'Search blocked', data: {} }), null);
  assert.equal(missionEventToToolUse({ type: 'TOOL_FAILED', summary: 'Artifact write failed', data: { bytes: 3 } }), null);
  assert.equal(missionEventToToolUse({ type: 'TASK_COMPLETED', summary: 'done', data: {} }), null);
  assert.equal(missionEventToToolUse(null), null);
});

test('tagged but non-tool phases (no STARTED/COMPLETED/FAILED suffix) are ignored', () => {
  assert.equal(missionEventToToolUse({ type: 'COMMAND_STARTING', summary: 'x', data: { toolId: 'e1' } }), null);
  assert.equal(missionEventToToolUse({ type: 'SEARCH', summary: 'x', data: { toolId: 'e1' } }), null);
});

test('durations pass through rounded; detail/summary are capped', () => {
  const row = missionEventToToolUse({
    type: 'TEST_COMPLETED', summary: 'x'.repeat(500),
    data: { toolId: 'et1', kind: 'Bash', durationMs: 1234.6, detail: 'y'.repeat(9000) },
  });
  assert.equal(row.status, 'success');
  assert.equal(row.duration_ms, 1235);
  assert.equal(row.summary.length, 200);
  assert.equal(row.detail.length, 4000);
});
