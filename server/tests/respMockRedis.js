/**
 * JEXI OS — Redis test mock (Build 68).
 *
 * ⚠️ CLEARLY LABELED: a LOCAL MOCK Redis server that speaks just enough of the
 * RESP wire protocol (PING / SET / GET / DEL / EXPIRE + AUTH) for ioredis to
 * connect and issue the real commands MemoryManager sends. Nothing here is a
 * real Redis — but the ioredis client in `MemoryManager.js` is the REAL one,
 * so this proves the code path end-to-end (connect → ping → get → set →
 * rehydrate) without needing a live server or credentials.
 *
 * Modes (selected via the `mode` option):
 *   normal   → behaves like a tiny in-memory Redis (data survives for the
 *              lifetime of this server, which is what the restart test needs)
 *   authfail → answers AUTH/commands with `-ERR invalid password` so the
 *              auth-failure path can be exercised
 *   hang     → accepts the connection but never replies, so the probe's
 *              withTimeout() path fires (network-timeout handling)
 */

import net from 'net';

/** Parse a RESP array of bulk strings from a buffer. Returns commands or null. */
function parseResp(buf) {
  const cmds = [];
  let pos = 0;
  while (pos < buf.length) {
    if (buf[pos] !== 0x2a /* '*' */) return cmds; // wait for a complete array
    const headerEnd = buf.indexOf('\r\n', pos);
    if (headerEnd === -1) return cmds;
    const count = parseInt(buf.slice(pos + 1, headerEnd).toString('utf8'), 10);
    if (isNaN(count)) return cmds;
    pos = headerEnd + 2;
    const args = [];
    for (let i = 0; i < count; i++) {
      if (buf[pos] !== 0x24 /* '$' */) return cmds;
      const lenEnd = buf.indexOf('\r\n', pos);
      if (lenEnd === -1) return cmds;
      const len = parseInt(buf.slice(pos + 1, lenEnd).toString('utf8'), 10);
      if (isNaN(len) || len < 0) return cmds;
      pos = lenEnd + 2;
      if (pos + len + 2 > buf.length) return cmds; // incomplete arg
      args.push(buf.slice(pos, pos + len).toString('utf8'));
      pos += len + 2;
    }
    cmds.push(args);
  }
  return cmds;
}

/**
 * Start a mock Redis server. Resolves with { url, close }.
 *   url  = redis://127.0.0.1:<port>
 *   close = force-closes all sockets and the server (never hangs the test).
 */
export function startMockRedis({ mode = 'normal' } = {}) {
  const store = new Map(); // key → { value, ttlAt }  (ttlAt = ms epoch, 0 = no expiry)
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      // hang mode: accept the connection but NEVER reply — the client's own
      // timeout (ioredis ready check / probe withTimeout) must fire.
      if (mode === 'hang') return;
      buffer = Buffer.concat([buffer, chunk]);
      const cmds = parseResp(buffer);
      if (!cmds.length) return;
      // Keep whatever trailing bytes we didn't consume (paranoia; normally none).
      buffer = Buffer.alloc(0);
      for (const args of cmds) {
        const cmd = String(args[0] || '').toUpperCase();
        // authfail mode: reject everything after the handshake like a bad password
        if (mode === 'authfail') {
          socket.write('-ERR WRONGPASS invalid username-password pair\r\n');
          continue;
        }
        try {
          switch (cmd) {
            case 'PING':
              socket.write('+PONG\r\n');
              break;
            case 'SET': {
              const [key, value, px, ttl] = args.slice(1);
              let ttlAt = 0;
              if (px && String(px).toUpperCase() === 'EX' && ttl) ttlAt = Date.now() + Number(ttl) * 1000;
              store.set(key, { value: String(value), ttlAt });
              socket.write('+OK\r\n');
              break;
            }
            case 'GET': {
              const key = args[1];
              const entry = store.get(key);
              if (!entry || (entry.ttlAt && entry.ttlAt < Date.now())) {
                socket.write('$-1\r\n');
              } else {
                const v = Buffer.from(entry.value, 'utf8');
                socket.write(`$${v.length}\r\n${v.toString('utf8')}\r\n`);
              }
              break;
            }
            case 'DEL': {
              let n = 0;
              for (const key of args.slice(1)) if (store.delete(key)) n++;
              socket.write(`:${n}\r\n`);
              break;
            }
            case 'EXPIRE': {
              const key = args[1];
              const entry = store.get(key);
              if (entry) { entry.ttlAt = Date.now() + Number(args[2]) * 1000; socket.write(':1\r\n'); }
              else socket.write(':0\r\n');
              break;
            }
            case 'AUTH':
            case 'HELLO':
            case 'CLIENT':
            case 'SELECT':
              socket.write('+OK\r\n');
              break;
            default:
              // Unknown command → benign OK so ioredis never treats the mock
              // as a protocol mismatch (e.g. CLIENT SETINFO on connect).
              socket.write('+OK\r\n');
          }
        } catch (e) {
          socket.write(`-ERR ${String(e && e.message || e).replace(/\r?\n/g, ' ')}\r\n`);
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `redis://127.0.0.1:${port}`,
        mode,
        close: () => new Promise((r) => {
          for (const s of sockets) { try { s.destroy(); } catch (e) {} }
          sockets.clear();
          try { server.closeAllConnections?.(); } catch (e) {}
          server.close(r);
        }),
      });
    });
  });
}
