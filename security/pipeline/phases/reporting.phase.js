/**
 * JEXI OS — Phase 8 Scope A: PHASE 5/5 — REPORTING (deliverable generation).
 *
 * Shannon phase 5. The gate is absolute: findings whose exploitation status
 * is not EXPLOITED NEVER reach the report. "No exploit, no report."
 * Unverified findings are dropped and the drop is logged — silently for the
 * report, transparently in the event stream.
 *
 * Contract:
 *   id:      'reporting'
 *   inputs:  ['artifacts/exploitation.json', 'artifacts/vulnerabilities.json']
 *   outputs: ['artifacts/report.json', 'artifacts/report.md']
 */

import * as store from '../orchestration/checkpoint.js';
import { pipelineGraph } from '../../../knowledge/index.js';

const REMEDIATION = {
  'A01:2021 Broken Access Control': 'Enforce server-side authorization on every privileged route; canonicalize and jail all filesystem paths (path.normalize + allowlist base dir).',
  'A02:2021 Cryptographic Failures': 'Serve TLS only; set Secure/HttpOnly/SameSite on session cookies; move secrets out of source into a managed secret store.',
  'A03:2021 Injection': 'Use parameterized queries / prepared statements; contextually encode output (HTML entity encoding for reflected values).',
  'A03:2021 Injection (XSS)': 'Contextually encode all user input on output; add a Content-Security-Policy as defense in depth.',
  'A05:2021 Security Misconfiguration': 'Set CSP, X-Frame-Options, X-Content-Type-Options and Referrer-Policy on all responses; suppress verbose banners.',
  'A07:2021 Identification & Authentication Failures': 'Generate session tokens with a CSPRNG (>= 128 bits entropy); rotate on login; set HttpOnly/Secure.',
};

export const phase = {
  id: 'reporting',
  inputs: ['artifacts/exploitation.json', 'artifacts/vulnerabilities.json'],
  outputs: ['artifacts/report.json', 'artifacts/report.md'],

  async *run(ctx) {
    const explo = store.readArtifact(ctx.stateRoot, ctx.engagementId, 'exploitation.json');
    const vuln = store.readArtifact(ctx.stateRoot, ctx.engagementId, 'vulnerabilities.json');
    if (!explo || !vuln) throw new Error('reporting: upstream artifacts missing');

    const byId = new Map(vuln.findings.map((f) => [f.id, f]));
    const verified = [];
    const dropped = [];

    for (const v of explo.validated) {
      if (v.status === 'EXPLOITED') verified.push({ ...v, finding: byId.get(v.findingId) });
      else dropped.push(v);
    }

    for (const d of dropped) {
      yield { type: 'log', data: { message: `dropped: ${d.findingId} (${d.status}) — no exploit, no report` } };
    }

    // Phase 8(C): the knowledge graph is the source of truth for exploitation
    // status — every verified finding is cross-checked against its persisted
    // exploit row; a verdict that contradicts the graph is dropped. Graph
    // absent (legacy state) → artifact flow remains authoritative.
    let knowledge = null;
    try {
      const graph = pipelineGraph(ctx);
      try {
        const kept = [];
        for (const v of verified) {
          const ex = v.graph && v.graph.exploitId ? graph.exploit.get(v.graph.exploitId) : null;
          if (v.graph && ex && !ex.succeeded) {
            dropped.push(v);
            yield { type: 'log', data: { message: `graph override: ${v.findingId} exploit not succeeded in knowledge graph — dropped` } };
          } else {
            if (v.graph && ex) v.knowledgeGraph = { vulnerabilityId: v.graph.vulnerabilityId, exploitId: v.graph.exploitId, succeeded: ex.succeeded, verified: ex.verified };
            kept.push(v);
          }
        }
        verified.length = 0;
        verified.push(...kept);
        const cov = graph.coverage();
        knowledge = {
          persistedFindings: cov.known.vulnerabilitiesFound,
          persistedExploits: cov.known.exploitsAttempted,
          validatedExploits: cov.known.exploitsValidated,
        };
      } finally {
        graph.close();
      }
    } catch {
      knowledge = null;
    }

    verified.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const counts = verified.reduce((acc, r) => { acc[r.severity] = (acc[r.severity] || 0) + 1; return acc; }, {});

    yield { type: 'progress', data: { message: `${verified.length} finding(s) verified, ${dropped.length} dropped — writing deliverable` } };

    const report = {
      phase: 'reporting',
      engagementId: ctx.engagementId,
      generatedAt: new Date().toISOString(),
      target: vuln.target,
      pipeline: { phases: ['pre-recon', 'recon', 'vulnerability', 'exploitation', 'reporting'], gate: 'no exploit, no report' },
      knowledge,
      executiveSummary: {
        verifiedFindings: verified.length,
        droppedUnverified: dropped.length,
        bySeverity: counts,
      },
      findings: verified,
      dropped,
    };

    const jsonPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'report.json', report);
    const mdPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'report.md', renderMd(report));

    yield { type: 'artifact', data: { path: jsonPath, kind: 'final-report' } };
    yield { type: 'artifact', data: { path: mdPath, kind: 'final-report' } };
  },

  async *resume(checkpointId, ctx) {
    yield { type: 'log', data: { message: `resume(${checkpointId}): regenerating deliverable from persisted artifacts` } };
    yield* this.run(ctx);
  },
};

function severityRank(s) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s] || 0;
}

function renderMd(r) {
  const lines = [
    `# Security Engagement Report — ${r.target}`,
    ``,
    `Engagement: \`${r.engagementId}\`  ·  Generated: ${r.generatedAt}`,
    `Pipeline gate: **${r.pipeline.gate}**`,
    ``,
    `## Executive summary`,
    ``,
    `- Verified findings: **${r.executiveSummary.verifiedFindings}**`,
    `- Dropped (unverified): ${r.executiveSummary.droppedUnverified}`,
    `- By severity: ${Object.entries(r.executiveSummary.bySeverity).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`,
    ``,
    `## Verified findings`,
    ``,
  ];
  for (const f of r.findings) {
    lines.push(`### ${f.findingId} — ${f.title} [${f.severity.toUpperCase()}]`);
    lines.push('');
    lines.push(`- OWASP: ${f.finding ? f.finding.owasp : '(n/a)'}`);
    lines.push(`- Location: ${f.finding && f.finding.location ? JSON.stringify(f.finding.location) : '(n/a)'}`);
    lines.push(`- Exploitation: ${f.methodsSucceeded}/${f.methodsRequired} method(s) succeeded → ${f.status}`);
    for (const m of f.methods.filter((m) => m.success)) {
      lines.push(`  - Method \`${m.name}\`: ${m.request}`);
      lines.push(`    - Response: ${m.responseExcerpt.replace(/\n/g, ' ').slice(0, 160)}`);
    }
    const owaspKey = f.finding ? f.finding.owasp : '';
    lines.push(`- Remediation: ${REMEDIATION[owaspKey] || 'See OWASP guidance for this class.'}`);
    lines.push('');
  }
  if (r.dropped.length) {
    lines.push(`## Dropped (did not pass the exploit gate)`);
    lines.push('');
    for (const d of r.dropped) lines.push(`- ${d.findingId} — ${d.title} (${d.status})`);
    lines.push('');
  }
  return lines.join('\n');
}

export default phase;
