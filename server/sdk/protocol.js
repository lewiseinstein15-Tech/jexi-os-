/**
 * B141 — JEXI SDK PROTOCOL (DeepSeek Harness `packages/sdk/protocol` mirror,
 * JEXI-branded).
 *
 * JSON-RPC 2.0 over caller-owned streams: a line-delimited transport with
 * request/notify/response plumbing, pending-request tracking, and the
 * standard error mapping (-32601 missing method, -32603 handler failure,
 * -32700 parse error). Used by the SDK server and scriptable clients.
 */

import { StringDecoder } from 'string_decoder';

export class JsonRpcResponseError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'JsonRpcResponseError';
    this.code = code;
    this.data = data;
  }
}

export class JsonRpcParseError extends Error {
  constructor(message = 'parse error') {
    super(message);
    this.name = 'JsonRpcParseError';
    this.code = -32700;
  }
}

/** Minimal JSON-RPC message validation. */
export function isJsonRpcRequest(msg) {
  return msg !== null && typeof msg === 'object'
    && msg.jsonrpc === '2.0'
    && typeof msg.method === 'string'
    && ('id' in msg);
}

export function isJsonRpcNotification(msg) {
  return msg !== null && typeof msg === 'object'
    && msg.jsonrpc === '2.0'
    && typeof msg.method === 'string'
    && !('id' in msg);
}

/**
 * Line-delimited JSON-RPC endpoint over caller-owned streams.
 * - start() attaches listeners (idempotent); close() detaches and rejects
 *   pending requests without destroying the streams.
 * - Missing request handlers → -32601; handler failures → -32603.
 * - Notifications without a handler are dropped.
 */
export class JsonRpcLineTransport {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.started = false;
    this.requestHandler = null;
    this.notificationHandler = null;
    this.pending = new Map();
    this.nextId = 1;
    this.onData = (chunk) => this._onData(chunk);
    this.onInputError = () => this._failPending(new Error('JSON-RPC input error'));
    this.onInputEnd = () => this._failPending(new Error('JSON-RPC transport closed'));
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.input.on('data', this.onData);
    this.input.on('error', this.onInputError);
    this.input.on('end', this.onInputEnd);
  }

  close() {
    this.input.off('data', this.onData);
    this.input.off('error', this.onInputError);
    this.input.off('end', this.onInputEnd);
    this._failPending(new Error('JSON-RPC transport closed'));
  }

  _onData(chunk) {
    this.buffer += this.decoder.write(chunk);
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this._dispatch(msg);
      } catch {
        this._send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      }
    }
  }

  async _dispatch(msg) {
    // Responses (id present, no method) resolve pending requests on both
    // ends — clients and servers can share the same transport class.
    if (msg !== null && typeof msg === 'object' && 'id' in msg && !('method' in msg)) {
      this._onResponse(msg);
      return;
    }
    if (isJsonRpcNotification(msg)) {
      if (this.notificationHandler) {
        try { await this.notificationHandler(msg.method, msg.params ?? {}); } catch { /* dropped */ }
      }
      return;
    }
    if (!isJsonRpcRequest(msg)) return;
    const { id, method, params } = msg;
    if (!this.requestHandler) {
      this._send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
      return;
    }
    try {
      const result = await this.requestHandler(method, params ?? {}, id);
      this._send({ jsonrpc: '2.0', id, result: result === undefined ? null : result });
    } catch (e) {
      // A handler error carrying a wire code (e.g. -32601 from the RPC
      // method table) is preserved; anything else is an internal error.
      const code = Number.isInteger(e && e.code) ? e.code : -32603;
      this._send({ jsonrpc: '2.0', id, error: { code, message: (e && e.message) || String(e) } });
    }
  }

  _send(msg) {
    try { this.output.write(JSON.stringify(msg) + '\n'); } catch { /* peer gone */ }
  }

  /** Send a request and await its response. */
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Send a notification (no id, no response). */
  notify(method, params) {
    const msg = { jsonrpc: '2.0', method };
    if (params !== undefined && params !== null && Object.keys(params).length > 0) msg.params = params;
    this._send(msg);
  }

  /** Handle an inbound response (client side). */
  _onResponse(msg) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new JsonRpcResponseError(msg.error.code, msg.error.message, msg.error.data));
    else p.resolve(msg.result);
  }

  _failPending(error) {
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();
  }
}

/** Server-side convenience: the base transport already routes responses. */
export class JsonRpcServerTransport extends JsonRpcLineTransport {}
