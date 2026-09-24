/**
 * JEXI OS — Phase 8 Scope E — SANDBOX RUNTIME FACADE.
 *
 *   const dual = createDualNetwork({ workspaceMount, stateDir, mode: 'auto' });
 *   dual.mode            → 'docker' | 'process' (auto-resolved, never faked)
 *   dual.runtime         → DualNetworkRuntime (up/down/dialGuard/spawnSandbox)
 *   dual.bridge          → the exec-bridge (handle/call/audit/tools)
 *   dual.client          → jexi-net-side ExecBridgeClient
 *
 * The sandbox-side executor lives here: the bridge calls back into
 * dual.executor() to actually run whitelisted ops ON sandbox-net —
 * process mode = scrubbed-env children + fs inside the mount; docker mode
 * = the same calls executed by the bridge container (compose.yaml).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DualNetworkRuntime, dockerAvailable, DockerUnavailableError, RUNTIME_VERSION } from './dual-network.js';
import { AuditLog } from './audit.js';
import { ExecBridgeClient, BRIDGE_ENDPOINT, buildHttpRequest } from './exec-bridge.js';
import { NETWORKS, JEXI_NET, SANDBOX_NET, ISOLATION_SPEC, DOCKER_VS_PROCESS, getNetwork, membersOf, isCrossNetwork } from './networks.js';
import { createExecBridge } from '../../../security/exec-bridge/index.js';
import { MAX_FILE_BYTES } from '../../../security/exec-bridge/allowlist.js';

export {
  DualNetworkRuntime, dockerAvailable, DockerUnavailableError, RUNTIME_VERSION,
  AuditLog, ExecBridgeClient, BRIDGE_ENDPOINT, buildHttpRequest,
  NETWORKS, JEXI_NET, SANDBOX_NET, ISOLATION_SPEC, DOCKER_VS_PROCESS,
  getNetwork, membersOf, isCrossNetwork,
};

/**
 * The sandbox-net executor — the ONLY thing on the far side of the bridge.
 * run_command → scrubbed-env child (cwd = workspace mount, no shell)
 * read_file / write_file → fs strictly inside the workspace mount
 * report_result → appended to <stateDir>/results.jsonl
 */
export function buildExecutor(runtime) {
  return async function execute(op, args) {
    if (op === 'run_command') {
      const r = await runtime.spawnSandbox({ binary: args.binary, args: args.args || [], timeoutMs: args.timeoutMs });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut, pid: r.pid };
    }
    if (op === 'read_file') {
      const p = path.resolve(String(args.path));
      const st = fs.statSync(p); // throws ENOENT → EXECUTION_ERROR envelope
      if (st.size > MAX_FILE_BYTES) throw new Error(`read_file: ${st.size} bytes exceeds cap ${MAX_FILE_BYTES}`);
      return { path: p, bytes: st.size, content: fs.readFileSync(p, 'utf8') };
    }
    if (op === 'write_file') {
      const p = path.resolve(String(args.path));
      const content = String(args.content ?? '');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return { path: p, bytes: Buffer.byteLength(content, 'utf8') };
    }
    if (op === 'report_result') {
      const file = path.join(runtime.stateDir, 'results.jsonl');
      fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), from: args.caller || 'sandbox-net', payload: args.payload ?? args })}\n`);
      return { file, recorded: true };
    }
    throw new Error(`executor: unsupported op ${JSON.stringify(op)}`);
  };
}

/**
 * Build the full dual-network stack.
 * @param {object} o { workspaceMount, stateDir, mode='auto', key?, caller? }
 *   mode 'docker' throws DockerUnavailableError when no daemon answers —
 *   never silently degrades; 'auto' picks docker when available, else
 *   process (the documented, weaker-enforcement fallback).
 */
export function createDualNetwork({ workspaceMount, stateDir, mode = 'auto', key = null, caller = 'jexi-net:client' } = {}) {
  const runtime = new DualNetworkRuntime({ mode, workspaceMount, stateDir });
  const up = runtime.bringUp(); // resolves mode; docker mode does real `docker network create` here
  const bridge = createExecBridge({
    workspaceMount: runtime.workspaceMount,
    stateDir: runtime.stateDir,
    execute: buildExecutor(runtime),
    key,
    auditFile: path.join(runtime.stateDir, 'bridge-audit.jsonl'),
  });
  runtime.bridge = bridge;
  const client = new ExecBridgeClient({ bridge, caller });
  return { mode: runtime.mode, runtime, bridge, client, up };
}

export default { createDualNetwork, buildExecutor };
