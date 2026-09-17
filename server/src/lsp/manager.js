/**
 * JEXI OS — LSP manager.
 *
 * Owns the lifecycle of every language server: spawns one process per language
 * on first request, performs the initialize handshake, tracks open documents
 * and published diagnostics, and shuts everything down cleanly. One manager
 * serves many languages (multi-server routing).
 *
 * A server that is not installed is reported as `{ available: false }` — the
 * caller skips that language rather than failing.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LspClient } from './client.js';
import { route, serverStatus } from './router.js';
import { buildIndex, languageIdFor } from './index/workspace.js';

/** How long to wait for the server to publish diagnostics after a didOpen.
 * tsserver publishes an (often empty) set promptly; this cap only bites when a
 * server never publishes, so it is generous enough to cover a cold start. */
const DIAGNOSTIC_SETTLE_MS = 20000;

export class LspManager {
  constructor({ requestTimeoutMs = 30000, settleMs = DIAGNOSTIC_SETTLE_MS } = {}) {
    this.requestTimeoutMs = requestTimeoutMs;
    this.settleMs = settleMs;
    /** @type {Map<string, {client: LspClient, proc: import('node:child_process').ChildProcess, argv: object, root: string}>} */
    this.servers = new Map();
    /** uri → { file, version, languageId } */
    this.documents = new Map();
    /** uri → diagnostic[] */
    this.diagnostics = new Map();
    /** uri → number of publishDiagnostics pushes (cold-start settle logic) */
    this._publishCount = new Map();
    this.index = null;
    /** default workspace root, set lazily by tools that need a project root */
    this.root = null;
  }

  /**
   * Record the workspace root without indexing. Tool calls use this so a
   * single-file request never triggers a full workspace walk.
   */
  ensureRoot(root) {
    if (root && !this.root) this.root = path.resolve(root);
    return this.root ?? process.cwd();
  }

  /** Spawn (or reuse) the server for `serverId`, initializing it once. */
  async ensureServer(serverId, argv, root) {
    const existing = this.servers.get(serverId);
    if (existing && !existing.client.closed) return existing.client;

    const proc = spawn(argv.cmd, argv.args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      // Own process group (POSIX) so dispose can kill the whole tree —
      // language-server wrappers spawn grandchildren (tsserver).
      detached: process.platform !== 'win32',
    });
    const client = new LspClient({ proc, requestTimeoutMs: this.requestTimeoutMs });

    // Collect diagnostics pushed by the server.
    client.on('notification', (msg) => {
      if (msg.method === 'textDocument/publishDiagnostics') {
        const uri = msg.params?.uri;
        if (uri) {
          this._publishCount.set(uri, (this._publishCount.get(uri) || 0) + 1);
          this.diagnostics.set(uri, msg.params?.diagnostics ?? []);
        }
      }
    });

    this.servers.set(serverId, { client, proc, argv, root });

