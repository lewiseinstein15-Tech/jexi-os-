/**
 * JEXI OS — Phase 8 Scope E — CROSS-NETWORK AUDIT LOG.
 *
 * Every call that crosses the network boundary is logged — allow or refuse,
 * both directions. JSONL, append-only, one JSON object per line:
 *
 *   { seq, ts, direction, caller, op, args, authenticated, decision, result, latencyMs }
 *
 * Args are REDACTED before they hit disk: credential-shaped keys
 * (token/secret/password/key/cred/auth/cookie/session) become [REDACTED],
 * long values are truncated. The log is the evidence that NOTHING crossed
 * the boundary except the allowlisted ops.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Keys whose values never touch the audit log in the clear. */
export const REDACT_KEY_PATTERN = /(pass|pwd|secret|token|api[-_]?key|^key$|cred|auth|cookie|session)/i;

const MAX_VALUE_LENGTH = 256;

function redactValue(v) {
  if (typeof v === 'string') {
    return v.length > MAX_VALUE_LENGTH ? `${v.slice(0, MAX_VALUE_LENGTH)}…[truncated ${v.length} chars]` : v;
  }
  if (Array.isArray(v)) return v.slice(0, 32).map(redactValue);
  if (v && typeof v === 'object') return redactArgs(v);
  return v;
}

/** Deep-clone + redact credential-shaped keys + truncate long values. */
export function redactArgs(args) {
  if (args === undefined || args === null) return args;
  if (typeof args !== 'object') return redactValue(args);
  const out = Array.isArray(args) ? [] : {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = REDACT_KEY_PATTERN.test(k) ? '[REDACTED]' : redactValue(v);
  }
  return out;
}

export class AuditLog {
  /**
   * @param {object} o
   * @param {string} o.file   absolute JSONL path
   * @param {string} [o.source] label written on every entry (e.g. 'exec-bridge')
   */
  constructor({ file, source = 'audit' }) {
    if (!file || !path.isAbsolute(file)) throw new Error(`AuditLog: absolute file path required — got ${JSON.stringify(file)}`);
    this.file = file;
    this.source = source;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this._seq = this.count();
  }

  /** Number of entries already on disk (also seeds the seq counter). */
  count() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return raw.split('\n').filter((l) => l.trim()).length;
    } catch {
      return 0;
    }
  }

  /**
   * Append one entry. Missing fields are defaulted; `args` is redacted here
   * so callers cannot forget. Returns the stored entry.
   */
  append(entry) {
    this._seq += 1;
    const record = {
      seq: this._seq,
      ts: entry.ts || new Date().toISOString(),
      source: this.source,
      direction: entry.direction || 'jexi-net -> sandbox-net',
      caller: entry.caller ?? null,
      op: entry.op ?? null,
      args: redactArgs(entry.args),
      authenticated: Boolean(entry.authenticated),
      decision: entry.decision || null,      // { status, rule, reason }
      result: entry.result ?? null,          // summary only (never raw payloads)
      latencyMs: entry.latencyMs ?? null,
    };
    fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`);
    return record;
  }

  /** Read entries (oldest first); `tail` limits to the last N. */
  read({ tail = 0 } = {}) {
    let raw = '';
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    const lines = raw.split('\n').filter((l) => l.trim());
    const slice = tail > 0 ? lines.slice(-tail) : lines;
    return slice.map((l) => JSON.parse(l));
  }

  stats() {
    const entries = this.read();
    return {
      file: this.file,
      total: entries.length,
      allowed: entries.filter((e) => e.decision && e.decision.status === 'ok').length,
      refused: entries.filter((e) => e.decision && e.decision.status === 'refused').length,
      unauthenticated: entries.filter((e) => e.decision && e.decision.rule === 'UNAUTHENTICATED').length,
    };
  }
}

export default AuditLog;
