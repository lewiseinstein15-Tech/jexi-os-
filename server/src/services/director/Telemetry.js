/**
 * B208 — TEAM TELEMETRY: observed performance of employees and models.
 *
 * This is ADAPTIVE ORCHESTRATION, not learning/training: we record what
 * actually happened (success, duration, verification verdicts, provider
 * failures) and bias future selection/routing with it. No weights change;
 * no claim of self-training is made anywhere.
 *
 * Two levels:
 *   employee:<agentId>  success rate, avg duration, verification pass rate
 *   provider:<name>     success rate, avg latency (per ModelRouter attempt)
 *
 * Persisted to data/director-telemetry.json (bounded: per-key rolling stats).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(HERE, '..', '..', '..', 'data', 'director-telemetry.json');

const MAX_SAMPLES = 200; // rolling window per key

class Telemetry {
  constructor() {
    this.stats = {};
    this._load();
  }

  _load() {
    try { this.stats = JSON.parse(fs.readFileSync(STORE, 'utf-8')) || {}; }
    catch { this.stats = {}; }
  }

  _flush() {
    try {
      fs.mkdirSync(path.dirname(STORE), { recursive: true });
      fs.writeFileSync(STORE + '.tmp', JSON.stringify(this.stats));
      fs.renameSync(STORE + '.tmp', STORE); // atomic-ish
    } catch { /* telemetry must never break execution */ }
  }

  _key(kind, id) {
    const k = `${kind}:${String(id || '').toLowerCase()}`;
    if (!this.stats[k]) this.stats[k] = { samples: 0, success: 0, totalMs: 0, verifyPass: 0, verifyTotal: 0, lastFailure: null };
    return k;
  }

  /** Record a finished assignment (or provider call). */
  record(kind, id, { ok, ms, verify } = {}) {
    const k = this._key(kind, id);
    const s = this.stats[k];
    s.samples += 1;
    if (s.samples > MAX_SAMPLES) { // decay: fold the window instead of growing forever
      s.samples = Math.ceil(MAX_SAMPLES / 2);
      s.success = Math.ceil(s.success / 2);
      s.totalMs = Math.ceil(s.totalMs / 2);
      s.verifyPass = Math.ceil(s.verifyPass / 2);
      s.verifyTotal = Math.ceil(s.verifyTotal / 2);
    }
    if (ok) s.success += 1;
    else s.lastFailure = new Date().toISOString();
    if (Number.isFinite(ms) && ms > 0) s.totalMs += ms;
    if (verify === 'pass' || verify === true) { s.verifyPass += 1; s.verifyTotal += 1; }
    else if (verify === 'fail' || verify === false) { s.verifyTotal += 1; }
    this._flush();
    return s;
  }

  employeeStats(agentId) {
    const s = this.stats[`employee:${String(agentId).toLowerCase()}`];
    if (!s || !s.samples) return { samples: 0, successRate: 0.5, avgMs: 0, verifyPassRate: null };
    return {
      samples: s.samples,
      successRate: s.success / s.samples,
      avgMs: Math.round(s.totalMs / s.samples),
      verifyPassRate: s.verifyTotal ? s.verifyPass / s.verifyTotal : null,
    };
  }

  providerStats(provider) {
    const s = this.stats[`provider:${String(provider || '').toLowerCase()}`];
    if (!s || !s.samples) return { samples: 0, successRate: 0.5, avgMs: 0 };
    return { samples: s.samples, successRate: s.success / s.samples, avgMs: Math.round(s.totalMs / s.samples) };
  }

  /** Reliability-adjusted preference order for a set of providers (data-driven failover bias). */
  rankProviders(providers) {
    // reliability first, then observed latency (B208b: latency-aware routing)
    return [...(providers || [])].sort((a, b) => {
      const sa = this.providerStats(a);
      const sb = this.providerStats(b);
      return (sb.successRate - sa.successRate) || ((sa.avgMs || 0) - (sb.avgMs || 0));
    });
  }

  snapshot() { return JSON.parse(JSON.stringify(this.stats)); }

  /** Test hook — wipe recorded stats. */
  reset() { this.stats = {}; try { fs.unlinkSync(STORE); } catch { /* absent is fine */ } }
}

export const telemetry = new Telemetry();
