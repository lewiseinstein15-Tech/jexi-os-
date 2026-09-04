/**
 * B218 — boot resilience (part 2):
 *   §1 dead-Redis honesty — after ALL retries fail, the layer still disables
 *      (B158 semantics preserved: health must never lie)
 *   §2 mirror hydrate retry — hydrateMirrorWithRetries settles once the
 *      client comes back within the window
 *   §3 tick self-heal — if boot hydrate never settled, the 30s loop keeps
 *      retrying until ONE clean pass lands (fresh disk eventually restored)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'b218b-'));
process.env.DATA_DIR = SCRATCH;
process.env.JEXI_HYDRATE_RETRY_DELAYS_MS = '40,60';

// §1 needs a REDIS_URL that refuses connections instantly (nothing listens here)
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { hydrateFromRedis, redisConnectionInfo } = await import('./src/services/MemoryManager.js');
const {
  setRedisClientGetter, hydrateMirrorWithRetries, hydrateMirroredDirs,
  mirrorStatus, startMirrorLoop, __resetForTests,
} = await import('./src/services/RedisMirror.js');

function fakeRedisWithKeys() {
  const store = new Map([
    ['jexi:mirror:missions/ms-r/mission.json', JSON.stringify({ id: 'ms-r', phase: 'run' })],
    ['jexi:mirror:missions/ms-r/graph.json', JSON.stringify({ nodes: [1] })],
  ]);
  return {
    async scan(cursor) { return ['0', [...store.keys()]]; },
    async get(k) { return store.get(k) ?? null; },
    async set(k, v, ...a) { store.set(k, { v, a }); return 'OK'; },
  };
}

function cleanDirs() {
  for (const d of ['missions', 'world', 'conversations']) {
    fs.rmSync(path.join(SCRATCH, d), { recursive: true, force: true });
  }
}

test('§1 dead Redis: all retries fail → layer honestly OFF (B158 preserved), backoff honored', async () => {
  const t0 = Date.now();
  const ok = await hydrateFromRedis();
  const elapsed = Date.now() - t0;
  assert.equal(ok, false, 'hydrate must fail against a dead Redis');
  assert.ok(elapsed >= 100, `both retry delays must be honored (elapsed ${elapsed}ms ≥ 100ms)`);
  const info = redisConnectionInfo();
  assert.equal(info.status, 'off', 'after ALL attempts fail the layer must disable (health stays honest)');
});

test('§2 mirror hydrate retry: null → null → working client = settled + files restored', async () => {
  __resetForTests();
  cleanDirs();
  let calls = 0;
  const working = fakeRedisWithKeys();
  setRedisClientGetter(async () => {
    calls += 1;
    return calls <= 2 ? null : working; // blip for the first two attempts
  });
  const settled = await hydrateMirrorWithRetries();
  assert.equal(settled, true, 'wrapper must settle once the client comes back');
  assert.equal(mirrorStatus().hydrateSettled, true);
  const mission = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'missions/ms-r/mission.json')));
  assert.equal(mission.id, 'ms-r');
  assert.ok(fs.existsSync(path.join(SCRATCH, 'missions/ms-r/graph.json')));
});

test('§2b mirror hydrate retry: client never returns → NOT settled, no files, no crash', async () => {
  __resetForTests();
  cleanDirs();
  setRedisClientGetter(async () => null);
  const settled = await hydrateMirrorWithRetries();
  assert.equal(settled, false);
  assert.equal(mirrorStatus().hydrateSettled, false);
  assert.ok(!fs.existsSync(path.join(SCRATCH, 'missions')), 'nothing must be written without a client');
});

test('§3 tick self-heal: boot hydrate exhausted, loop restores on a later tick', async () => {
  __resetForTests();
  cleanDirs();
  let calls = 0;
  const working = fakeRedisWithKeys();
  setRedisClientGetter(async () => {
    calls += 1;
    return calls <= 3 ? null : working; // Redis "comes back" after 3 getClient calls
  });
  startMirrorLoop(60); // fast tick for the test
  await new Promise((res) => setTimeout(res, 500)); // let ticks run
  const st = mirrorStatus();
  assert.equal(st.hydrateSettled, true, 'a later tick must settle the hydrate once Redis returns');
  const mission = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'missions/ms-r/mission.json')));
  assert.equal(mission.id, 'ms-r', 'fresh disk must eventually be restored by the loop');
  // disk-wins still holds: hydrate never overwrites (b217 contract intact)
  fs.writeFileSync(path.join(SCRATCH, 'missions/ms-r/mission.json'), JSON.stringify({ id: 'ms-r', phase: 'verify' }));
  await hydrateMirroredDirs();
  assert.equal(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'missions/ms-r/mission.json'))).phase, 'verify');
});

process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* best-effort */ } });
