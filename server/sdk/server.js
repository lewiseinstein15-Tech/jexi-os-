/**
 * B141 — JEXI SDK SERVER (DeepSeek Harness `packages/sdk/server` mirror,
 * JEXI-branded).
 *
 * Host-side RPC server helpers: mount a JSON-RPC method table over the line
 * transport (or over an HTTP stream), with method-not-found / internal-error
 * mapping, and a registry of the built-in SDK methods (health, tools,
 * conversations, chat) exposed to SDK clients.
 *
 *   const server = createRpcServer(handlers);
 *   server.handle(method, fn); server.listMethods();
 *   server.mountTransport(transport);
 */

export class RpcServer {
  constructor(handlers = {}) {
    this.handlers = new Map();
    for (const [method, fn] of Object.entries(handlers || {})) {
      if (typeof fn === 'function') this.handlers.set(method, fn);
    }
  }

  /** Register one method handler (replaces any prior). */
  handle(method, fn) {
    if (typeof fn !== 'function') throw new TypeError(`handler for "${method}" must be a function`);
    this.handlers.set(String(method), fn);
    return this;
  }

  /** All registered method names (sorted). */
  listMethods() {
    return [...this.handlers.keys()].sort();
  }

  /** Invoke one method (unknown → error { code: -32601 }). */
  async invoke(method, params = {}) {
    const fn = this.handlers.get(String(method));
    if (!fn) return { error: { code: -32601, message: `method not found: ${method}` } };
    try {
      const result = await fn(params || {});
      return { result: result === undefined ? null : result };
    } catch (e) {
      return { error: { code: -32603, message: (e && e.message) || String(e) } };
    }
  }

  /** Mount this method table onto a line transport (server side). */
  mountTransport(transport) {
    transport.requestHandler = async (method, params) => {
      const out = await this.invoke(method, params);
      if (out.error) {
        const err = new Error(out.error.message);
        err.code = out.error.code;
        throw err;
      }
      return out.result;
    };
    return transport;
  }
}

/** The built-in SDK method table (mirrors the JexiClient surface). */
export function createBuiltinSdkMethods({ health, tools, conversations, chat } = {}) {
  return {
    'health': async () => (typeof health === 'function' ? health() : { ok: true }),
    'tools.list': async () => (typeof tools === 'function' ? tools() : []),
    'conversations.list': async () => (typeof conversations === 'function' ? conversations() : []),
    'chat': async (params = {}) => {
      if (typeof chat !== 'function') throw new Error('chat handler not configured');
      const answer = await chat(String(params.query || ''), { conv: params.conv || null, persona: params.persona || null });
      return { summary: answer };
    },
  };
}
