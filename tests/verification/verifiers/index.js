/**
 * JEXI OS — Phase 8 Scope G — VERIFIERS FACADE.
 *
 * The independent verification layer for the Phase 8 pentest pipeline.
 * "No exploit, no report": a finding reaches a report only when THIS
 * layer says VERIFIED — and stays VERIFIED (snapshot intact).
 *
 *   import { ExploitVerifier, verifyFindingOnGraph } from 'verification/verifiers/index.js';
 *   const verifier = new ExploitVerifier({ graph, agent: 'security-verifier' });
 *   const verdict = await verifier.verifyFinding({ finding, record, target, engagement, exploitedBy });
 *   const integrity = verifier.integrityCheck({ findingId });
 *
 * Modules:
 *   exploit.verifier.js — re-execution, verdicts, evidence, snapshots
 *   poc.verifier.js     — PoC structure/observation/independence gates
 *   roi.verifier.js     — Rules-of-Engagement gate for re-execution
 */

import { ExploitVerifier, openVerifierGraph, canonical, sha256hex, snapshotOf, excerptAround } from './exploit.verifier.js';
import { checkRoE, assertInRoE, roeGate } from './roi.verifier.js';
import { validatePoc, requiredCount, independentMethods, auditClaim } from './poc.verifier.js';

export { ExploitVerifier, openVerifierGraph, canonical, sha256hex, snapshotOf, excerptAround };
export { checkRoE, assertInRoE, roeGate };
export { validatePoc, requiredCount, independentMethods, auditClaim };

export default ExploitVerifier;
