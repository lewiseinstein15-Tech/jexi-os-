/**
 * JEXI OS — Phase 16 Scope G — Approval Gating
 *
 * Pattern: approval requests render as amber card that blocks caller until user answers y/n/a.
 * Approve-with-edits opens editor, captures diff, resumes with edits applied. No polling, no silent pass-through.
 *
 * Contract:
 *  approvals.request(turnId, { action, payload, sessionId? }) -> Promise that blocks until resolved
 *    returns { approvalId, status: 'pending' } initially, then resolves to final result
 *  approvals.resolve(approvalId, decision) -> { approvalId, decision, edits? }
 *    decision: 'yes' | 'no' | 'always' | { edits }
 *  approvals.status(approvalId) -> { approvalId, status, decision?, resolvedAt? }
 *  approvals.pending(sessionId?) -> list of open approvals
 *
 * Rules:
 *  - request() truly blocks calling flow (real await)
 *  - 'yes' -> proceeds with original payload
 *  - 'no' -> E_APPROVAL_DENIED with action name
 *  - 'always' -> same action auto-approves remainder of session, per-session not global
 *  - { edits } -> proceeds with edits substituted, original NOT mutated
 *  - emits approval.requested and approval.resolved events validated via Scope A taxonomy
 */

import { taxonomy } from '../../../../events/chat/taxonomy.js';

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

let counter = 1;
const approvalsMap = new Map(); // approvalId -> entry
const resolvedCache = new Map(); // approvalId -> resolved entry (for double resolve detection)
const alwaysMap = new Map(); // sessionId -> Set(action)
const emittedEvents = []; // for probe verification

function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function generateApprovalId(action) {
  const safeAction = (action || 'action').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30);
  return `appr_${counter++}_${safeAction}`;
}

function emitRequested({ approvalId, action, sessionId }) {
  const event = {
    type: 'approval.requested',
    version: 1,
    ts: new Date().toISOString(),
    sessionId: sessionId || 'default-session',
    agentId: 'agent-root',
    payload: {
      approvalId,
      reason: action,
      options: ['yes', 'no', 'always'],
    },
  };
  const v = taxonomy.validate(event);
  if (!v.valid) {
    throw fail('E_INVALID_EVENT', `approval.requested invalid: ${JSON.stringify(v.errors)}`);
  }
  emittedEvents.push(event);
  return event;
}

function emitResolved({ approvalId, decision, sessionId }) {
  let taxonomyDecision = 'approved';
  if (decision === 'no') taxonomyDecision = 'rejected';
  else if (decision === 'always') taxonomyDecision = 'approved';
  else if (typeof decision === 'object' && decision !== null) {
    // edits object -> approved
    taxonomyDecision = 'approved';
  } else if (decision === 'yes') {
    taxonomyDecision = 'approved';
  }

  const event = {
    type: 'approval.resolved',
    version: 1,
    ts: new Date().toISOString(),
    sessionId: sessionId || 'default-session',
    agentId: 'agent-root',
    payload: {
      approvalId,
      decision: taxonomyDecision,
      resolver: 'user',
    },
  };
  const v = taxonomy.validate(event);
  if (!v.valid) {
    throw fail('E_INVALID_EVENT', `approval.resolved invalid: ${JSON.stringify(v.errors)}`);
  }
  emittedEvents.push(event);
  return event;
}

export function request(turnId, opts = {}) {
  if (!turnId || typeof turnId !== 'string') {
    throw fail('E_UNKNOWN_TURN', 'turnId is required');
  }

  const action = opts.action || opts.reason;
  if (!action || typeof action !== 'string') {
    throw fail('E_UNKNOWN_APPROVAL', 'action is required for approval request');
  }

  const sessionId = opts.sessionId || turnId || 'default-session';
  const originalPayload = deepClone(opts.payload);

  // Check always auto-approve per-session
  const alwaysSet = alwaysMap.get(sessionId);
  if (alwaysSet && alwaysSet.has(action)) {
    const approvalId = generateApprovalId(action);
    emitRequested({ approvalId, action, sessionId });
    emitResolved({ approvalId, decision: 'always', sessionId });

    const autoResult = {
      approvalId,
      status: 'approved',
      decision: 'always',
      payload: originalPayload,
      autoApproved: true,
    };

    // Store as resolved for determinism
    const entry = {
      approvalId,
      turnId,
      action,
      payload: originalPayload,
      originalPayload,
      status: 'approved',
      decision: 'always',
      sessionId,
      resolvedAt: new Date().toISOString(),
      autoApproved: true,
    };
    resolvedCache.set(approvalId, entry);

    // Return immediately resolved promise with approvalId attached
    const p = Promise.resolve(autoResult);
    p.approvalId = approvalId;
    p.status = 'approved';
    return p;
  }

  const approvalId = generateApprovalId(action);

  let resolveFn, rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const entry = {
    approvalId,
    turnId,
    action,
    payload: originalPayload,
    originalPayload,
    status: 'pending',
    decision: null,
    sessionId,
    createdAt: new Date().toISOString(),
    _resolve: resolveFn,
    _reject: rejectFn,
    promise,
  };

  approvalsMap.set(approvalId, entry);
  emitRequested({ approvalId, action, sessionId });

  // The promise that will be resolved by resolve()
  const blockingPromise = new Promise((resolve, reject) => {
    entry._resolveOuter = resolve;
    entry._rejectOuter = reject;

    // When inner promise (decision) resolves, we translate to final result or error
    promise
      .then((decision) => {
        // Handle decision
        if (decision === 'no') {
          const err = fail('E_APPROVAL_DENIED', `Approval denied for action: ${action}`);
          err.action = action;
          err.approvalId = approvalId;
          reject(err);
        } else if (decision === 'yes') {
          resolve({
            approvalId,
            status: 'approved',
            decision: 'yes',
            payload: originalPayload,
          });
        } else if (decision === 'always') {
          // Store always per session
          if (!alwaysMap.has(sessionId)) alwaysMap.set(sessionId, new Set());
          alwaysMap.get(sessionId).add(action);
          resolve({
            approvalId,
            status: 'approved',
            decision: 'always',
            payload: originalPayload,
          });
        } else if (typeof decision === 'object' && decision !== null && decision.edits) {
          const editedPayload = { ...deepClone(originalPayload), ...deepClone(decision.edits) };
          resolve({
            approvalId,
            status: 'approved',
            decision,
            payload: editedPayload,
            edits: decision.edits,
            originalPayload,
          });
        } else if (typeof decision === 'object' && decision !== null) {
          // Generic edits object without wrapper? Treat as edits
          const editedPayload = { ...deepClone(originalPayload), ...deepClone(decision) };
          resolve({
            approvalId,
            status: 'approved',
            decision,
            payload: editedPayload,
            edits: decision,
            originalPayload,
          });
        } else {
          // Unknown decision treated as yes
          resolve({
            approvalId,
            status: 'approved',
            decision,
            payload: originalPayload,
          });
        }
      })
      .catch((e) => {
        reject(e);
      });
  });

  // Attach approvalId to promise for caller to get it while pending
  blockingPromise.approvalId = approvalId;
  blockingPromise.status = 'pending';

  return blockingPromise;
}

