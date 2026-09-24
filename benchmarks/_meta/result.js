/**
 * JEXI OS — benchmarks/_meta/result.js
 *
 * Unified result envelope — the single shape every benchmark run
 * reports under. Normalizes the five scopes 11-15 raw report shapes
 * (gaia / swebench-pro / terminal-bench / webarena-verified / osworld)
 * into:
 *
 * {
 *   benchmark, adapterVersion, ranAt,   // ranAt: injected clock or null
 *   total, resolved, rate,
 *   perTask: [ { taskId, pass, tokens, durationMs, costUsd, status } ],
 *   manifestRef,                        // sha256 of the run manifest
 *   costUsed, costCap
 * }
 *
 * Consumption of the adapters is SHAPE-ONLY: this module imports
 * nothing from the adapter packages — raw reports arrive as plain
 * data, and the projection table below is the only place that knows
 * their field names. An unknown adapter, a missing row array or a row
 * that does not project cleanly is REFUSED (E_INVALID_ARGUMENT) with
 * the adapter named — never guessed, never silently reinterpreted.
 * If a future adapter shape does not fit this table: STOP and report.
 *
 * Per-adapter projection:
 *   gaia              perTask[i].task_id     pass    = perTask[i].pass
 *   swebench-pro      perInstance[i].instance_id     = perInstance[i].resolved
 *   terminal-bench    perTask[i].task_id     pass    = perTask[i].resolved
 *   webarena(-verified) perTask[i].task_id   pass    = perTask[i].passed
 *   osworld           perTask[i].task_id     pass    = perTask[i].rate === 1
 *                     (strict all-runs rule; the OSWorld headline
 *                      estimator passAt1 is the mean of per-task rates)
 *
 * adapterVersion resolution: explicit pin on the adapter argument
 * wins, then the raw report's own version field, then 'v1'.
 *
 * Task completeness: every projected task carries finite non-negative
 * tokens + durationMs + costUsd (the runner instrumentation supplies
 * them) — missing or malformed -> E_INCOMPLETE_TASK.
 *
 * status: 'EVALUATED' for scored tasks. meta.run marks tasks it never
 * completed under the cost cap as 'NOT_RUN' (pass false, zero usage) —
 * a NOT_RUN row never counts toward resolved.
 *
 * A result without a manifest is refused (E_NO_MANIFEST): every
 * unified result carries the sha256 of the manifest it ran under.
 * No wall-clock is read here — ranAt comes from the injected clock and
 * is deterministically null without one.
 */

import { SemanticaError } from '../../services/semantica/_internal.js';
import { resolveClock } from './manifest.js';

const WEBARENA_SHAPE = {
  rows: 'perTask',
  id: 'task_id',
  verdict: (row) => row.passed,
  verdictLabel: 'passed',
};

export const SHAPES = {
  gaia: {
    rows: 'perTask',
    id: 'task_id',
    verdict: (row) => row.pass,
    verdictLabel: 'pass',
  },
  'swebench-pro': {
    rows: 'perInstance',
    id: 'instance_id',
    verdict: (row) => row.resolved,
    verdictLabel: 'resolved',
  },
  'terminal-bench': {
    rows: 'perTask',
    id: 'task_id',
    verdict: (row) => row.resolved,
    verdictLabel: 'resolved',
  },
  webarena: WEBARENA_SHAPE,
  'webarena-verified': WEBARENA_SHAPE,
  osworld: {
    rows: 'perTask',
    id: 'task_id',
    verdict: (row) => {
      if (typeof row.rate !== 'number' || !Number.isFinite(row.rate)) return undefined;
      return row.rate === 1;
    },
    verdictLabel: 'rate === 1 (strict all-runs rule)',
  },
};

export const ADAPTER_NAMES = Object.keys(SHAPES);

export function resolveAdapter(adapter) {
  if (typeof adapter === 'string') {
    if (adapter.trim() === '') {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'meta.result: adapter must be a non-empty string or { name, version }');
    }
    return { name: adapter, version: null };
  }
  if (adapter && typeof adapter === 'object' && !Array.isArray(adapter)
      && typeof adapter.name === 'string' && adapter.name.trim() !== '') {
    if (adapter.version !== undefined && adapter.version !== null
        && (typeof adapter.version !== 'string' || adapter.version === '')) {
      throw new SemanticaError('E_INVALID_ARGUMENT', `meta.result: adapter.version must be a non-empty string, got ${JSON.stringify(adapter.version)}`);
    }
    return { name: adapter.name, version: adapter.version ?? null };
  }
  throw new SemanticaError('E_INVALID_ARGUMENT', `meta.result: adapter must be a non-empty string or { name, version }, got ${JSON.stringify(adapter)}`);
}

