/**
 * JEXI OS — Phase 17 Scope B — RAW CDP CLIENT.
 *
 * A dependency-free Chrome DevTools Protocol client over the browser-level
 * WebSocket that Obscura exposes at `ws://127.0.0.1:9222/devtools/browser`.
 * Uses Node's built-in global WebSocket, so the action registry needs no npm
 * packages and no Playwright.
 *
 * Sessions are FLATTENED: every command carries a `sessionId`, so one socket
 * drives every tab. That keeps multi-tab actions cheap — no second connection,
 * no per-tab state to reconcile.
 *
 * ── WHAT OBSCURA ACTUALLY SUPPORTS (probed, 2026-09-18, v0.2.2) ────────────
 * Verified working:  Browser.getVersion, Target.createTarget/attachToTarget/
 *                    closeTarget, Page.enable/navigate/captureScreenshot/
 *                    getNavigationHistory/navigateToHistoryEntry,
 *                    Runtime.evaluate, DOM.getDocument/querySelector,
 *                    Network.enable, Emulation.setDeviceMetricsOverride
 * Verified ABSENT:   Page.handleJavaScriptDialog  → -32601 "Unknown Page method"
 *                    Page.javascriptDialogOpening → never fires; alert()/
 *                    confirm()/prompt() do not block and raise no event
 * Verified GATED:    DOM.setFileInputFiles → -32601 unless the engine is
 *                    started with `--allow-file-access`
 * Also absent:       GET /json/new (connection reset); use Target.createTarget.
 *
 * The two gaps are handled honestly rather than papered over:
 *   dialogs — a capture shim is installed via
 *             `Page.addScriptToEvaluateOnNewDocument`, which DOES work. Alert/
 *             confirm/prompt calls are recorded with their messages and return
 *             caller-configured values (see dialogs.js). This is a documented
 *             emulation, not the native protocol event.
 *   uploads — the engine is started with `--allow-file-access` when uploads are
 *             wanted; otherwise the action returns the engine's own refusal.
 */

export class CdpError extends Error {
  constructor(method, detail) {
    super(`CdpError: ${method} failed — ${detail}`);
    this.name = 'CdpError';
    this.method = method;
    this.code = 'E_CDP';
  }
}

export class CdpTimeoutError extends CdpError {
  constructor(method, ms) {
    super(method, `no response within ${ms}ms`);
    this.name = 'CdpTimeoutError';
    this.code = 'E_CDP_TIMEOUT';
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One CDP connection to one browser endpoint, multiplexing all sessions.
 */
export class CdpClient {
  /**
   * @param {object} o
   * @param {string} o.wsUrl browser-level websocket, e.g. ws://127.0.0.1:9222/devtools/browser
   * @param {number} [o.timeoutMs]
   */
  constructor({ wsUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!wsUrl) throw new Error('CdpClient: wsUrl is required');
    this.wsUrl = wsUrl;
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();     // id → { resolve, reject, timer, method }
    this.listeners = new Map();   // method → Set<fn>
    this.sessionIds = new Set();
    this.closed = false;
  }

  /** Open the socket. Resolves once the connection is usable. */
  connect() {
    if (this.ws) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        reject(new CdpError('connect', `${this.wsUrl} — ${e.message}`));
        return;
      }
      this.ws = ws;
      const onOpenError = (e) => reject(new CdpError('connect', `${this.wsUrl} — ${e?.message || 'socket error'}`));
      ws.onerror = onOpenError;
      ws.onopen = () => {
        ws.onerror = null;
        ws.onmessage = (ev) => this._onMessage(ev);
        ws.onclose = () => this._onClose();
        resolve(this);
      };
    });
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return; // CDP can emit non-JSON frames; ignore rather than crash the client
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer, method } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.error) reject(new CdpError(method, `[${msg.error.code}] ${msg.error.message}`));
      else resolve(msg.result ?? {});
      return;
    }
    if (msg.method) {
      const set = this.listeners.get(msg.method);
      if (set) for (const fn of set) { try { fn(msg.params, msg.sessionId); } catch { /* listener error must not kill the client */ } }
      const all = this.listeners.get('*');
      if (all) for (const fn of all) { try { fn(msg); } catch { /* ditto */ } }
    }
  }

  _onClose() {
    this.closed = true;
    for (const { reject, timer, method } of this.pending.values()) {
      clearTimeout(timer);
      reject(new CdpError(method, 'connection closed before a response arrived'));
    }
    this.pending.clear();
  }

  /**
   * Subscribe to a CDP event.
   * @returns {() => void} unsubscribe
   */
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  /**
   * Send a command and await its result.
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   */
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new CdpError(method, 'client is closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpTimeoutError(method, this.timeoutMs));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      const frame = { id, method, params };
      if (sessionId) frame.sessionId = sessionId;
      try {
        this.ws.send(JSON.stringify(frame));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CdpError(method, `send failed — ${e.message}`));
      }
    });
  }

  /** Open a new page target and attach a flattened session to it. */
  async createSession({ url = 'about:blank' } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionIds.add(sessionId);
    return new CdpSession(this, sessionId, targetId);
  }

  /**
   * List page targets. Uses the HTTP /json/list endpoint, because
   * Target.getTargets is not needed and /json/list is what Obscura serves.
   */
  async listTargets() {
    const base = this.wsUrl.replace(/^ws:/, 'http:').replace('/devtools/browser', '');
    const r = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new CdpError('listTargets', `HTTP ${r.status}`);
    return r.json();
  }

  /** Close the socket; all in-flight commands reject. */
  close() {
    if (!this.ws || this.closed) { this.closed = true; return; }
    try { this.ws.close(); } catch { /* already closing */ }
    this.closed = true;
  }
}

