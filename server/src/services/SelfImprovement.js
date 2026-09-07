/**
 * ARENA ASTRA REBUILD — Self-Improvement (spec Part 23).
 *
 *   telemetry → anomaly → diagnosis → reproduction → research →
 *   experiment → benchmark → sandbox → regression test → validation → promotion
 *
 * SAFETY CONTRACT (non-negotiable):
 * - JEXI NEVER silently modifies production architecture.
 * - Every stage is recorded (proposal ledger) and observable.
 * - Promotion requires explicit human approval (Lewis says so, or an
 *   approved auto-promotion policy for low-risk tiers only).
 * - Experiments run in a sandbox workspace, never in prod paths.
 *
 * This module implements the pipeline SHAPE with honest stage tracking.
 * Detection/diagnosis helpers are deterministic; deep analysis reuses the
 * existing Lessons/SelfMonitor stores.
 */

import fs from 'node:fs';
import path from 'node:path';
import { emit } from './Observer.js';

export const SI_STAGES = [
  'telemetry', 'anomaly', 'diagnosis', 'reproduction', 'research',
  'experiment', 'benchmark', 'sandbox', 'regression', 'validation', 'promotion',
];

const proposals = new Map(); // id → proposal
let seq = 0;

/** Open a new improvement proposal from an observed anomaly. */
export function propose({ title, anomaly = '', evidence = null, risk = 'low' } = {}) {
  if (!title || !String(title).trim()) throw new Error('proposal needs a title');
  const id = `si-${Date.now().toString(36)}-${String(++seq).padStart(3, '0')}`;
  const p = {
    id,
    title: String(title).slice(0, 200),
    anomaly: String(anomaly).slice(0, 1000),
    evidence: evidence ?? null,
    risk: ['low', 'medium', 'high'].includes(risk) ? risk : 'low',
    stage: 'telemetry',
    history: [{ stage: 'telemetry', t: new Date().toISOString(), note: 'proposal opened' }],
    status: 'open',
    approvedBy: null,
    createdAt: new Date().toISOString(),
  };
  proposals.set(id, p);
  emit('improve.proposed', { actor: 'SelfImprovement', summary: p.title, data: { id, risk: p.risk } });
  return p;
}

/** Advance a proposal one stage (forward-only, recorded). */
export function advance(id, note = '') {
  const p = proposals.get(id);
  if (!p) throw new Error('unknown proposal');
  if (p.status !== 'open') throw new Error(`proposal is ${p.status}`);
  const i = SI_STAGES.indexOf(p.stage);
  if (p.stage === 'promotion') throw new Error('already at promotion — approve() or reject() it');
  p.stage = SI_STAGES[i + 1];
  p.history.push({ stage: p.stage, t: new Date().toISOString(), note: String(note).slice(0, 500) });
  emit('improve.advanced', { actor: 'SelfImprovement', summary: `${p.title} → ${p.stage}`, data: { id, stage: p.stage } });
  return p;
}

/** Human approval gate. Only approved proposals may promote. */
export function approve(id, by = 'Lewis') {
  const p = proposals.get(id);
  if (!p) throw new Error('unknown proposal');
  p.approvedBy = String(by).slice(0, 120);
  p.history.push({ stage: p.stage, t: new Date().toISOString(), note: `approved by ${p.approvedBy}` });
  emit('improve.approved', { actor: 'SelfImprovement', summary: `${p.title} approved by ${p.approvedBy}`, data: { id } });
  return p;
}

export function reject(id, reason = '') {
  const p = proposals.get(id);
  if (!p) throw new Error('unknown proposal');
  p.status = 'rejected';
  p.history.push({ stage: p.stage, t: new Date().toISOString(), note: `rejected: ${String(reason).slice(0, 300)}` });
  emit('improve.rejected', { actor: 'SelfImprovement', summary: p.title, data: { id } });
  return p;
}

/**
 * Promote: ONLY from validation stage + human approval. The `apply` callback
 * performs the actual change (in prod code paths, that means opening a PR /
 * writing a patch file for review — never a silent overwrite).
 */
export async function promote(id, apply) {
  const p = proposals.get(id);
  if (!p) throw new Error('unknown proposal');
  if (p.status !== 'open') throw new Error(`proposal is ${p.status}`);
  if (p.stage !== 'validation') throw new Error('promotion requires reaching the validation stage first');
  if (!p.approvedBy) throw new Error('promotion requires human approval');
  if (typeof apply !== 'function') throw new Error('promotion needs an apply() step');
  const result = await apply(p);
  p.stage = 'promotion';
  p.status = 'promoted';
  p.history.push({ stage: 'promotion', t: new Date().toISOString(), note: 'promoted' });
  emit('improve.promoted', { actor: 'SelfImprovement', summary: p.title, data: { id } });
  return { proposal: p, result };
}

/** Deterministic anomaly scan over recent observer events (no model). */
export function scanAnomalies(events = []) {
  const anomalies = [];
  const fails = events.filter((e) => /(\.failed|failure)/.test(e.type));
  const byType = {};
  for (const f of fails) byType[f.type] = (byType[f.type] || 0) + 1;
  for (const [type, n] of Object.entries(byType)) {
    if (n >= 3) anomalies.push({ kind: 'repeated-failure', detail: `${n}× ${type} in the recent window`, count: n, type });
  }
  const models = events.filter((e) => e.type === 'model.failed');
  if (models.length >= 5) anomalies.push({ kind: 'provider-distress', detail: `${models.length} model failures recently — ladder may be degraded`, count: models.length });
  return anomalies;
}

export function listProposals() {
  return [...proposals.values()];
}

export function _reset() {
  proposals.clear();
}

export const SelfImprovement = { propose, advance, approve, reject, promote, scanAnomalies, listProposals, SI_STAGES };
void fs;
void path;
