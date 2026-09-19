// Phase 11 Scope C — daemon client (probe/session side).
//
// Implements CBM's "first session starts the daemon": if no live endpoint
// file exists, connect fails, or the endpoint pid is dead, `DaemonClient.open`
// spawns a fresh daemon against the SAME cache dir and waits for it to listen.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeBuildId, runtimeIdentity, PROTOCOL_VERSION } from './admission.js';

const REPO_ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const GRAPH_DB = path.join(REPO_ROOT, 'capability/code/graph/db');
export const DEFAULT_CACHE_ROOT = path.join(GRAPH_DB, 'daemon');

export class DaemonClient {
  constructor(socket, info) {
    this.socket = socket;
    this.daemon = info; // endpoint contents from handshake
    this._next = 1;
    this._pending = new Map();
    this._buf = '';
    socket.on('data', (d) => {
      this._buf += d.toString();
      let i;
      while ((i = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, i);
        this._buf = this._buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && this._pending.has(msg.id)) {
          this._pending.get(msg.id)(msg);
          this._pending.delete(msg.id);
        }
      }
    });
  }

  _call(method, params = {}, timeoutMs = 30000) {
    const id = this._next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(Object.assign(new Error(`daemon call "${method}" timed out after ${timeoutMs}ms`), { code: 'TIMEOUT' }));
      }, timeoutMs);
      this._pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        else resolve(msg.result);
      });
      this.socket.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  static async open({ cacheRoot = DEFAULT_CACHE_ROOT, sessionId = null, namespace = null, buildOverride = null, abiOverride = null, cacheRootOverride = null, spawnIfDown = true } = {}) {
    fs.mkdirSync(cacheRoot, { recursive: true });
    const endpointFile = path.join(cacheRoot, 'daemon.json');
    let socket = null;
    let info = null;
    if (fs.existsSync(endpointFile)) {
      try {
        const ep = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
        socket = await tryConnect(ep.port);
        if (socket) info = ep;
      } catch { /* stale endpoint — fall through to spawn */ }
    }
    if (!socket && spawnIfDown) {
      spawn(process.execPath, [path.join(REPO_ROOT, 'kernel/daemon/codegraph-daemon.js'), '--cache-dir', cacheRoot], {
        stdio: 'ignore',
        detached: false,
      });
      const deadline = Date.now() + 10000;
      for (;;) {
        await sleep(120);
        if (fs.existsSync(endpointFile)) {
          try {
            const ep = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
            socket = await tryConnect(ep.port);
            if (socket) { info = ep; break; }
          } catch { /* not ready yet */ }
        }
        if (Date.now() > deadline) throw new Error('daemon did not come up within 10s');
      }
    }
    if (!socket) throw Object.assign(new Error('no live daemon and spawnIfDown=false'), { code: 'DAEMON_DOWN' });

    const client = new DaemonClient(socket, info);
    const hello = await client._call('handshake', {
      protocolVersion: PROTOCOL_VERSION,
      build: buildOverride ?? computeBuildId(),
      abi: abiOverride ?? runtimeIdentity(),
      cacheRoot: cacheRootOverride ?? cacheRoot,
    });
    client.daemon = hello.daemon;
    if (sessionId) {
      client.session = await client._call('register', { sessionId, namespace });
    }
    return client;
  }

  async status() { return this._call('status'); }
  async index(args) { return this._call('index', args); }
  async jobStatus(jobId) { return this._call('job-status', { jobId }); }
  async graphStatus(project) { return this._call('graph-status', project ? { project } : {}); }
  async watch(args) { return this._call('watch', args); }
  async unregister(sessionId) { return this._call('unregister', { sessionId }); }
  async shutdown() {
    const r = await this._call('shutdown');
    await sleep(200);
    return r;
  }

  async waitForJob(jobId, timeoutMs = 120000, pollMs = 150) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { job } = await this.jobStatus(jobId);
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
      if (Date.now() > deadline) throw new Error(`job ${jobId} still ${job.status} after ${timeoutMs}ms`);
      await sleep(pollMs);
    }
  }

  close() {
    try { this.socket.end(); } catch { /* already closed */ }
  }
}

function tryConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(1500);
    s.once('connect', () => { s.setTimeout(0); resolve(s); });
    s.once('timeout', () => { s.destroy(); resolve(null); });
    s.once('error', () => resolve(null));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };
