/**
 * Turso durable-layer adapter (Sept 2026 — Upstash is gone, Turso is home).
 *
 * Fully hermetic: a fake libsql client (in-memory Map) stands in for the
 * network, so this runs with no creds and no Turso account. The REAL wire
 * path (connectRedisClient → @libsql/client → Turso Cloud) is proven
 * separately against the live database before every deploy.
 */
process.env.JEXI_TURSO_OP_TIMEOUT_MS = '50'; // shrink the 8s op budget for the timeout test

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createTursoAdapter,
  resolveDurableMode,
  isTursoUrl,
  tursoUrl,
  tursoToken,
} = await import('./src/services/MemoryManager.js');

/** In-memory libsql stand-in: implements just the SQL the adapter emits. */
function makeFakeLibsql() {
  const store = new Map(); // k -> { v, exp }
  return {
    store,
    async execute(q) {
      const sql = typeof q === 'string' ? q : q.sql;
      const args = (typeof q === 'object' && q.args) || [];
      if (/^CREATE TABLE/i.test(sql)) return { rows: [], rowsAffected: 0 };
      if (/^SELECT v, exp/i.test(sql)) {
        const e = store.get(args[0]);
        return { rows: e ? [{ v: e.v, exp: e.exp }] : [], rowsAffected: 0 };
      }
      if (/^INSERT OR REPLACE/i.test(sql)) {
        store.set(args[0], { v: args[1], exp: args[2] ?? null });
        return { rows: [], rowsAffected: 1 };
      }
      if (/^DELETE FROM \S+ WHERE k IN/i.test(sql)) {
        let n = 0;
        for (const k of args) if (store.delete(k)) n += 1;
        return { rows: [], rowsAffected: n };
      }
      if (/^DELETE FROM/i.test(sql)) {
        const had = store.delete(args[0]);
        return { rows: [], rowsAffected: had ? 1 : 0 };
      }
      if (/^SELECT k FROM/i.test(sql)) {
        const now = args[args.length - 1];
        const live = [...store.entries()].filter(([, e]) => e.exp == null || e.exp > now);
        if (/LIKE/i.test(sql)) {
          const prefix = String(args[0]).replace(/\\(.)/g, '$1').replace(/%$/, '');
          return { rows: live.filter(([k]) => k.startsWith(prefix)).map(([k]) => ({ k })), rowsAffected: 0 };
        }
        return { rows: live.filter(([k]) => k === args[0]).map(([k]) => ({ k })), rowsAffected: 0 };
      }
      throw new Error(`fake libsql: unhandled SQL: ${sql}`);
    },
  };
}

test('set/get round-trip + String coercion (ioredis parity)', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  assert.equal(await a.set('k1', 'v1'), 'OK');
  assert.equal(await a.get('k1'), 'v1');
  await a.set('k2', 42);
  assert.equal(await a.get('k2'), '42');
});

test('get on a missing key returns null', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  assert.equal(await a.get('nope'), null);
});

test('EX sets lazy expiry: future EX reads back, past EX reads null + deletes', async () => {
  const fake = makeFakeLibsql();
  const a = createTursoAdapter(fake);
  await a.set('fresh', 'x', 'EX', 3600);
  assert.equal(await a.get('fresh'), 'x');
  await a.set('stale', 'y', 'EX', -5);
  assert.equal(await a.get('stale'), null);
  assert.equal(fake.store.has('stale'), false);
});

test('set without EX stores no expiry', async () => {
  const fake = makeFakeLibsql();
  const a = createTursoAdapter(fake);
  await a.set('plain', 'p');
  assert.equal(fake.store.get('plain').exp, null);
});

test('keys with prefix* matches like Redis KEYS (expired excluded)', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  await a.set('jexi:boot:a', '1');
  await a.set('jexi:boot:b', '2');
  await a.set('jexi:memory', '{}');
  await a.set('jexi:boot:old', '3', 'EX', -1);
  const got = await a.keys('jexi:boot:*');
  assert.deepEqual([...got].sort(), ['jexi:boot:a', 'jexi:boot:b']);
});

