/**
 * GitHub push/commit tool for JEXI (spec Part 3) + transcript trace shape.
 *
 * Hermetic: a mock GitHub API (local HTTP) stands in for api.github.com via
 * the connector's baseUrl override — the REAL connector code runs (blobs →
 * tree → commit → ref), only the wire is fake. A separate LIVE proof (real
 * push to a real branch with the user's token) runs before deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { GitHubConnector } from './src/connectors/github.js';
import { ConnectorConfig } from './src/connectors/ConnectorBase.js';
import { toolTraceKind, toolTraceSummary, toolTraceDetail } from './src/services/ToolRuntime.js';

/* ------------------------------------------------------------------ */
/* Mock GitHub API                                                     */
/* ------------------------------------------------------------------ */
const seen = { refs: [], blobs: [], trees: [], commits: [], refPatches: [], refCreates: [], contents: [] };
const branches = new Map([['main', 'baseHEADsha']]); // branch -> head sha

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://mock');
    const p = u.pathname;
    let b = {};
    try { b = body ? JSON.parse(body) : {}; } catch { /* ignore */ }

    // GET /repos/o/r -> default branch
    if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(p)) return json(res, 200, { default_branch: 'main' });
    // GET ref
    let m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/);
    if (req.method === 'GET' && m) {
      const sha = branches.get(decodeURIComponent(m[1]));
      if (!sha) return json(res, 404, { message: 'Not Found' });
      seen.refs.push(m[1]);
      return json(res, 200, { ref: `refs/heads/${m[1]}`, object: { sha } });
    }
    // POST ref (create branch)
    if (req.method === 'POST' && p.endsWith('/git/refs')) {
      seen.refCreates.push(b);
      const name = String(b.ref || '').replace(/^refs\/heads\//, '');
      branches.set(name, b.sha);
      return json(res, 201, { ref: b.ref, object: { sha: b.sha } });
    }
    // POST blob
    if (req.method === 'POST' && p.endsWith('/git/blobs')) {
      seen.blobs.push(b);
      return json(res, 201, { sha: `blob${seen.blobs.length}` });
    }
    // POST tree
    if (req.method === 'POST' && p.endsWith('/git/trees')) {
      seen.trees.push(b);
      return json(res, 201, { sha: `tree${seen.trees.length}` });
    }
    // POST commit
    if (req.method === 'POST' && p.endsWith('/git/commits')) {
      seen.commits.push(b);
      return json(res, 201, { sha: `commit${seen.commits.length}` });
    }
    // PATCH ref
    m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/);
    if (req.method === 'PATCH' && m) {
      const name = decodeURIComponent(m[1]);
      if (!branches.has(name)) return json(res, 404, { message: 'Not Found' });
      seen.refPatches.push({ branch: name, ...b });
      branches.set(name, b.sha);
      return json(res, 200, { ref: `refs/heads/${name}`, object: { sha: b.sha } });
    }
    // Contents API
    m = p.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m) {
      if (req.method === 'GET') return json(res, 200, { sha: 'fileSHA', type: 'file' });
      if (req.method === 'PUT') {
        seen.contents.push({ path: m[1], ...b });
        return json(res, 201, { commit: { sha: 'contentsCOMMIT' }, content: { sha: 'fileSHA2', html_url: 'http://mock/file' } });
      }
    }
    return json(res, 404, { message: `mock: unhandled ${req.method} ${p}` });
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
test.after(() => { try { server.close(); } catch { /* noop */ } });

function gh() {
  return new GitHubConnector(new ConnectorConfig({ name: 'github', auth: { token: 'test-pat-never-real', baseUrl } }));
}

