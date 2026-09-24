/**
 * JEXI OS — benchmarks/_meta/trace.js
 *
 * Per-task trace capture for the unified layer: input, tool calls,
 * output, tokens, duration, cost.
 *
 *   meta.trace({ runId, adapter, tracePath? }) ->
 *     { record(task, { input, toolCalls, output, tokens, durationMs, costUsd }),
 *       flush() -> { path, tasks, bytes? } }
 *
 * Sinks: memory by default (flush resolves { path: null }); when a
 * tracePath is provided the flush writes ONE deterministic JSON
 * document — canonical (recursively key-sorted) bytes, trailing
 * newline, parent dirs created. Same runId + same records => the file
 * is byte-identical across runs, so a trace diff is a behavior diff.
 *
 * Completeness mirrors the unified-result rule: every recorded task
 * carries finite non-negative tokens + durationMs + costUsd — missing
 * or malformed -> E_INCOMPLETE_TASK (a trace missing spend data is not
 * a trace). NOT_RUN tasks have no record — the sink only ever holds
 * tasks that actually completed under the cap.
 *
 * The only I/O in _meta is THIS declared disk sink.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson } from './manifest.js';
import { SemanticaError } from '../../services/semantica/_internal.js';

export function createTrace({ runId, adapter, tracePath = null } = {}) {
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.trace: runId must be a non-empty string, got ${JSON.stringify(runId)}`);
  }
  if (typeof adapter !== 'string' || adapter.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.trace: adapter must be a non-empty string, got ${JSON.stringify(adapter)}`);
  }
  if (tracePath !== null && typeof tracePath !== 'string') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.trace: tracePath must be a string (disk sink) or null (memory sink), got ${typeof tracePath}`);
  }

  const tasks = [];

  return {
    record(task, fields = {}) {
      if (typeof task !== 'string' || task.trim() === '') {
        throw new SemanticaError('E_INVALID_ARGUMENT', `meta.trace.record: task id must be a non-empty string, got ${JSON.stringify(task)}`);
      }
      const f = fields ?? {};
      if (typeof f !== 'object' || Array.isArray(f)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', `meta.trace.record: fields must be a plain object, got ${Array.isArray(f) ? 'array' : typeof f}`);
      }
      const toolCalls = f.toolCalls ?? [];
      if (!Array.isArray(toolCalls)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', `meta.trace.record: task ${task} toolCalls must be an array, got ${typeof f.toolCalls}`);
      }
      for (const field of ['tokens', 'durationMs', 'costUsd']) {
        const v = f[field];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          throw new SemanticaError(
            'E_INCOMPLETE_TASK',
            `meta.trace.record: task ${task} is missing a valid ${field} (finite non-negative number required) — ` +
            'every task carries tokens + durationMs + costUsd',
          );
        }
      }
      tasks.push({
        taskId: task,
        input: f.input ?? null,
        toolCalls,
        output: f.output ?? null,
        tokens: f.tokens,
        durationMs: f.durationMs,
        costUsd: f.costUsd,
      });
      return tasks.length;
    },

    async flush() {
      const doc = { adapter, runId, tasks };
      if (tracePath === null) {
        return { path: null, tasks: tasks.length };
      }
      const bytes = Buffer.from(`${canonicalJson(doc)}\n`, 'utf8');
      await mkdir(dirname(tracePath), { recursive: true });
      await writeFile(tracePath, bytes);
      return { path: tracePath, tasks: tasks.length, bytes: bytes.length };
    },
  };
}
