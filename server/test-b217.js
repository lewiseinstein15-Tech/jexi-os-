/**
 * B217 — RedisMirror tests (node --test).
 * Proves the persistence mirror: sync → wipe → hydrate → identical restore,
 * no-Redis no-op honesty, disk-wins rule, TTL set, status endpoint data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// DATA_DIR is resolved at import time from src/config.js → point it at a
// scratch dir BEFORE importing the module under test.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'b217-'));
process.env.DATA_DIR = SCRATCH;

const {
  setRedisClientGetter, syncMirror, hydrateMirroredDirs, mirrorStatus,
  startMirrorLoop, __resetForTests,
} = await import('./src/services/RedisMirror.js');

/** Minimal ioredis-compatible fake (get/set/del/scan with MATCH+COUNT). */
function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(k, v, ...args) { store.set(k, { v, args }); return 'OK'; },
    async get(k) { return store.has(k) ? store.get(k).v : null; },
    async del(k) { store.delete(k); return 1; },
    async scan(cursor, ...args) {
      const matchArg = args.find((a) => typeof a === 'string' && a.includes('*'));
      const prefix = matchArg ? matchArg.replace(/\*$/, '') : '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return ['0', keys];
    },
  };
}

function writeFile(rel, content) {
  const abs = path.join(SCRATCH, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Tests share one DATA_DIR → wipe the mirrored dirs between cases. */
function cleanDirs() {
  for (const d of ['missions', 'world', 'conversations']) {
    fs.rmSync(path.join(SCRATCH, d), { recursive: true, force: true });
  }
}

test('no Redis → honest no-op, never throws, status says why', async () => {
  __resetForTests();
  cleanDirs();
  setRedisClientGetter(async () => null);
  writeFile('missions/ms-x/mission.json', '{"id":"ms-x"}');
  const pushed = await syncMirror();
  const restored = await hydrateMirroredDirs();
  assert.equal(pushed, 0, 'nothing should sync without redis');
  assert.equal(restored, 0, 'nothing should hydrate without redis');
  assert.ok(mirrorStatus().reason, 'status must record WHY it is inactive');
  assert.equal(mirrorStatus().active, false);
});

test('sync pushes changed files with TTL; unchanged files are skipped', async () => {
  __resetForTests();
  cleanDirs();
  const r = fakeRedis();
  setRedisClientGetter(async () => r);
  const m = writeFile('missions/ms-a/mission.json', JSON.stringify({ id: 'ms-a', phase: 'run' }));
  const g = writeFile('missions/ms-a/graph.json', JSON.stringify({ nodes: [] }));
  const c = writeFile('conversations/conv-1.jsonl', '{"role":"user"}\n');
  const w = writeFile('world/owner-1.json', JSON.stringify({ observations: [] }));
  writeFile('missions/ms-a/scratch.txt', 'not mirrored'); // wrong extension → excluded

  const pushed = await syncMirror();
  assert.equal(pushed, 4, 'json/jsonl files under mirrored dirs only');
  assert.ok(r.store.has('jexi:mirror:missions/ms-a/mission.json'));
  assert.ok(r.store.has('jexi:mirror:conversations/conv-1.jsonl'));
  assert.ok(!r.store.has('jexi:mirror:missions/ms-a/scratch.txt'), 'non-data file must NOT be mirrored');
  const ttl = r.store.get('jexi:mirror:missions/ms-a/mission.json').args;
  assert.deepEqual(ttl, ['EX', 45 * 24 * 3600], '45-day TTL expected');

  // unchanged mtimes → second sync pushes nothing
  const pushed2 = await syncMirror();
  assert.equal(pushed2, 0, 'unchanged files must be skipped');

  // mutate one file → only that file is re-pushed
  fs.writeFileSync(m, JSON.stringify({ id: 'ms-a', phase: 'verify' }));
  const pushed3 = await syncMirror();
  assert.equal(pushed3, 1);
  assert.equal(JSON.parse(r.store.get('jexi:mirror:missions/ms-a/mission.json').v).phase, 'verify');
  void g; void c; void w;
});

test('THE INCIDENT: sync → container wipe → hydrate restores every file identically', async () => {
  __resetForTests();
  cleanDirs();
  const r = fakeRedis();
  setRedisClientGetter(async () => r);
  const files = {
    'missions/ms-b/mission.json': JSON.stringify({ id: 'ms-b', phase: 'run', createdAt: '2026-09-04T15:02:00Z' }),
    'missions/ms-b/graph.json': JSON.stringify({ nodes: [1, 2, 3], edges: [[1, 2]] }),
    'missions/ms-b/events.jsonl': '{"t":"plan","ts":"2026-09-04T15:03:00Z"}\n{"t":"run","ts":"2026-09-04T15:10:00Z"}\n',
    'missions/lessons.json': JSON.stringify({ lessons: [{ text: 'verify before claiming' }] }),
    'world/owner-1.json': JSON.stringify({ observations: [{ note: 'user ships fast' }] }),
    'conversations/conv-9.jsonl': '{"role":"user","text":"build it"}\n',
  };
  for (const [rel, content] of Object.entries(files)) writeFile(rel, content);
  assert.equal(await syncMirror(), 6);

  // ── simulate Render free-tier hibernation: brand-new container disk ──
  fs.rmSync(path.join(SCRATCH, 'missions'), { recursive: true, force: true });
  fs.rmSync(path.join(SCRATCH, 'world'), { recursive: true, force: true });
  fs.rmSync(path.join(SCRATCH, 'conversations'), { recursive: true, force: true });
  assert.ok(!fs.existsSync(path.join(SCRATCH, 'missions')), 'wipe must have removed the disk state');

  const restored = await hydrateMirroredDirs();
  assert.equal(restored, 6, 'every mirrored file must come back');
  for (const [rel, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(SCRATCH, rel), 'utf8'), content, `restored ${rel} must be byte-identical`);
  }
  assert.equal(mirrorStatus().lastHydrateFiles, 6);
  assert.ok(mirrorStatus().lastHydrateAt);
});

test('hydrate never overwrites existing disk files (disk wins)', async () => {
  __resetForTests();
  cleanDirs();
  const r = fakeRedis();
  setRedisClientGetter(async () => r);
  writeFile('missions/ms-c/mission.json', JSON.stringify({ v: 1 }));
  await syncMirror();
  // disk now has a NEWER local version the mirror has not seen yet
  fs.writeFileSync(path.join(SCRATCH, 'missions/ms-c/mission.json'), JSON.stringify({ v: 2 }));
  const restored = await hydrateMirroredDirs();
  assert.equal(restored, 0, 'existing file must not be touched');
  assert.equal(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'missions/ms-c/mission.json'))).v, 2);
});

test('loop starts once, syncs immediately, and is idempotent', async () => {
  __resetForTests();
  cleanDirs();
  const r = fakeRedis();
  setRedisClientGetter(async () => r);
  writeFile('missions/ms-d/mission.json', '{}');
  startMirrorLoop(60_000);
  startMirrorLoop(60_000); // second call must be a no-op, not two timers
  await new Promise((res) => setTimeout(res, 150)); // immediate first tick
  assert.ok(r.store.has('jexi:mirror:missions/ms-d/mission.json'), 'first tick syncs');
  assert.ok(mirrorStatus().active);
  assert.ok(mirrorStatus().lastSyncAt);
});

test('files outside the mirrored dirs are never mirrored', async () => {
  __resetForTests();
  cleanDirs();
  const r = fakeRedis();
  setRedisClientGetter(async () => r);
  writeFile('memory/identity.json', '{}');
  writeFile('missions/../skills/foo.json', '{}'); // stays under missions after normalize
  await syncMirror();
  for (const key of r.store.keys()) assert.match(key, /^jexi:mirror:(missions|world|conversations)\//, `unexpected key ${key}`);
});

process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* best effort */ } });
