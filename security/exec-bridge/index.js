/**
 * JEXI OS — Phase 8 Scope E — EXEC-BRIDGE FACADE.
 *
 * createExecBridge() builds the controlled crossing between jexi-net and
 * sandbox-net:
 *
 *   bridge.handle(request)  — verify → allowlist → execute → audit → return
 *   bridge.call(op, args)   — jexi-net-side client: signs, sends, returns
 *   bridge.audit            — the JSONL log of every crossing
 *   bridge.tools()          — capability document (list_tools payload)
 *
 * Transport note (honest): in PROCESS mode call() invokes handle() through
 * the exact same request pipeline an HTTP call would take (sign → verify →
 * allowlist → execute → audit) minus the socket. In DOCKER mode the same
 * envelope travels over http://exec-bridge:8471/v1/exec — see
 * `node security/exec-bridge/index.js serve` for the real HTTP server used
 * in that deployment.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { generateBridgeKey, signRequest, newNonce } from './auth.js';
import { handleBridgeRequest } from './api.js';
import { openBridgeAudit } from './audit.js';
import { tools } from './allowlist.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Absolute paths sandbox-net may never write (the bridge is read-only from there). */
export function protectedPaths() {
  return [
    MODULE_DIR,                                     // security/exec-bridge/*
    path.resolve(MODULE_DIR, '../../runtimes/sandbox'), // runtimes/sandbox/*
  ];
}

/**
 * @param {object} o
 * @param {string}  o.workspaceMount absolute dir sandbox-net may read/write
 * @param {string}  o.stateDir       absolute dir for bridge-audit.jsonl
 * @param {Function} o.execute       async (op, args) → result — sandbox-side executor
 * @param {string}  [o.key]          shared HMAC key (generated when absent)
 * @param {string}  [o.auditFile]    override the audit JSONL path
 */
export function createExecBridge({ workspaceMount, stateDir, execute, key = null, auditFile = null } = {}) {
  if (!workspaceMount || !path.isAbsolute(workspaceMount)) {
    throw new Error(`createExecBridge: absolute workspaceMount required — got ${JSON.stringify(workspaceMount)}`);
  }
  if (!stateDir || !path.isAbsolute(stateDir)) {
    throw new Error(`createExecBridge: absolute stateDir required — got ${JSON.stringify(stateDir)}`);
  }
  if (typeof execute !== 'function') {
    throw new Error('createExecBridge: execute(op, args) is required (sandbox-side executor)');
  }
  const bridgeKey = key || generateBridgeKey();
  const audit = openBridgeAudit({ file: auditFile || path.join(stateDir, 'bridge-audit.jsonl') });

  const bridge = {
    key: bridgeKey,
    workspaceMount: path.resolve(workspaceMount),
    protectedPaths: protectedPaths(),
    execute,
    audit,

    /** Server side: handle an already-signed request. */
    handle(request) {
      return handleBridgeRequest(this, request);
    },

    /** Capability document. */
    tools() {
      return tools();
    },
  };

  /** jexi-net side: sign + send through the handler pipeline. */
  bridge.call = async (op, args, { caller = 'jexi-net:client' } = {}) => {
    const request = { op, args, caller, ts: Date.now(), nonce: newNonce() };
    request.signature = signRequest(request, bridge.key);
    return bridge.handle(request);
  };

  return bridge;
}

/* --------------------------------- CLI ----------------------------------- */
/* Docker-mode HTTP server: same handler, real socket. Process mode never    */
/* needs this — the probes exercise the identical request pipeline directly. */

async function serve(argv) {
  const arg = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
  const { createDualNetwork } = await import('../../runtimes/sandbox/index.js');
  const dual = createDualNetwork({
    workspaceMount: arg.mount,
    stateDir: arg['state-dir'],
    mode: arg.docker ? 'docker' : 'auto',
  });
  const http = await import('node:http');
  const port = Number(arg.port || 8471);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let request;
      try { request = JSON.parse(body || '{}'); } catch { request = {}; }
      const out = await dual.bridge.handle(request);
      res.writeHead(out.status === 'ok' ? 200 : out.status === 'refused' ? 403 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(port, () => console.error(`exec-bridge listening on :${port} (mode=${dual.mode})`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'serve') {
    await serve(process.argv.slice(3));
  } else {
    console.error('usage: node security/exec-bridge/index.js serve --mount=DIR --state-dir=DIR [--port=8471]');
    process.exit(2);
  }
}

export default { createExecBridge, protectedPaths, randomBytes };
