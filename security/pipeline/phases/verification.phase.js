/**
 * JEXI OS — Phase 8 Scope G — PHASE 5/6 — VERIFICATION (independent re-execution).
 *
 * The gate between exploitation and reporting. The verdicts from the
 * exploitation phase are the DOER'S CLAIMS; this phase submits every claim
 * to the independent verifier (verification/verifiers/) which:
 *
 *   1. reads the finding from the knowledge graph (Phase 8C)
 *   2. re-runs the exploit with its OWN methods and OWN markers
 *   3. demands >= 2 independent observed methods for CRITICAL/HIGH
 *   4. attaches evidence to the graph finding
 *   5. sets the finding status VERIFIED / REJECTED / INCONCLUSIVE
 *      (REFUSED when the verifier must decline: verifier==doer, RoE)
 *
 * Unverified findings NEVER reach reporting — reporting.phase.js consults
 * the verification records + evidence-hash integrity before keeping a
 * finding. A doer claim of EXPLOITED means nothing here; F-011 (the
 * server-side-escaped announcement trap) exists to prove the verifier
 * overturns exactly that class of false claim.
 *
 * Durability mirrors the exploitation phase: per-finding verdicts persist
 * to checkpoint.partial AS THEY HAPPEN — a kill mid-phase resumes without
 * re-verifying findings already done.
 *
 * Contract:
 *   id:      'verification'
 *   inputs:  ['artifacts/exploitation.json', 'artifacts/vulnerabilities.json']
 *   outputs: ['artifacts/verification.json']
 */

import * as store from '../orchestration/checkpoint.js';
import { pipelineGraph } from '../../../mind/knowledge/index.js';
import { gatePhase } from '../../engagements/validator.js'; // Phase 8(D): RoE gate
import { ExploitVerifier } from '../../../tests/verification/verifiers/index.js';

export const phase = {
  id: 'verification',
  inputs: ['artifacts/exploitation.json', 'artifacts/vulnerabilities.json'],
  outputs: ['artifacts/verification.json'],

  async *run(ctx) {
    yield* gatePhase(ctx, 'verify'); // Phase 8(D): verification is an engagement action — refusal HALTS
    const explo = store.readArtifact(ctx.stateRoot, ctx.engagementId, 'exploitation.json');
    const vuln = store.readArtifact(ctx.stateRoot, ctx.engagementId, 'vulnerabilities.json');
    if (!explo || !vuln) throw new Error('verification: upstream artifacts missing');

    const byId = new Map(vuln.findings.map((f) => [f.id, f]));
    const records = explo.validated || [];
    const done = (ctx.checkpoint && ctx.checkpoint.partial && ctx.checkpoint.partial.verified) || {};
    if (Object.keys(done).length) {
      yield { type: 'log', data: { message: `verification: ${Object.keys(done).length} finding(s) already verified pre-crash — SKIPPED (resume from checkpoint)` } };
    }

    const target = ctx.baseUrl || vuln.target;
    const verifiedBy = ctx.verifiedBy || 'security-verifier'; // independent identity — NOT the doer
    const exploitedBy = ctx.exploitedBy || 'pipeline:exploitation'; // who ran the exploitation phase

    const results = Object.values(done);
    for (const record of records) {
      if (done[record.findingId]) continue;
      const finding = byId.get(record.findingId);
      if (!finding) {
        yield { type: 'log', data: { message: `[${record.findingId}] verification skipped: finding metadata missing from vulnerabilities.json` } };
        continue;
      }

      yield {
        type: 'log',
        data: {
          message: `[${record.findingId}] doer claimed ${record.status} (${record.methodsSucceeded}/${record.methodsRequired}) — verifier "${verifiedBy}" re-executes independently`,
          doerClaim: record.status,
        },
      };

      const graph = pipelineGraph(ctx);
      let verdict;
      try {
        const verifier = new ExploitVerifier({ graph, agent: verifiedBy });
        verdict = await verifier.verifyFinding({
          finding,
          record,
          target,
          engagement: ctx.engagement || null,
          exploitedBy,
          sourceRoot: ctx.sourceRoot || null,
        });
      } finally {
        graph.close();
      }

      const out = {
        findingId: verdict.findingId,
        doerClaim: record.status,
        status: verdict.status,
        rule: verdict.rule || null,
        reason: verdict.reason,
        methodsRequired: verdict.methodsRequired,
        methodsSucceeded: verdict.methodsSucceeded,
        methods: verdict.methods,
        vulnerabilityId: verdict.vulnerabilityId || null,
        exploitId: verdict.exploitId || null,
        evidenceHash: verdict.evidenceHash || null,
        reExecuted: verdict.reExecuted,
        verifierAgent: verdict.verifierAgent,
        exploitedBy: verdict.exploitedBy || exploitedBy,
        doerClaimAudit: verdict.doerClaimAudit,
      };
      results.push(out);

      // durability boundary: persist BEFORE the next finding
      ctx.checkpoint.partial = { ...ctx.checkpoint.partial, verified: { ...(ctx.checkpoint.partial.verified || {}), [record.findingId]: out } };
      store.saveCheckpoint(ctx.stateRoot, ctx.engagementId, ctx.checkpoint);

      yield {
        type: 'finding',
        data: {
          ...out,
          methods: out.methods.map((m) => ({ name: m.name, success: m.success })),
          persistedToCheckpoint: true,
        },
      };
    }

    const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    const overturns = results.filter((r) => r.doerClaim === 'EXPLOITED' && r.status !== 'VERIFIED').length;
    const artifact = {
      phase: 'verification',
      generatedAt: new Date().toISOString(),
      target,
      verifier: ctx.verifiedBy || 'security-verifier',
      exploitedBy: ctx.exploitedBy || 'pipeline:exploitation',
      verified: results,
      counts,
      doerClaimsOverturned: overturns,
    };
    const jsonPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'verification.json', artifact);
    yield { type: 'progress', data: { message: `verification complete: ${JSON.stringify(counts)}${overturns ? ` — ${overturns} doer claim(s) OVERTURNED` : ''}` } };
    yield { type: 'artifact', data: { path: jsonPath, kind: 'verification-results' } };

    ctx.checkpoint.partial = { ...ctx.checkpoint.partial, claims: null }; // artifact is authoritative
  },

  async *resume(checkpointId, ctx) {
    const verified = (ctx.checkpoint && ctx.checkpoint.partial && ctx.checkpoint.partial.verified) || {};
    yield {
      type: 'log',
      data: {
        message: `resume(${checkpointId}): ${Object.keys(verified).length} finding(s) already verified before process death — continuing from checkpoint`,
        alreadyVerified: Object.keys(verified),
      },
    };
    yield* this.run(ctx);
  },
};

export default phase;