/**
 * A flattened session bound to one target. Actions call `session.send(...)`.
 */
export class CdpSession {
  constructor(client, sessionId, targetId) {
    this.client = client;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.enabled = new Set();
  }

  send(method, params = {}) {
    return this.client.send(method, params, this.sessionId);
  }

  /** Enable a CDP domain once per session. */
  async enable(domain) {
    if (this.enabled.has(domain)) return;
    try {
      await this.send(`${domain}.enable`);
      this.enabled.add(domain);
    } catch (e) {
      // Domains Obscura does not implement must not be fatal for optional
      // capabilities (Network/Log are best-effort).
      if (!/Unknown|not implemented|-32601/i.test(e.message)) throw e;
    }
  }

  /** Evaluate an expression in the page, returning its value by value. */
  async eval(expression, { awaitPromise = true, returnByValue = true, userGesture = false } = {}) {
    let r;
    try {
      r = await this.send('Runtime.evaluate', {
        expression, awaitPromise, returnByValue, userGesture,
        includeCommandLineAPI: false,
      });
    } catch (e) {
      throw new CdpError('Runtime.evaluate', `${e.message} — expression: ${String(expression).slice(0, 200)}`);
    }
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const desc = d.exception?.description || d.text || 'unknown page exception';
      const err = new CdpError('Runtime.evaluate', `page threw — ${desc}`);
      err.pageException = d;
      throw err;
    }
    return r.result?.value;
  }

  /**
   * Evaluate and return the JSON-parsed value of an expression.
   *
   * Accepts both call styles used across the action modules:
   *   evalJson('return { x: 1 };')        a function body with an explicit return
   *   evalJson('(() => ({ x: 1 }))()')    a self-contained expression (IIFE, incl. async)
   *
   * The expression form is tried second because a bare IIFE has no `return`,
   * so the body form yields undefined for it. Wrapping in an async IIFE makes
   * `await` legal, which is what lets the async fetch body in files.js work.
   */
  async evalJson(expression) {
    // Pick the wrapper from the shape of the source rather than trying both.
    // Trying both would run the expression twice, and an expression is allowed
    // to have side effects (submit_form submits, then the second run executes
    // against the page it navigated to and reports a bogus "not found").
    const src = String(expression).trim();
    const wrapped = /^return\b/.test(src)
      ? `JSON.stringify((() => { ${src} })())`
      : `(async () => JSON.stringify(await (${src})))()`;
    const raw = await this.eval(wrapped);
    return raw === null || raw === undefined ? undefined : JSON.parse(raw);
  }

  /** Navigate and wait for the document to reach `readyState`. */
  async navigate(url, { waitUntil = 'load', timeoutMs = 30_000 } = {}) {
    const done = new Promise((resolve) => {
      const off = this.client.on('Page.loadEventFired', (_p, sid) => {
        if (sid && sid !== this.sessionId) return;
        off(); resolve('load');
      });
      setTimeout(() => { off(); resolve('timeout'); }, timeoutMs);
    });
    await this.send('Page.navigate', { url });
    if (waitUntil === 'none') return;
    await done;
    await this.waitForReady(timeoutMs);
  }

  /** Poll until document.readyState reports complete (or the deadline passes). */
  async waitForReady(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await this.eval('document.readyState');
        if (state === 'complete' || state === 'interactive') return state;
      } catch { /* navigation in flight — keep polling */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  /** URL and title of the current document. */
  async pageInfo() {
    const info = await this.evalJson('return { url: location.href, title: document.title, readyState: document.readyState };');
    return info;
  }

  async close() {
    try { await this.client.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* already gone */ }
    this.client.sessionIds.delete(this.sessionId);
  }
}

/**
 * Connect a client to a CDP endpoint. Convenience wrapper.
 * @param {string} wsUrl
 */
export async function connectCdp(wsUrl, opts = {}) {
  const client = new CdpClient({ wsUrl, ...opts });
  await client.connect();
  return client;
}

export default { CdpClient, CdpSession, connectCdp, CdpError, CdpTimeoutError };
