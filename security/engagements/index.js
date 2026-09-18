/**
 * JEXI OS — Phase 8 Scope D — ENGAGEMENTS (facade).
 *
 * Soundwave-pattern engagement planning on JEXI storage: the 8-document
 * OPPLAN is written BEFORE any execution, the RoE validator gates every
 * security action, and the whole bundle — approvals, audit trail,
 * signatures, cleanup receipts — survives process death (SQLite, WAL).
 *
 *   security/engagements/
 *   ├── index.js          ← this facade
 *   ├── planner.js        Soundwave: intent → validated plan draft
 *   ├── bundle.js         assembles the 8 documents + renders the OPPLAN
 *   ├── docs/             roe | conops | deconfliction | abort |
 *   │                     data-handling | contact | cleanup | signatures
 *   ├── validator.js      RoE checks + the pipeline gate (gatePhase)
 *   ├── store.js          SQLite persistence (bundles, approvals, audit)
 *   ├── probe.js          re-runnable live probes P1–P11
 *   └── schema/migrations/
 *
 *   import { openEngagements } from 'security/engagements/index.js';
 *   const eng = openEngagements({ dbPath: '/abs/engagements.db' });
 *   const e1 = eng.plan({ name: 'demo', targets: ['127.0.0.1'], ... });
 *   eng.grantApproval(e1.id, { action: 'exploit', grantedBy: 'owner' });
 *   eng.runCleanup(e1.id, { stateRoots: [pipelineDir] });
 *   eng.close();
 *
 * THE RULE (paired with Scope C): the pipeline may only act inside the
 * engagement. Every phase validates its action against the RoE first —
 * a refusal emits engagement.violation and HALTS the run.
 */

import { Engagements, openEngagements, defaultDbPath } from './store.js';
import { planDraft } from './planner.js';
import { assembleBundle, renderOpplan, OPPLAN_DOCS } from './bundle.js';
import {
  validateRoE,
  validateEngagementLiveness,
  gatePhase,
  EngagementViolationError,
  normalizeTarget,
} from './validator.js';
import { bundleHash, signBundle, verifySignatures } from './docs/signatures.js';

export {
  Engagements,
  openEngagements,
  defaultDbPath,
  planDraft,
  assembleBundle,
  renderOpplan,
  OPPLAN_DOCS,
  validateRoE,
  validateEngagementLiveness,
  gatePhase,
  EngagementViolationError,
  normalizeTarget,
  bundleHash,
  signBundle,
  verifySignatures,
};

export default { openEngagements, validateRoE, gatePhase };
