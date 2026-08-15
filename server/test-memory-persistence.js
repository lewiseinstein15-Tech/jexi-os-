/**
 * JEXI OS — B68 memory-persistence acceptance suite.
 *
 * Proves, with REAL code paths (no stubs), that the persistence probe
 * (a) treats a mounted disk at DATA_DIR as valid persistence,
 * (b) treats REDIS_URL as a FIRST-CLASS persistence backend — not just a
 *     disk fallback — and reports Redis-backed persistence as PROVEN when
 *     boot stamps survive across processes,
 * (c) reports the truth when Redis is configured but unreachable (dead URL,
 *     auth failure, hang/timeout) instead of silently claiming persistence.
 *
 * Restart simulation: `tests/memoryProbeChild.js` is spawned as a fresh
 * process per "boot". The Redis used here is the CLEARLY-LABELED local mock
 * in `tests/respMockRedis.js` (a tiny RESP server) — but the ioredis client
 * in MemoryManager.js is the REAL one, so the full connect → ping → get →
 * set → rehydrate path runs end-to-end without needing a live Redis or
 * credentials. The same code is unchanged when pointed at a real REDIS_URL.
 *
 * NOTE on spawn mechanics: children are spawned ASYNC (never spawnSync).
 * The mock Redis runs inside this parent process, and a synchronous spawn
 * would block the parent's event loop so the mock could never accept the
 * child's connection (found and fixed while testing — every Redis assertion
 * failed with "timed out" until the spawn was made async).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { startMockRedis } from './tests/respMockRedis.js';

// --- In-process section: disk stamps. DATA_DIR must be set BEFORE importing
// --- MemoryManager (config.js reads it at import time).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b68-'));
process.env.DATA_DIR = TMP;
delete process.env.REDIS_URL; // isolate the disk-only path

const { memoryPersistenceProbe, isRedisActive, redisConnectionInfo } = await import('./src/services/MemoryManager.js');

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

const SERVER_ROOT = path.resolve(import.meta.dirname);

/** Spawn one probe child (one fresh "boot") and return its parsed probe JSON. */
function runBoot(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/memoryProbeChild.js'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b68-boot-')), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`probe child timed out. stderr: ${stderr.slice(0, 300)}`));
    }, 30000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`probe child exited ${code}. stderr: ${stderr.slice(0, 400)}`));
      const lines = stdout.trim().split('\n');
      try { resolve(JSON.parse(lines[lines.length - 1])); }
      catch (e) { reject(new Error(`bad child output: ${stdout.slice(0, 400)}`)); }
    });
  });
}

/* ------------------------------------------------------------------ */
console.log('\n== B68 A — DISK STAMPS: a mounted DATA_DIR is valid persistence ==');
/* ------------------------------------------------------------------ */

process.env.RENDER_INSTANCE_ID = 'disk-boot-1';
const boot1 = await memoryPersistenceProbe();
ok(boot1.previousBootsSeen.length === 0, 'first boot sees no previous disk stamps');
ok(boot1.persistentDisk === false, 'first boot: persistentDisk=false (nothing to prove yet)');
ok(boot1.redis.configured === false, 'no REDIS_URL configured → redis reported as not configured');

process.env.RENDER_INSTANCE_ID = 'disk-boot-2';
const boot2 = await memoryPersistenceProbe();
ok(boot2.previousBootsSeen.length === 1 && boot2.previousBootsSeen[0].file.includes('disk-boot-1'),
  'second boot sees the first boot\'s disk stamp', boot2.previousBootsSeen.map((s) => s.file).join(','));
ok(boot2.persistentDisk === true, 'persistentDisk=true once a stamp survived');
ok(boot2.persistent === true, 'persistent=true (disk backend)');
ok(boot2.note.includes('previous boot stamps survived'), 'note says disk persistence is proven', boot2.note);

/* ------------------------------------------------------------------ */
console.log('\n== B68 B — REDIS IS A FIRST-CLASS BACKEND: stamps survive across processes ==');
/* ------------------------------------------------------------------ */

const mock = await startMockRedis({ mode: 'normal' });
try {
  // Two separate child processes ("boots"), each with its OWN fresh DATA_DIR —
  // so disk cannot be the thing that survives. Only Redis can.
  const rb1 = await runBoot({ REDIS_URL: mock.url, RENDER_INSTANCE_ID: 'redis-boot-1' });
  ok(rb1.redis.configured === true && rb1.redis.connected === true,
    'boot 1: REDIS_URL configured AND really connected (ping round-trip)', rb1.redis.error || '');
  ok(rb1.redis.previousBootsSeen.length === 0, 'boot 1: no previous Redis stamps yet');
  ok(rb1._isRedisActive === true, 'boot 1: isRedisActive()=true after a real command succeeded');
  ok(rb1.persistentDisk === false && rb1.persistent === false,
    'boot 1: disk is NOT the backend (fresh DATA_DIR) — only Redis could persist');

  const rb2 = await runBoot({ REDIS_URL: mock.url, RENDER_INSTANCE_ID: 'redis-boot-2' });
  ok(rb2.redis.connected === true, 'boot 2: still connected (same backend)');
  ok(rb2.redis.previousBootsSeen.length === 1 && rb2.redis.previousBootsSeen[0].instance === 'redis-boot-1',
    'boot 2 sees boot 1\'s Redis stamp → memory survives a RESTART/REDEPLOY', JSON.stringify(rb2.redis.previousBootsSeen));
  ok(rb2.persistentDisk === false, 'boot 2: still no disk persistence (fresh DATA_DIR)');
  ok(rb2.persistent === true, 'boot 2: persistent=true — Redis alone proved it');
  ok(rb2.note.includes('Redis-backed persistence PROVEN'), 'note says Redis-backed persistence is PROVEN', rb2.note);

  // Leading whitespace around the URL (a classic mis-paste) must be tolerated.
  const spaced = await runBoot({ REDIS_URL: `  ${mock.url}`, RENDER_INSTANCE_ID: 'redis-boot-space' });
  ok(spaced.redis.connected === true, 'REDIS_URL with leading whitespace is normalized (trimmed) before use', spaced.redis.error || '');

  // Wrapping quotes around the URL (the classic env-file paste artifact) must
  // be tolerated too.
  const quoted = await runBoot({ REDIS_URL: `"${mock.url}"`, RENDER_INSTANCE_ID: 'redis-boot-quoted' });
  ok(quoted.redis.connected === true, 'REDIS_URL wrapped in quotes is normalized (stripped) before use', quoted.redis.error || '');
} finally {
  await mock.close();
}