export function resolve(approvalId, decision) {
  if (!approvalId || typeof approvalId !== 'string') {
    throw fail('E_UNKNOWN_APPROVAL', 'approvalId is required');
  }

  // Check if already resolved
  if (resolvedCache.has(approvalId)) {
    throw fail('E_ALREADY_RESOLVED', `Approval ${approvalId} already resolved`);
  }

  const entry = approvalsMap.get(approvalId);
  if (!entry) {
    throw fail('E_UNKNOWN_APPROVAL', `Unknown approvalId: ${approvalId}`);
  }

  if (entry.status !== 'pending') {
    throw fail('E_ALREADY_RESOLVED', `Approval ${approvalId} already resolved`);
  }

  // Validate decision
  const isValidString = ['yes', 'no', 'always'].includes(decision);
  const isEditsObject = typeof decision === 'object' && decision !== null;
  if (!isValidString && !isEditsObject) {
    throw fail('E_UNKNOWN_APPROVAL', `Invalid decision: ${decision}`);
  }

  entry.status = 'resolved';
  entry.decision = decision;
  entry.resolvedAt = new Date().toISOString();

  emitResolved({ approvalId, decision, sessionId: entry.sessionId });

  // Move to resolved cache
  approvalsMap.delete(approvalId);
  resolvedCache.set(approvalId, entry);

  // Resolve the inner promise that request() is waiting on
  if (entry._resolve) {
    entry._resolve(decision);
  }

  // Return result
  const result = {
    approvalId,
    decision,
  };
  if (isEditsObject) {
    result.edits = decision.edits || decision;
  }
  return result;
}

export function status(approvalId) {
  if (!approvalId || typeof approvalId !== 'string') {
    throw fail('E_UNKNOWN_APPROVAL', 'approvalId is required');
  }

  const pending = approvalsMap.get(approvalId);
  if (pending) {
    return {
      approvalId,
      status: 'pending',
      action: pending.action,
      turnId: pending.turnId,
      sessionId: pending.sessionId,
    };
  }

  const resolved = resolvedCache.get(approvalId);
  if (resolved) {
    return {
      approvalId,
      status: resolved.status === 'approved' ? 'approved' : 'resolved',
      decision: resolved.decision,
      resolvedAt: resolved.resolvedAt,
      action: resolved.action,
    };
  }

  throw fail('E_UNKNOWN_APPROVAL', `Unknown approvalId: ${approvalId}`);
}

export function pending(sessionId) {
  const allPending = [...approvalsMap.values()].filter(e => e.status === 'pending');
  if (sessionId) {
    return allPending
      .filter(e => e.sessionId === sessionId)
      .map(e => ({
        approvalId: e.approvalId,
        action: e.action,
        turnId: e.turnId,
        sessionId: e.sessionId,
        status: 'pending',
      }));
  }
  return allPending.map(e => ({
    approvalId: e.approvalId,
    action: e.action,
    turnId: e.turnId,
    sessionId: e.sessionId,
    status: 'pending',
  }));
}

export function _reset() {
  approvalsMap.clear();
  resolvedCache.clear();
  alwaysMap.clear();
  emittedEvents.length = 0;
  counter = 1;
}

export function _emitted() {
  return [...emittedEvents];
}

export const approvals = {
  request,
  resolve,
  status,
  pending,
  _reset,
  _emitted,
};

export default approvals;
