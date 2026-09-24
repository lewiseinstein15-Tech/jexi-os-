/** JEXI OS — Phase 30 Scope F — bounded PermissionDenied retry lifecycle. */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import approvals from '../../../interfaces/ui/web/console/chat/approvals.js';
import hooks, { HOOK_CATALOG } from '../hooks/index.js';

const MAX_RETRIES = 1;
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const safeError = (error) => ({
  name: error?.name ?? 'Error',
  code: error?.code ?? null,
  message: error?.message ?? String(error),
});

function catalogSpec() {
  const runtime = hooks.get('PermissionDenied');
  const declared = HOOK_CATALOG.find((entry) => entry.event === 'PermissionDenied');
  return {
    event: runtime.event,
    lifecycle: runtime.lifecycle,
    matcher: runtime.matcher,
    timeout: runtime.timeout,
    declaredReturn: declared?.declaredReturn ?? null,
  };
}

function approvalSnapshot(error) {
  if (error?.code !== 'E_APPROVAL_DENIED' || typeof error.approvalId !== 'string') return null;
  try {
    const state = approvals.status(error.approvalId);
    return {
      approvalId: state.approvalId,
      status: state.status,
      decision: state.decision ?? null,
      action: state.action ?? error.action ?? null,
    };
  } catch {
    return {
      approvalId: error.approvalId,
      status: 'denied',
      decision: 'no',
      action: error.action ?? null,
    };
  }
}

function fail(code, message) {
  return new SemanticaError(code, message);
}

export function createPermissionDenied() {
  let handler = null;
  let handlerCalls = 0;
  const retries = new Map();

  function register(next) {
    if (typeof next !== 'function') throw fail('E_INVALID_LIFECYCLE_HANDLER', 'PermissionDenied handler must be a function');
    handler = next;
    return { registered: true };
  }

  function decide(request = {}) {
    const approval = approvalSnapshot(request.error);
    const requestId = request.requestId ?? approval?.approvalId;
    if (typeof requestId !== 'string' || requestId.trim() === '') {
      throw fail('E_INVALID_PERMISSION_REQUEST', 'PermissionDenied requestId must be a non-empty string');
    }
    const retryCount = retries.get(requestId) ?? 0;
    const event = {
      event: 'PermissionDenied',
      requestId,
      action: request.action ?? approval?.action ?? request.error?.action ?? null,
      retryCount,
      approval,
      catalog: catalogSpec(),
    };

    if (!handler) {
      return {
        requestId,
        denied: true,
        retry: false,
        retryCount,
        hardDeny: true,
        reason: 'permission denied by default',
        fallback: 'deny',
        handlerCalls,
        approval,
      };
    }

    let contract;
    try {
      handlerCalls += 1;
      contract = handler(clone(event));
      if (contract && typeof contract.then === 'function') {
        Promise.resolve(contract).catch(() => {});
        throw fail('E_INVALID_HOOK_RETURN', 'PermissionDenied handlers must be synchronous');
      }
      if (!contract || typeof contract !== 'object' || Array.isArray(contract)
        || (contract.retry !== undefined && typeof contract.retry !== 'boolean')) {
        throw fail('E_INVALID_HOOK_RETURN', 'PermissionDenied handler must return { retry?: boolean }');
      }
    } catch (error) {
      return {
        requestId,
        denied: true,
        retry: false,
        retryCount,
        hardDeny: true,
        reason: 'PermissionDenied hook error; denied by default',
        fallback: 'deny',
        handlerCalls,
        approval,
        error: safeError(error),
      };
    }

    if (contract.retry === true && retryCount < MAX_RETRIES) {
      const nextCount = retryCount + 1;
      retries.set(requestId, nextCount);
      return {
        requestId,
        denied: true,
        retry: true,
        retryCount: nextCount,
        hardDeny: false,
        reason: 'retry permitted',
        handlerCalls,
        approval,
      };
    }
    if (contract.retry === true) {
      return {
        requestId,
        denied: true,
        retry: false,
        retryCount,
        hardDeny: true,
        reason: `retry limit reached (max ${MAX_RETRIES})`,
        fallback: 'deny',
        handlerCalls,
        approval,
      };
    }
    return {
      requestId,
      denied: true,
      retry: false,
      retryCount,
      hardDeny: true,
      reason: 'permission denied',
      fallback: 'deny',
      handlerCalls,
      approval,
    };
  }

  async function handle(request, { retry } = {}) {
    const decision = decide(request);
    if (!decision.retry) return { ...decision, retried: false };
    if (typeof retry !== 'function') return { ...decision, retried: false };
    try {
      const retryResult = await retry(clone(request), clone(decision));
      return { ...decision, retried: true, retryResult: clone(retryResult) };
    } catch (error) {
      return {
        ...decision,
        retry: false,
        hardDeny: true,
        retried: true,
        reason: 'retry execution failed; denied by default',
        fallback: 'deny',
        error: safeError(error),
      };
    }
  }

  function reset() {
    handler = null;
    handlerCalls = 0;
    retries.clear();
    return { reset: true };
  }

  return Object.freeze({ register, decide, handle, reset });
}

export const PermissionDenied = createPermissionDenied();
export default PermissionDenied;
