/**
 * JEXI OS — Phase 8 Scope E — EXEC-BRIDGE REQUEST HANDLER.
 *
 * The ONLY code path that crosses the network boundary. Order is mandatory:
 *
 *   1. authenticate   — HMAC verify; failure ⇒ refused "unauthenticated"
 *   2. allowlist      — op check, then op-specific checks (binaries, paths)
 *   3. audit          — every request lands in the log (allow AND refuse)
 *   4. execute        — on sandbox-net, via the runtime-provided executor
 *   5. return         — result (or the specific refusal) back through the bridge
 *
 * NOTHING else crosses: no shell, no fs, no network — only this API.
 */

import { verifyRequest } from './auth.js';
import { checkOp, checkRunCommand, checkFilePath, checkReportResult, tools } from './allowlist.js';

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Response envelope for a refused request. */
function refused(op, rule, reason, ts) {
  return { protocol: BRIDGE_PROTOCOL_VERSION, status: 'refused', op, rule, reason, ts };
}

/**
 * Handle one signed request against `bridge` (created by index.js).
 * Pure policy + delegation: execution itself is `bridge.execute(op, args)`,
 * provided by the runtime so docker/process modes differ only there.
 */
export async function handleBridgeRequest(bridge, request) {
  const t0 = Date.now();
  const ts = new Date().toISOString();

  // ---- 1. authenticate (FIRST — an unauthenticated request is not parsed further)
  const verdict = verifyRequest(request, bridge.key);
  const op = request && typeof request.op === 'string' ? request.op : null;
  if (!verdict.ok) {
    bridge.audit.append({
      ts, direction: 'jexi-net -> sandbox-net', caller: request?.caller ?? null, op,
      args: request?.args, authenticated: false,
      decision: { status: 'refused', rule: 'UNAUTHENTICATED', reason: verdict.reason },
      result: 'refused before allowlist/execution', latencyMs: Date.now() - t0,
    });
    return refused(op, 'UNAUTHENTICATED', verdict.reason, ts);
  }

  // ---- 2. allowlist (op, then op-specific)
  const opCheck = checkOp(op);
  if (!opCheck.allowed) {
    bridge.audit.append({
      ts, caller: request.caller, op, args: request.args, authenticated: true,
      decision: { status: 'refused', rule: opCheck.rule, reason: opCheck.reason },
      result: 'refused at allowlist', latencyMs: Date.now() - t0,
    });
    return refused(op, opCheck.rule, opCheck.reason, ts);
  }

  let specific = { allowed: true, rule: null, reason: 'no op-specific checks' };
  if (op === 'run_command') specific = checkRunCommand(request.args);
  else if (op === 'read_file' || op === 'write_file') specific = checkFilePath(op, request.args?.path, { workspaceMount: bridge.workspaceMount, protectedPaths: bridge.protectedPaths });
  else if (op === 'report_result') specific = checkReportResult(request.args);

  if (!specific.allowed) {
    bridge.audit.append({
      ts, caller: request.caller, op, args: request.args, authenticated: true,
      decision: { status: 'refused', rule: specific.rule, reason: specific.reason },
      result: 'refused at op-specific checks', latencyMs: Date.now() - t0,
    });
    return refused(op, specific.rule, specific.reason, ts);
  }

  // ---- 3/4. execute on sandbox-net (executor audits nothing itself — the bridge owns the log)
  let result;
  try {
    result = op === 'list_tools' ? tools() : await bridge.execute(op, request.args ?? {});
  } catch (err) {
    bridge.audit.append({
      ts, caller: request.caller, op, args: request.args, authenticated: true,
      decision: { status: 'error', rule: 'EXECUTION_ERROR', reason: String(err && err.message ? err.message : err) },
      result: 'execution threw', latencyMs: Date.now() - t0,
    });
    return { protocol: BRIDGE_PROTOCOL_VERSION, status: 'error', op, rule: 'EXECUTION_ERROR', reason: String(err && err.message ? err.message : err), ts };
  }

  // ---- 5. audit the allow + return through the bridge
  const summary = op === 'run_command'
    ? `executed ${request.args.binary} on sandbox-net — exit ${result.exitCode}`
    : op === 'read_file' ? `read ${result.bytes} bytes from workspace mount`
      : op === 'write_file' ? `wrote ${result.bytes} bytes into workspace mount`
        : op === 'report_result' ? 'result recorded on sandbox-net'
          : 'capability document returned';
  bridge.audit.append({
    ts, caller: request.caller, op, args: request.args, authenticated: true,
    decision: { status: 'ok', rule: null, reason: specific.reason },
    result: summary, latencyMs: Date.now() - t0,
  });
  return { protocol: BRIDGE_PROTOCOL_VERSION, status: 'ok', op, result, ts };
}

export default handleBridgeRequest;
