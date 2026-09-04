/**
 * B218 — boot resilience (part 1): the exact 2026-09-04 production incident.
 *
 * A single slow Upstash moment at boot made hydrateFromRedis give up and
 * PERMANENTLY disable the Redis layer for the whole process (memory stopped
 * persisting, the B217 mirror silently no-opped, health showed redis:false
 * until a manual restart). This test proves the fix: hydrate now retries
 * with a FRESH client and recovers when Redis comes back within the window.
 *
 * Method: a REAL minimal RESP server over TCP (test-only fake — no mocks in
 * production code). Its first GET is answered with a Redis error reply +
 * socket drop (the "blip"); every command after that is served properly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

// Env BEFORE importing the module under test.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'b218-'));
process.env.DATA_DIR = SCRATCH;
process.env.JEXI_HYDRATE_RETRY_DELAYS_MS = '80,120'; // fast retries for tests

const MEMORY_PAYLOAD = JSON.stringify({ userFacts: [{ fact: 'B218 blip survivor' }] });

/**
 * Minimal RESP server: answers INFO/PING/GET/SET — the FIRST GET errors out
 * (the simulated Upstash blip). Parses a proper command QUEUE: multiple
 * commands can arrive coalesced in one TCP chunk (ioredis pipelines its
 * handshake) and partial commands must be buffered — a naive line-splitter
 * drops commands and stalls the client.
 */
function parseRespCommands(buf) {
  const cmds = [];
  let rest = buf;
  while (rest.startsWith('*')) {
    const arrEnd = rest.indexOf('\r\n');
    if (arrEnd < 0) break;
    const n = parseInt(rest.slice(1, arrEnd), 10);
    if (!Number.isFinite(n)) break;
    let pos = arrEnd + 2;
    const tokens = [];
    let complete = true;
    for (let i = 0; i < n; i++) {
      if (rest[pos] !== '$') { complete = false; break; }
      const lenEnd = rest.indexOf('\r\n', pos);
      if (lenEnd < 0) { complete = false; break; }
      const len = parseInt(rest.slice(pos + 1, lenEnd), 10);
      if (!Number.isFinite(len)) { complete = false; break; }
      const start = lenEnd + 2;
      const end = start + len;
      if (rest.length < end + 2) { complete = false; break; } // partial command
      tokens.push(rest.slice(start, end));
      pos = end + 2;
    }
    if (!complete) break;
    cmds.push(tokens);
    rest = rest.slice(pos);
  }
  return [cmds, rest];
}

function startFakeRedis({ failFirstGet = false } = {}) {
  let connections = 0;
  let firstGetFailed = !failFirstGet;
  const server = net.createServer((socket) => {
    connections += 1;
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      const [cmds, rest] = parseRespCommands(buf);
      buf = rest; // keep any partial tail
      for (const tokens of cmds) {
        const cmd = String(tokens[0] || '').toUpperCase();
        const arg = String(tokens[1] || '');
        if (cmd === 'PING') { socket.write('+PONG\r\n'); continue; }
        if (cmd === 'INFO') {
          const info = Buffer.from('redis_version:7.2.0\r\n', 'utf-8');
          socket.write(`$${info.length}\r\n${info.toString()}\r\n`);
          continue;
        }
        if (cmd === 'GET') {
          if (!firstGetFailed) {
            firstGetFailed = true;
            socket.write('-ERR simulated Upstash blip\r\n');
            socket.destroy(); // drop the connection too (worst case)
            continue;
          }
          if (arg.includes('jexi:memory')) {
            const p = Buffer.from(MEMORY_PAYLOAD, 'utf-8');
            socket.write(`$${p.length}\r\n${MEMORY_PAYLOAD}\r\n`);
          } else {
            socket.write('$-1\r\n');
          }
          continue;
        }
        if (cmd === 'KEYS' || cmd === 'SCAN') { socket.write('*0\r\n'); continue; }
        socket.write('+OK\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, get connections() { return connections; } });
    });
  });
}

const fake = await startFakeRedis({ failFirstGet: true });
process.env.REDIS_URL = `redis://127.0.0.1:${fake.port}`;

const { hydrateFromRedis, redisConnectionInfo, loadMemory, closeRedis } =
  await import('./src/services/MemoryManager.js');

test('THE INCIDENT: one Redis blip at boot no longer costs the process its Redis layer', async () => {
  const t0 = Date.now();
  const ok = await hydrateFromRedis();
  const elapsed = Date.now() - t0;

  assert.equal(ok, true, 'hydrate must SUCCEED on retry after the blip');
  assert.ok(elapsed >= 80, `retry backoff must have been honored (elapsed ${elapsed}ms ≥ 80ms)`);

  // Memory actually hydrated from the (recovered) fake Redis
  const mem = loadMemory();
  assert.ok(Array.isArray(mem.userFacts) && mem.userFacts.some((f) => f.fact === 'B218 blip survivor'),
    'the payload fact must be in the hydrated memory');
  const onDisk = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'memory.json'), 'utf-8'));
  assert.ok(onDisk.userFacts.some((f) => f.fact === 'B218 blip survivor'),
    'memory.json must be written from the hydrated core');

  // The layer must still be ALIVE (the B218 win) — not 'off' like on 2026-09-04
  const info = redisConnectionInfo();
  assert.equal(info.status, 'ready', `layer must be ready after recovery (got ${info.status})`);
  assert.ok(fake.connections >= 2, `a FRESH client must have been built for the retry (saw ${fake.connections} connection(s))`);
});

// Teardown — MUST drain the event loop (live client + listening server would
// otherwise keep the test process alive forever).
test.after(() => {
  closeRedis();
  try { fake.server.close(); } catch { /* best-effort */ }
});
process.on('exit', () => {
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* best-effort */ }
});