function readUsage(taskId, row) {
  const out = {};
  for (const field of ['tokens', 'durationMs', 'costUsd']) {
    const v = row[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new SemanticaError(
        'E_INCOMPLETE_TASK',
        `task ${taskId}: ${field} is missing or not a finite non-negative number — ` +
        'every unified task carries tokens + durationMs + costUsd (the runner instrumentation supplies them)',
      );
    }
    out[field] = v;
  }
  return out;
}

function projectRow(shape, row, index, adapterName) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.result: ${adapterName} row ${index} is not a plain object — raw shape incompatible, refusing`);
  }
  const rawId = row[shape.id];
  if (typeof rawId !== 'string' || rawId === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.result: ${adapterName} row ${index} carries no valid ${shape.id} (non-empty string required) — raw shape incompatible, refusing`);
  }
  const v = shape.verdict(row);
  if (typeof v !== 'boolean') {
    throw new SemanticaError(
      'E_INVALID_ARGUMENT',
      `meta.result: ${adapterName} row ${index} (${rawId}) projects no boolean verdict via ${shape.verdictLabel}, got ${JSON.stringify(v)} — raw shape incompatible, refusing`,
    );
  }
  return { taskId: rawId, pass: v, ...readUsage(rawId, row), status: 'EVALUATED' };
}

/**
 * buildEnvelope — the single constructor for the unified shape, used
 * by BOTH front doors (meta.result on a raw report, meta.run on a
 * live runner). Fixed key order keeps serialization byte-stable.
 */
export function buildEnvelope({ benchmark, adapterVersion, ranAt, rows, manifestRef, costCap = null }) {
  const total = rows.length;
  const resolved = rows.filter((r) => r.pass === true).length;
  const rate = total ? resolved / total : 0;
  const costUsed = rows.reduce((acc, r) => acc + r.costUsd, 0);
  return {
    benchmark,
    adapterVersion,
    ranAt,
    total,
    resolved,
    rate,
    perTask: rows.map((r) => ({
      taskId: r.taskId,
      pass: r.pass,
      tokens: r.tokens,
      durationMs: r.durationMs,
      costUsd: r.costUsd,
      status: r.status ?? 'EVALUATED',
    })),
    manifestRef,
    costUsed,
    costCap: costCap ?? null,
  };
}

/**
 * meta.result(adapter, raw, { manifest, clock?, cap? }) -> unifiedResult
 *
 * adapter: benchmark key (string) or { name, version } pin.
 * raw:     that benchmark's own report object (scopes 11-15 shape).
 * deps:    manifest — REQUIRED, the { manifest, sha256 } envelope from
 *          meta.manifest() (E_NO_MANIFEST without it); clock — injected
 *          (function or ISO-8601 string), null without one; cap — the
 *          per-run cost cap echoed into costCap (null when absent).
 */
export function normalizeResult(adapter, raw, deps = {}) {
  const d = deps ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.result: raw must be a plain object, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }
  const manifest = d.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || typeof manifest.sha256 !== 'string' || manifest.sha256 === '') {
    throw new SemanticaError(
      'E_NO_MANIFEST',
      'meta.result: every unified result carries a manifestRef — pass the { manifest, sha256 } envelope from meta.manifest() in deps.manifest',
    );
  }
  if (d.cap !== undefined && d.cap !== null
      && (typeof d.cap !== 'number' || !Number.isFinite(d.cap) || d.cap < 0)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.result: cap must be a finite non-negative number, got ${JSON.stringify(d.cap)}`);
  }

  const { name, version } = resolveAdapter(adapter);
  const shape = SHAPES[name];
  if (!shape) {
    throw new SemanticaError(
      'E_INVALID_ARGUMENT',
      `meta.result: unknown adapter ${JSON.stringify(name)} — the unified layer normalizes exactly: ${ADAPTER_NAMES.filter((k) => k !== 'webarena-verified').join(', ')}`,
    );
  }
  const rowsRaw = raw[shape.rows];
  if (!Array.isArray(rowsRaw)) {
    throw new SemanticaError(
      'E_INVALID_ARGUMENT',
      `meta.result: ${name} raw result must carry a ${shape.rows} array, got ${Array.isArray(rowsRaw) ? 'array' : typeof rowsRaw} — raw shape incompatible, refusing`,
    );
  }

  const adapterVersion = version ?? (typeof raw.version === 'string' && raw.version !== '' ? raw.version : 'v1');
  const benchmark = typeof raw.benchmark === 'string' && raw.benchmark !== '' ? raw.benchmark : name;
  const rows = rowsRaw.map((row, i) => projectRow(shape, row, i, name));

  return buildEnvelope({
    benchmark,
    adapterVersion,
    ranAt: resolveClock(d.clock ?? null),
    rows,
    manifestRef: manifest.sha256,
    costCap: d.cap ?? null,
  });
}
