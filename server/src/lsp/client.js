/**
 * JEXI OS — LSP client.
 *
 * JSON-RPC 2.0 over a language server's stdio, framed with LSP's
 * `Content-Length` headers. One client owns one child process: it writes
 * requests/notifications, correlates responses by id, dispatches
 * server→client requests, and surfaces notifications.
 *
 * No provider names live here — this is transport only.
 */

import { EventEmitter } from 'node:events';

const HEADER_SEP = '\r\n\r\n';

/** Split a Buffer stream into complete LSP messages, keeping the tail. */
export function decodeMessages(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    const sep = rest.indexOf(HEADER_SEP);
    if (sep === -1) break;
    const header = rest.subarray(0, sep).toString('utf8');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      // Unknown header block — drop it rather than wedging the stream.
      rest = rest.subarray(sep + HEADER_SEP.length);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = sep + HEADER_SEP.length;
    const bodyEnd = bodyStart + length;
    if (rest.length < bodyEnd) break;
    const body = rest.subarray(bodyStart, bodyEnd).toString('utf8');
    rest = rest.subarray(bodyEnd);
    try {
      messages.push(JSON.parse(body));
    } catch {
      // Malformed payload from the server — skip, do not crash the client.
    }
  }
  return { messages, rest };
}

/** Frame a JSON-RPC payload with an LSP Content-Length header. */
export function encodeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_SEP}`, 'utf8'), body]);
}

export class LspClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('node:child_process').ChildProcess} opts.proc  spawned language server
   * @param {number} [opts.requestTimeoutMs]  per-request timeout
   */
  constructor({ proc, requestTimeoutMs = 30000 }) {
    super();
    this.proc = proc;
    this.requestTimeoutMs = requestTimeoutMs;
    this._nextId = 1;
    this._pending = new Map();
    this._buffer = Buffer.alloc(0);
    this._closed = false;
    this._stderr = '';
    this.capabilities = null;
    this.serverInfo = null;

    proc.stdout.on('data', (chunk) => this._onData(chunk));
    proc.stderr.on('data', (chunk) => { this._stderr += chunk.toString('utf8'); });
    proc.on('exit', (code, signal) => {
      this._closed = true;
      for (const [, entry] of this._pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`language server exited (code=${code} signal=${signal})`));
      }
      this._pending.clear();
      this.emit('exit', { code, signal });
    });
    proc.on('error', (err) => {
      this._closed = true;
      this.emit('error', err);
    });
  }

  get stderr() {
    return this._stderr;
  }

  get closed() {
    return this._closed;
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    const { messages, rest } = decodeMessages(this._buffer);
    this._buffer = rest;
    for (const msg of messages) this._onMessage(msg);
  }

  _onMessage(msg) {
    // Response to one of our requests.
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const entry = this._pending.get(msg.id);
      if (!entry) return;
      this._pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'lsp error'), { lspError: msg.error }));
      else entry.resolve(msg.result);
      return;
    }
    // Request from the server — must answer or the server stalls.
    if (msg.id !== undefined && msg.method) {
      this._handleServerRequest(msg);
      return;
    }
    // Notification from the server.
    if (msg.method) this.emit('notification', msg);
  }

  _handleServerRequest(msg) {
    let result = null;
    if (msg.method === 'workspace/configuration') {
      const items = msg.params?.items ?? [];
      result = items.map(() => ({}));
    } else if (msg.method === 'client/registerCapability' || msg.method === 'client/unregisterCapability') {
      result = null;
    } else if (msg.method === 'window/workDoneProgress/create') {
      result = null;
    }
    this._send({ jsonrpc: '2.0', id: msg.id, result });
  }

  _send(payload) {
    if (this._closed || !this.proc.stdin.writable) return false;
    this.proc.stdin.write(encodeMessage(payload));
    return true;
  }

  /** Send a request and await its response. */
  request(method, params, { timeoutMs } = {}) {
    if (this._closed) return Promise.reject(new Error('language server is not running'));
    const id = this._nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`lsp request timed out: ${method}`));
      }, timeoutMs ?? this.requestTimeoutMs);
      if (timer.unref) timer.unref();
      this._pending.set(id, { resolve, reject, timer });
      if (!this._send(payload)) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(new Error('language server stdin is not writable'));
      }
    });
  }

  /** Send a notification (no response expected). */
  notify(method, params) {
    return this._send({ jsonrpc: '2.0', method, params });
  }

  /** LSP initialize handshake + `initialized` notification. */
  async initialize({ rootUri, workspaceFolders, capabilities } = {}) {
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri: rootUri ?? null,
      workspaceFolders: workspaceFolders ?? (rootUri ? [{ uri: rootUri, name: 'workspace' }] : null),
      capabilities: capabilities ?? {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: false },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: false },
        },
        workspace: { workspaceFolders: true, symbol: {} },
      },
      clientInfo: { name: 'jexi-os', version: '1.0.0' },
    }, { timeoutMs: 60000 });
    this.capabilities = result?.capabilities ?? null;
    this.serverInfo = result?.serverInfo ?? null;
    this.notify('initialized', {});
    return result;
  }

  /** Ask the server to shut down cleanly, then exit. */
  async shutdown() {
    if (this._closed) return { ok: true, alreadyClosed: true };
    try {
      await this.request('shutdown', null, { timeoutMs: 5000 });
    } catch {
      // Server may already be gone — fall through to exit.
    }
    this.notify('exit', null);
    return { ok: true };
  }

  /** Terminate the child process, escalating if it ignores `exit`. */
  async dispose({ graceMs = 1500 } = {}) {
    if (this._closed) return;
    try { this.proc.stdin.end(); } catch { /* already closed */ }
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), graceMs);
      if (timer.unref) timer.unref();
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) { clearTimeout(timer); resolve(true); return; }
      this.proc.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    if (!exited) {
      try { this.proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }
}
