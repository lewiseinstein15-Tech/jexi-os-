/**
 * test-session-keys — one-time GitHub keys: memory-only, never persisted.
 *
 * Proves the one-time-paste order: a pasted key is held in memory with a
 * TTL, beats the env var while fresh, is forgotten on demand, is never
 * returned by any status API, and any PAT material stored by older builds
 * is migrated OUT of settings.json / credentials.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isPlausibleKey, setGithubKey, getGithubKey, githubKeyStatus, forgetGithubKey,
  requestGithubKey, pendingGithubAsk, answerGithubKey, migrateStoredGithubSecrets,
} from './src/services/SessionKeys.js';

const KEY = `ghp_${'k'.repeat(36)}`;

test('set/get round-trip with use counting', () => {
  forgetGithubKey();
  const r = setGithubKey(KEY);
  assert.equal(r.ok, true);
  assert.equal(r.expiresInSec, 1800);
  assert.equal(getGithubKey(), KEY);
  assert.equal(getGithubKey(), KEY);
  assert.deepEqual(githubKeyStatus(), { set: true, expiresInSec: githubKeyStatus().expiresInSec, uses: 2 });
  forgetGithubKey();
});

test('garbage pastes are rejected honestly', () => {
  forgetGithubKey();
  for (const bad of ['', '   ', 'short', 'has spaces in it padding out to twenty', null, 12345, 'x'.repeat(301)]) {
    const r = setGithubKey(bad);
    assert.equal(r.ok, false, `expected rejection: ${JSON.stringify(bad)}`);
  }
  assert.equal(isPlausibleKey(KEY), true);
  assert.equal(isPlausibleKey('has space padding it out fine'), false);
  assert.equal(getGithubKey(), null);
});

test('keys expire (short TTL)', async () => {
  forgetGithubKey();
  setGithubKey(KEY, { ttlMs: 20 });
  assert.equal(getGithubKey(), KEY);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(getGithubKey(), null);
  assert.deepEqual(githubKeyStatus(), { set: false, expiresInSec: 0, uses: 0 });
});

test('forget drops the key', () => {
  setGithubKey(KEY);
  assert.equal(forgetGithubKey().forgotten, true);
  assert.equal(forgetGithubKey().forgotten, false);
  assert.equal(getGithubKey(), null);
});

test('status APIs never leak key material', () => {
  setGithubKey(KEY);
  const blob = JSON.stringify({ s: githubKeyStatus(), p: pendingGithubAsk('nope') });
  assert.ok(!blob.includes('ghp_') && !blob.includes(KEY.slice(4, 12)));
  forgetGithubKey();
});

test('key requests dedupe while pending (no card spam)', () => {
  const events = [];
  const a = requestGithubKey({ conv: 'c1', tool: 'github:push', reason: 'to push', sendEvent: (t, d) => events.push([t, d]) });
  assert.equal(a.fresh, true);
  const b = requestGithubKey({ conv: 'c1', tool: 'github:push', reason: 'to push', sendEvent: (t, d) => events.push([t, d]) });
  assert.equal(b.fresh, false);
  assert.equal(b.id, a.id);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'ask.secret');
  assert.equal(events[0][1].id, a.id);
  const p = pendingGithubAsk('c1');
  assert.equal(p.id, a.id);
  assert.equal(p.tool, 'github:push');
});

test('answers need a live matching request; bad pastes keep the request', () => {
  const wrong = answerGithubKey({ conv: 'c1', id: 'nope', value: KEY });
  assert.equal(wrong.ok, false);
  const p = pendingGithubAsk('c1');
  const badVal = answerGithubKey({ conv: 'c1', id: p.id, value: 'too short' });
  assert.equal(badVal.ok, false);
  assert.equal(pendingGithubAsk('c1').id, p.id); // still pending
  const good = answerGithubKey({ conv: 'c1', id: p.id, value: KEY });
  assert.equal(good.ok, true);
  assert.equal(pendingGithubAsk('c1'), null); // consumed
  assert.equal(getGithubKey(), KEY);
  forgetGithubKey();
});

test('migration strips stored PAT material and preserves everything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-sess-'));
  const settingsPath = path.join(dir, 'settings.json');
  const credentialsPath = path.join(dir, 'credentials.json');
  fs.writeFileSync(settingsPath, JSON.stringify({
    groqKey: 'keep-me', githubToken: 'ghp_stale',
    connectors: { github: { auth: { token: 'ghp_stale2', webhookSecret: 'keep-hook' }, enabled: true } },
  }));
  fs.writeFileSync(credentialsPath, JSON.stringify({ github: 'ghp_stale3', github_token: 'ghp_stale4', other: 'keep-other' }));
  const r = migrateStoredGithubSecrets({ settingsPath, credentialsPath });
  assert.deepEqual(r.removed.sort(), ['credentials:github', 'credentials:github_token', 'settings:connectors.github.auth.token', 'settings:githubToken'].sort());
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  assert.equal(s.groqKey, 'keep-me');
  assert.equal(s.githubToken, undefined);
  assert.equal(s.connectors.github.auth.token, undefined);
  assert.equal(s.connectors.github.auth.webhookSecret, 'keep-hook');
  const c = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
  assert.deepEqual(c, { other: 'keep-other' });
  const again = migrateStoredGithubSecrets({ settingsPath, credentialsPath });
  assert.deepEqual(again.removed, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration tolerates missing and broken files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-sess-'));
  const r = migrateStoredGithubSecrets({ settingsPath: path.join(dir, 'nope.json'), credentialsPath: path.join(dir, 'nope2.json') });
  assert.deepEqual(r.removed, []);
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  const r2 = migrateStoredGithubSecrets({ settingsPath: bad, credentialsPath: bad });
  assert.deepEqual(r2.removed, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GitHubAgent precedence: session > env > nothing (never disk)', async () => {
  const { getGhToken } = await import('./src/services/GitHubAgent.js');
  const prev = process.env.GITHUB_TOKEN;
  const prevGh = process.env.GH_TOKEN;
  try {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    forgetGithubKey();
    assert.equal(getGhToken(), '');
    process.env.GITHUB_TOKEN = 'env-token';
    assert.equal(getGhToken(), 'env-token');
    setGithubKey(KEY);
    assert.equal(getGhToken(), KEY);
    forgetGithubKey();
    assert.equal(getGhToken(), 'env-token');
  } finally {
    if (prev === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = prev;
    if (prevGh === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prevGh;
    forgetGithubKey();
  }
});