    const rootUri = pathToFileURL(path.resolve(root)).href;
    await client.initialize({ rootUri });
    return client;
  }

  /** Track an opened document's version so didChange stays correct. */
  trackDocument(file, version) {
    this.documents.set(pathToFileURL(file).href, { file, version, languageId: languageIdFor(file) });
  }

  /** Index the workspace at mission start: open every source file. */
  async startMission(root, opts = {}) {
    this.index = await buildIndex(this, root, opts);
    return this.index;
  }

  /** Get (spawning if needed) the client for a file, or an unavailable result. */
  async clientFor(file) {
    const r = route(file);
    if (!r.available) return { available: false, reason: r.reason };
    const root = this.ensureRoot(this.root ?? null) ?? process.cwd();
    const client = await this.ensureServer(r.server, r.argv, root);
    return { available: true, client, server: r.server, languageId: languageIdFor(file) };
  }

  /** Open a document if it is not already open (idempotent). */
  async openDocument(client, file) {
    const uri = pathToFileURL(file).href;
    if (this.documents.has(uri)) return uri;
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(file, 'utf8');
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: languageIdFor(file), version: 1, text },
    });
    this.trackDocument(file, 1);
    return uri;
  }

  /**
   * Diagnostics for a file. Opens it if needed, then waits briefly for the
   * server to publish. Returns the real diagnostic list.
   */
  async diagnosticsFor(file) {
    const res = await this.clientFor(file);
    if (!res.available) return { available: false, reason: res.reason, diagnostics: [] };
    const uri = await this.openDocument(res.client, file);
    const base = this._publishCount.get(uri) || 0;
    const settle = await this._waitForPublish(uri, base);
    return { available: true, server: res.server, uri, diagnostics: this.diagnostics.get(uri) ?? [], settled: settle };
  }

  /** Poll the diagnostics map until the uri is published AND the publish
   * stream goes quiet or non-empty. Resolving on the FIRST publish is wrong
   * on a cold start: tsserver publishes an EMPTY set promptly (project not
   * yet analyzed) and the real errors arrive in a follow-up publish — that
   * race is the A3 flake. Quiet window: quietMs without a new publish. */
  _waitForPublish(uri, base = 0, maxMs = this.settleMs, quietMs = 2500) {
    const seen = () => (this._publishCount.get(uri) || 0) - base;
    if (seen() > 0 && (this.diagnostics.get(uri) || []).length > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      let lastCount = seen();
      let lastChange = Date.now();
      const timer = setInterval(() => {
        const n = seen();
        if (n !== lastCount) { lastCount = n; lastChange = Date.now(); }
        const diags = this.diagnostics.get(uri) || [];
        if (n > 0 && diags.length > 0) { clearInterval(timer); resolve(true); }
        else if (n > 0 && Date.now() - lastChange >= quietMs) { clearInterval(timer); resolve(false); }
        else if (Date.now() - started > maxMs) { clearInterval(timer); resolve(false); }
      }, 50);
      if (timer.unref) timer.unref();
    });
  }

  /** Position-based request (definition/references/hover) for a file. */
  async positionRequest(file, method, line, character) {
    const res = await this.clientFor(file);
    if (!res.available) return { available: false, reason: res.reason };
    await this.openDocument(res.client, file);
    const uri = pathToFileURL(file).href;
    const params = { textDocument: { uri }, position: { line: line - 1, character: character - 1 } };
    if (method === 'textDocument/references') params.context = { includeDeclaration: true };
    const result = await res.client.request(method, params);
    return { available: true, server: res.server, uri, result };
  }

  /** Document symbols for a file. */
  async documentSymbols(file) {
    const res = await this.clientFor(file);
    if (!res.available) return { available: false, reason: res.reason };
    await this.openDocument(res.client, file);
    const uri = pathToFileURL(file).href;
    const result = await res.client.request('textDocument/documentSymbol', { textDocument: { uri } });
    return { available: true, server: res.server, uri, result };
  }

  /** Workspace-wide symbol search across every running server. */
  async workspaceSymbols(query = '') {
    const running = [...this.servers.keys()];
    if (!running.length) {
      return { available: false, reason: 'no language server running (index the workspace or query a file first)' };
    }
    const results = [];
    for (const [, s] of this.servers) {
      if (s.client.closed) continue;
      try {
        const r = await s.client.request('workspace/symbol', { query: String(query ?? '') });
        if (Array.isArray(r)) results.push(...r);
      } catch { /* server may not support workspace symbols — skip */ }
    }
    if (!results.length && !this.servers.size) return { available: false, reason: 'no language server running' };
    return { available: true, result: results };
  }

  /** Which language servers are installed in this environment. */
  status() {
    return {
      servers: serverStatus(),
      running: [...this.servers.entries()].map(([id, s]) => ({
        id,
        pid: s.proc.pid,
        running: !s.client.closed,
        root: s.root,
        serverInfo: s.client.serverInfo ?? null,
      })),
      documents: this.documents.size,
      indexed: this.index ? { files: this.index.files, opened: this.index.opened, byServer: this.index.byServer } : null,
    };
  }

  /** Shut every server down and release processes. */
  async shutdown() {
    const ids = [...this.servers.keys()];
    for (const id of ids) {
      const s = this.servers.get(id);
      try { await s.client.shutdown(); } catch { /* best effort */ }
      try { await s.client.dispose(); } catch { /* best effort */ }
      // Belt and suspenders — never leave a language-server tree behind.
      try { process.kill(-s.proc.pid, 'SIGKILL'); } catch { try { s.proc.kill('SIGKILL'); } catch { /* already gone */ } }
    }
    this.servers.clear();
    this.documents.clear();
    this.diagnostics.clear();
    this._publishCount.clear();
    this.index = null;
    return { stopped: ids };
  }
}

let _manager = null;

/** Process-wide manager singleton (one process manages many language servers). */
export function lspManager(opts) {
  if (!_manager) _manager = new LspManager(opts);
  return _manager;
}

export const _resetManager = () => { _manager = null; };