/* ------------------------------------------------------------------ */
/* create_commit                                                        */
/* ------------------------------------------------------------------ */
test('create_commit on an EXISTING branch: no branch create, parented on head', async () => {
  const r = await gh().send({
    action: 'create_commit', owner: 'o', repo: 'r', branch: 'main',
    message: 'feat: hello', changes: [{ path: 'a.txt', content: 'A' }, { path: 'b.txt', content: 'B' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.sha, 'commit1');
  assert.equal(r.createdBranch, false);
  assert.equal(seen.refCreates.length, 0);
  assert.equal(seen.blobs.length, 2);
  assert.equal(seen.commits[0].message, 'feat: hello');
  assert.deepEqual(seen.commits[0].parents, ['baseHEADsha']);
  assert.equal(seen.trees[0].base_tree, 'baseHEADsha');
  assert.equal(seen.refPatches.at(-1).branch, 'main');
  assert.equal(seen.refPatches.at(-1).force, false);
});

test('create_commit on a NEW branch: auto-created from base, parented on base', async () => {
  const before = seen.refCreates.length;
  const mainHead = branches.get('main'); // main moved in test 1 — read it live
  const r = await gh().send({
    action: 'create_commit', owner: 'o', repo: 'r', branch: 'jexi/e2e-new',
    message: 'feat: new branch work', changes: [{ path: 'n.txt', content: 'N' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.createdBranch, true);
  assert.equal(seen.refCreates.length, before + 1);
  assert.equal(seen.refCreates[before].ref, 'refs/heads/jexi/e2e-new');
  assert.equal(seen.refCreates[before].sha, mainHead);
  assert.deepEqual(seen.commits.at(-1).parents, [mainHead]);
});

test('create_commit validates: branch + message + changes required', async () => {
  await assert.rejects(() => gh().send({ action: 'create_commit', owner: 'o', repo: 'r', branch: 'main' }), /message/);
  await assert.rejects(() => gh().send({ action: 'create_commit', owner: 'o', repo: 'r', message: 'x', changes: [] }), /changes/);
  await assert.rejects(() => gh().send({ action: 'create_commit', owner: 'o', repo: 'r', message: 'x', changes: [{ content: 'no-path' }] }), /path/);
});

test('create_file with a NEW branch auto-creates the branch, returns real sha', async () => {
  const before = seen.refCreates.length;
  const r = await gh().send({
    action: 'create_file', owner: 'o', repo: 'r', branch: 'jexi/e2e-file',
    path: 'proof.txt', content: 'proof', message: 'docs: proof',
  });
  assert.equal(r.ok, true);
  assert.equal(r.commit, 'contentsCOMMIT');
  assert.equal(seen.refCreates.length, before + 1);
  assert.equal(seen.contents.at(-1).branch, 'jexi/e2e-file');
});

/* ------------------------------------------------------------------ */
/* Transcript trace shape (StepRow input — real backend events)         */
/* ------------------------------------------------------------------ */
test('toolTraceKind: github tools get their own kind, others unchanged', async () => {
  assert.equal(toolTraceKind('connector-call', { name: 'github', payload: {} }), 'GitHub');
  assert.equal(toolTraceKind('github-cli', { command: 'gh pr list' }), 'GitHub');
  assert.equal(toolTraceKind('git-status', {}), 'GitHub');
  assert.equal(toolTraceKind('connector-call', { name: 'email' }), 'Read');
  assert.equal(toolTraceKind('run-bash', { command: 'ls' }), 'Bash');
  assert.equal(toolTraceKind('web-search', { query: 'x' }), 'Read');
  assert.equal(toolTraceKind('edit-file', { file: 'a' }), 'Edit');
});

test('toolTraceSummary: github labels name the action + repo@branch + message', async () => {
  const s = toolTraceSummary('connector-call', {
    name: 'github',
    payload: { action: 'create_commit', owner: 'o', repo: 'r', branch: 'feat/x', message: 'feat: hello\n\nbody' },
  });
  assert.ok(s.startsWith('committing to github'), `got: ${s}`);
  assert.ok(s.includes('o/r@feat/x'), `got: ${s}`);
  assert.ok(s.includes('feat: hello'), `got: ${s}`);
  assert.ok(!s.includes('\n'), 'single line');
  assert.ok(s.length <= 140);
  assert.equal(
    toolTraceSummary('connector-call', { name: 'github', payload: { action: 'create_pr', owner: 'o', repo: 'r' } }).split(' · ')[0],
    'opening pull request',
  );
});

test('toolTraceSummary: classic tools use lowercase labels', async () => {
  assert.ok(toolTraceSummary('run-bash', { command: 'npm test' }).startsWith('used bash'));
});

test('toolTraceDetail: running row shows command + message + files, NEVER contents/secrets', async () => {
  const secretContent = 'SUPER-SECRET-FILE-CONTENTS-12345';
  const d = toolTraceDetail('connector-call', {
    name: 'github',
    payload: {
      action: 'create_commit', owner: 'o', repo: 'r', branch: 'b', message: 'feat: hello',
      changes: [{ path: 'a.txt', content: secretContent }],
      token: 'ghp_SHOULD-NEVER-APPEAR',
    },
  });
  assert.ok(d.includes('$ github create_commit o/r@b'), `got: ${d}`);
  assert.ok(d.includes('message: feat: hello'), `got: ${d}`);
  assert.ok(d.includes('files: a.txt'), `got: ${d}`);
  assert.ok(!d.includes(secretContent), 'file contents must not leak into the row');
  assert.ok(!d.includes('ghp_SHOULD-NEVER-APPEAR'), 'tokens must not leak into the row');
});

test('toolTraceDetail: done row shows the real commit SHA', async () => {
  const d = toolTraceDetail(
    'connector-call',
    { name: 'github', payload: { action: 'create_commit', owner: 'o', repo: 'r', branch: 'b', message: 'm', changes: [{ path: 'a' }] } },
    { ok: true, result: { ok: true, sha: 'abc123sha', branch: 'b' } },
  );
  assert.ok(d.includes('commit: abc123sha'), `got: ${d}`);
});

test('toolTraceDetail: done row survives the runtime JSON-stringify wrap', async () => {
  // Production passes result.result as a STRING (spill path) — the SHA must
  // still surface, not a JSON dump.
  const inner = { ok: true, provider: 'github', action: 'create_commit', sha: 'deadbee123', branch: 'b' };
  const wrapped = { ok: true, tool: 'connector-call', permission: 'medium', tier: 'external', result: JSON.stringify(inner) };
  const d = toolTraceDetail(
    'connector-call',
    { name: 'github', payload: { action: 'create_commit', owner: 'o', repo: 'r', branch: 'b', message: 'm', changes: [{ path: 'a' }] } },
    wrapped,
  );
  assert.ok(d.includes('commit: deadbee123'), `got: ${d}`);
  assert.ok(!d.includes('"provider"'), `must not JSON-dump: ${d}`);
});

test('toolTraceDetail: error row surfaces the error', async () => {
  const d = toolTraceDetail('run-bash', { command: 'exit 1' }, { ok: false, error: 'boom happened' });
  assert.ok(d.includes('boom happened'), `got: ${d}`);
});