/* ------------------------------------------------------------------ */
console.log('\n== B68 C — BROKEN REDIS IS REPORTED AS BROKEN (never silently "persistent") ==');
/* ------------------------------------------------------------------ */

// A port with nothing listening on it (bind, note the port, close, reuse).
const closedPort = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    srv.close(() => resolve(port));
  });
});

const bad = await runBoot({ REDIS_URL: `redis://127.0.0.1:${closedPort}`, RENDER_INSTANCE_ID: 'bad-url-boot' });
ok(bad.redis.configured === true && bad.redis.connected === false, 'dead REDIS_URL → probe reports redis.connected=false');
ok(Boolean(bad.redis.error), 'dead REDIS_URL → the real connection error is surfaced', String(bad.redis.error).slice(0, 120));
ok(bad._isRedisActive === false, 'dead REDIS_URL → isRedisActive()=false (truthful health)');
ok(bad.persistent === false, 'dead REDIS_URL → persistent=false (never claims persistence it cannot prove)');
ok(bad.note.includes('connection failed'), 'note names the failure instead of a generic message', bad.note);

// Malformed URL — exactly what the live Render service hit (ioredis threw
// "Invalid URL"): env var is SET but the value is not a valid connection
// string. The probe must report configured=true (so it is not mistaken for
// "not configured") with an ACTIONABLE error, never a bare TypeError.
const malformed = await runBoot({ REDIS_URL: 'redis://:6379', RENDER_INSTANCE_ID: 'bad-url-shape' });
ok(malformed.redis.configured === true && malformed.redis.connected === false,
  'malformed REDIS_URL (empty host) → configured=true (env IS set) + connected=false');
ok(String(malformed.redis.error).includes('hostname'), 'malformed REDIS_URL → actionable error names the cause', String(malformed.redis.error).slice(0, 120));
ok(malformed.note.includes('connection failed'), 'malformed REDIS_URL → note names the failure, not a generic message', malformed.note);
ok(malformed._isRedisActive === false, 'malformed REDIS_URL → isRedisActive()=false');

// Non-Redis URL (e.g. a provider REST/dashboard URL pasted by mistake) — the
// error must say what the value actually starts with, without leaking it.
const notRedis = await runBoot({ REDIS_URL: 'https://xxx.upstash.io/rest/v1', RENDER_INSTANCE_ID: 'bad-scheme' });
ok(notRedis.redis.configured === true && notRedis.redis.connected === false,
  'https:// REDIS_URL → configured=true + connected=false');
ok(String(notRedis.redis.error).includes('https:'), 'https:// REDIS_URL → error names the actual scheme', String(notRedis.redis.error).slice(0, 140));
ok(notRedis.note.includes('connection failed'), 'https:// REDIS_URL → note names the failure');

// Auth failure — mock answers every command with WRONGPASS.
const authMock = await startMockRedis({ mode: 'authfail' });
try {
  const authFail = await runBoot({ REDIS_URL: authMock.url, RENDER_INSTANCE_ID: 'authfail-boot' });
  ok(authFail.redis.connected === false && Boolean(authFail.redis.error),
    'auth failure → connected=false + error surfaced', String(authFail.redis.error).slice(0, 120));
  ok(authFail._isRedisActive === false, 'auth failure → isRedisActive()=false');
} finally {
  await authMock.close();
}

// Hang — server accepts the connection but never replies: the probe's own
// withTimeout must fire (network-timeout handling), not hang the boot.
const hangMock = await startMockRedis({ mode: 'hang' });
try {
  const t0 = Date.now();
  const hung = await runBoot({ REDIS_URL: hangMock.url, RENDER_INSTANCE_ID: 'hang-boot' });
  const took = Date.now() - t0;
  ok(hung.redis.connected === false && String(hung.redis.error).toLowerCase().includes('timed out'),
    'unresponsive Redis → probe times out with a real error (no hang)', String(hung.redis.error).slice(0, 120));
  ok(took < 15000, `probe returned in ${(took / 1000).toFixed(1)}s (bounded, never hangs the boot)`);
  ok(hung._isRedisActive === false, 'timeout → isRedisActive()=false');
} finally {
  await hangMock.close();
}

/* ------------------------------------------------------------------ */
console.log('\n== B68 D — HEALTH TRUTHFULNESS (in-process, no REDIS_URL) ==');
/* ------------------------------------------------------------------ */

const info = redisConnectionInfo();
ok(info.configured === false && info.status === 'unset', 'redisConnectionInfo() reports unset when no REDIS_URL');
ok(isRedisActive() === false, 'isRedisActive()=false when Redis is not configured');

// Clean up the temp DATA_DIR.
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
