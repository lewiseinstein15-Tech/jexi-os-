/**
 * ARENA ASTRA REBUILD — Recovery (spec Part 22).
 *
 * When something fails: diagnose → safe retry → verify. On repeated
 * failure: replan (never repeat the same failed action endlessly).
 *
 *   attempt(fn)            bounded retries with backoff + diagnosis
 *   recoverWorkItem(graph) requeue-or-replan decision for a failed work item
 *
 * Bounded by default (3 attempts, exponential backoff). Every step emits
 * Observer events so Lewis SEES the recovery, honestly.
 */

import { emit } from './Observer.js';

const DEFAULTS = { attempts: 3, baseBackoffMs: 800, maxBackoffMs: 8000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Classify a failure into a recovery action (deterministic, no model). */
export function diagnose(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (/abort|timeout|timed out|etimedout|econnreset|enotfound|eai_again|503|502|504|rate.?limit|429|overloaded/i.test(msg)) {
    return { kind: 'transient', retry: true, reason: 'transient/network/provider failure — safe to retry' };
  }
  if (/enoent|not found|404|missing/i.test(msg)) {
    return { kind: 'missing', retry: false, reason: 'missing resource — retrying the same call cannot help; replan instead' };
  }
  if (/eacces|eperm|permission|denied|forbidden|401|403/i.test(msg)) {
    return { kind: 'permission', retry: false, reason: 'permission failure — needs authorization, not retries' };
  }
  if (/syntax|typeerror|referenceerror|validation|invalid|bad request|400/i.test(msg)) {
    return { kind: 'bug', retry: false, reason: 'looks like a bug in the request itself — fix, then retry once' };
  }
  return { kind: 'unknown', retry: true, reason: 'unclassified — one cautious retry, then replan' };
}

/**
 * Run `fn` with the recovery ladder. Returns { ok, value?, error?, attempts, diagnosis }.
 * Never throws for fn failures (only for programmer errors like missing fn).
 */
export async function attempt(fn, opts = {}) {
  if (typeof fn !== 'function') throw new Error('attempt needs a function');
  const { attempts = DEFAULTS.attempts, baseBackoffMs = DEFAULTS.baseBackoffMs, maxBackoffMs = DEFAULTS.maxBackoffMs, missionId = null, taskId = null, label = 'op' } = opts;
  let lastError = null;
  let diagnosis = null;
  for (let i = 1; i <= Math.max(1, attempts); i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const value = await fn(i);
      if (i > 1) emit('work.retried', { missionId, taskId, actor: 'Recovery', summary: `${label} recovered on attempt ${i}` });
      return { ok: true, value, attempts: i, diagnosis };
    } catch (e) {
      lastError = e;
      diagnosis = diagnose(e);
      emit('work.failed', { missionId, taskId, actor: 'Recovery', summary: `${label} attempt ${i} failed: ${String(e?.message || e).slice(0, 160)}`, data: { diagnosis: diagnosis.kind } });
      const canRetry = diagnosis.retry && i < attempts;
      const cautiousOnce = diagnosis.kind === 'unknown' && i === 1 && attempts > 1;
      if (!canRetry && !cautiousOnce) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(maxBackoffMs, baseBackoffMs * 2 ** (i - 1)));
    }
  }
  return { ok: false, error: lastError, attempts, diagnosis };
}

/**
 * Decide what to do with a FAILED work item: requeue (transient) or flag
 * for replan (structural). Applies the decision to the graph honestly.
 */
export async function recoverWorkItem(graph, itemId, error) {
  const diagnosis = diagnose(error);
  const item = graph?.items?.find?.((x) => x.id === itemId) || { id: itemId };
  const retries = Number(item.retryCount || 0);
  if (diagnosis.retry && retries < 2) {
    try { graph.retry?.(itemId); } catch {}
    emit('replan.retry', { missionId: graph?.missionId, taskId: itemId, actor: 'Recovery', summary: `requeued (${diagnosis.kind})`, data: { diagnosis: diagnosis.kind } });
    return { action: 'requeued', diagnosis };
  }
  emit('replan.started', { missionId: graph?.missionId, taskId: itemId, actor: 'Recovery', summary: `needs replan: ${diagnosis.reason}`, data: { diagnosis: diagnosis.kind } });
  return { action: 'replan', diagnosis };
}

export const Recovery = { attempt, diagnose, recoverWorkItem };
