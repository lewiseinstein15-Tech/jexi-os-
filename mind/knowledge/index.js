/**
 * JEXI OS — Phase 8 Scope C — KNOWLEDGE (facade).
 *
 * Decepticon-pattern attack chain on JEXI storage. THE RULE: findings
 * persist to the graph, not agent memory; agents and pipeline phases query
 * the graph for context; the graph survives process death (SQLite, WAL).
 *
 * This module is the minimal skeleton Phase 15 (knowledge subsystem) will
 * expand — the attack-chain graph ships first because the Phase 8 pentest
 * pipeline persists into it (see security/pipeline integration).
 *
 *   import { open, pipelineGraph } from 'knowledge/index.js';
 *   const graph = open({ dbPath: '/abs/graph.db' });
 *   const g2 = pipelineGraph(ctx);   // engagement-scoped, durable path
 */

import path from 'node:path';
import { KnowledgeGraph } from './attack-chain/index.js';

export { KnowledgeGraph };
export { GraphValidationError } from './store.js';

/** Open a graph at an explicit path. No silent defaults — caller decides where it lives. */
export function open({ dbPath } = {}) {
  if (!dbPath) throw new Error('knowledge.open: dbPath is required');
  return new KnowledgeGraph({ dbPath });
}

/**
 * Engagement-scoped graph for the Phase 8 pipeline: lives beside the
 * engagement's checkpoints/artifacts (`<stateRoot>/.state/<id>/graph.db`),
 * so it inherits the same durability and wipe/resume semantics.
 */
export function pipelineGraph(ctx) {
  const stateRoot = ctx.stateRoot;
  const engagementId = ctx.engagementId;
  if (!stateRoot || !engagementId) {
    throw new Error('knowledge.pipelineGraph: ctx.stateRoot and ctx.engagementId are required');
  }
  const dbPath = path.join(stateRoot, '.state', String(engagementId).replace(/[^a-zA-Z0-9._-]/g, '_'), 'graph.db');
  return new KnowledgeGraph({ dbPath });
}

/**
 * Recon integration — record the crawled target as Host + Service +
 * connects-to edge. Idempotent: re-crawls update in place. Returns the
 * { host, service } rows (ids feed exploitation's graph writes).
 */
export function recordTarget(graph, { url, banner, product, version } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`knowledge.recordTarget: url is not parseable: ${JSON.stringify(url)}`);
  }
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname);
  const protocol = parsed.protocol.replace(':', '');
  const port = Number(parsed.port) || (protocol === 'https' ? 443 : 80);

  const host = graph.host.create({
    hostname: parsed.hostname,
    ip: isIpLiteral ? parsed.hostname : null,
    tags: ['pentest-target'],
  }).row;
  const service = graph.service.create({
    hostId: host.id,
    port,
    protocol,
    banner: banner || null,
    product: product || null,
    version: version || null,
  }).row;
  graph.connectsTo.create({ serviceId: service.id, hostId: host.id });
  return { host, service };
}

/**
 * Exploitation integration — persist one validated finding as a
 * Vulnerability + Exploit pair plus the exploits edge. `record` is the
 * pipeline's validation record ({findingId, title, severity, status,
 * methods[]}); success in the graph means status EXPLOITED. Idempotent by
 * deterministic ids derived from the findingId.
 */
export function recordFinding(graph, { refs, finding, record } = {}) {
  if (!finding || !record) throw new Error('knowledge.recordFinding: finding and record are required');
  let serviceId = refs && refs.serviceId;
  if (!serviceId || !graph.service.get(serviceId)) {
    throw new Error(`knowledge.recordFinding: serviceId missing or unknown (${JSON.stringify(refs)}) — recon must record the target first`);
  }
  const vuln = graph.vulnerability.create({
    id: `vuln-${record.findingId}`,
    serviceId,
    severity: record.severity,
    description: `${record.title} — pipeline verdict ${record.status}`,
    evidence: (record.methods || []).map((m) => `${m.name}: ${m.request} → ${m.success ? 'succeeded' : 'failed'} | ${String(m.responseExcerpt || '').slice(0, 120)}`),
  }).row;
  const exploit = graph.exploit.create({
    id: `expl-${record.findingId}`,
    vulnerabilityId: vuln.id,
    method: (record.methods || []).filter((m) => m.success).map((m) => m.name).join(' + ') || (record.methods || []).map((m) => m.name).join(' + ') || 'no-method',
    payload: (record.methods || []).map((m) => m.request).join(' ;; ') || null,
    succeeded: record.status === 'EXPLOITED',
    verified: record.status === 'EXPLOITED',
  }).row;
  graph.exploits.create({ exploitId: exploit.id, vulnerabilityId: vuln.id });
  return { vulnerabilityId: vuln.id, exploitId: exploit.id };
}