test('keys without * does an exact live lookup', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  await a.set('jexi:memory', '{}');
  assert.deepEqual(await a.keys('jexi:memory'), ['jexi:memory']);
  assert.deepEqual(await a.keys('jexi:nope'), []);
});

test('keys escapes LIKE wildcards in the prefix', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  await a.set('jexi:boot_%', 'tricky');
  assert.deepEqual(await a.keys('jexi:boot_%*'), ['jexi:boot_%']);
});

test('del removes one/many keys and reports counts', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  await a.set('d1', 'a');
  await a.set('d2', 'b');
  assert.equal(await a.del('d1'), 1);
  assert.equal(await a.get('d1'), null);
  assert.equal(await a.del('d2', 'missing'), 1);
  assert.equal(await a.del(), 0);
});

test('ping/connect/disconnect exist for probe parity', async () => {
  const a = createTursoAdapter(makeFakeLibsql());
  assert.equal(await a.ping(), 'PONG');
  await a.connect();
  a.disconnect();
  assert.equal(a.__turso, true);
});

test('a hung backend rejects (never hangs) via the op timeout', async () => {
  const hung = { execute: () => new Promise(() => {}) };
  const a = createTursoAdapter(hung);
  await assert.rejects(() => a.get('k'), /timed out/);
});

test('resolveDurableMode: none/tcp/rest/turso, turso wins', async () => {
  const save = { r: process.env.REDIS_URL, t: process.env.TURSO_URL };
  try {
    delete process.env.REDIS_URL; delete process.env.TURSO_URL;
    assert.equal(resolveDurableMode(), 'none');
    process.env.REDIS_URL = 'redis://h:6379';
    assert.equal(resolveDurableMode(), 'tcp');
    process.env.REDIS_URL = 'https://x.upstash.io';
    assert.equal(resolveDurableMode(), 'rest');
    process.env.TURSO_URL = 'libsql://db.turso.io';
    assert.equal(resolveDurableMode(), 'turso');
  } finally {
    if (save.r === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = save.r;
    if (save.t === undefined) delete process.env.TURSO_URL; else process.env.TURSO_URL = save.t;
  }
});

test('isTursoUrl matches libsql:// + *.turso.io only', async () => {
  assert.equal(isTursoUrl('libsql://jexi-foo.turso.io'), true);
  assert.equal(isTursoUrl('https://jexi-foo.turso.io'), true);
  assert.equal(isTursoUrl('  libsql://jexi-foo.turso.io  '), true);
  assert.equal(isTursoUrl('https://x.upstash.io'), false);
  assert.equal(isTursoUrl('redis://h:6379'), false);
  assert.equal(isTursoUrl(''), false);
});

test('tursoUrl/tursoToken normalize + fall back', async () => {
  const save = { t: process.env.TURSO_URL, k: process.env.TURSO_TOKEN, a: process.env.TURSO_AUTH_TOKEN };
  try {
    process.env.TURSO_URL = '  "libsql://db.turso.io"  ';
    assert.equal(tursoUrl(), 'libsql://db.turso.io');
    delete process.env.TURSO_URL;
    assert.equal(tursoUrl(), '');
    delete process.env.TURSO_TOKEN; delete process.env.TURSO_AUTH_TOKEN;
    assert.equal(tursoToken(), '');
    process.env.TURSO_AUTH_TOKEN = 'auth-fallback';
    assert.equal(tursoToken(), 'auth-fallback');
    process.env.TURSO_TOKEN = 'primary';
    assert.equal(tursoToken(), 'primary');
  } finally {
    for (const [k, v] of [['TURSO_URL', save.t], ['TURSO_TOKEN', save.k], ['TURSO_AUTH_TOKEN', save.a]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
