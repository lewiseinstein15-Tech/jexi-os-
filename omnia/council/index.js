/**
 * JEXI OS — Phase 15 Scope C — council entry point.
 *
 *   const council = createCouncil(councilDir, { decisionsLog? })
 *   council.convene({ topic, roles })          -> { councilId, participants }
 *   council.vote(councilId, { by, choice, rationale }) -> { recorded }
 *   council.decide(councilId)                  -> { decision, tally, dissents }
 *   council.record(councilId)                  -> { decisionId }   (Phase 14 log)
 *
 * decisionsLog defaults to a FRESH Phase 14 decisions log created
 * through its public API (decisions.create()) — read-only consumption,
 * Phase 14 files untouched.
 */
import fs from 'node:fs';
import { fail } from '../../semantica/_internal.js';
import { convene, decide, loadCouncil } from './council.js';
import { captureVote } from './vote.js';
import { recordCouncil, buildRecord } from './record.js';
import { COUNCIL_ROLES } from './roles.js';
import { decisions as decisionsApi } from '../../semantica/decisions/index.js';

export function createCouncil(councilDir, { decisionsLog } = {}) {
  if (typeof councilDir !== 'string' || councilDir.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'councilDir must be a non-empty string');
  }
  fs.mkdirSync(councilDir, { recursive: true });
  const log = decisionsLog || decisionsApi.create();
  return {
    path: councilDir,
    log,
    ROLES: COUNCIL_ROLES,
    convene: (spec) => convene(councilDir, spec),
    vote(councilId, voteSpec) {
      const council = loadCouncil(councilDir, councilId);
      const result = captureVote(council, voteSpec);
      fs.writeFileSync(councilPath(councilDir, councilId), JSON.stringify(council, null, 2) + '\n');
      return result;
    },
    decide: (councilId) => decide(councilDir, councilId),
    record: (councilId) => recordCouncil(councilDir, log, councilId),
    get: (councilId) => loadCouncil(councilDir, councilId),
    buildRecord: (councilId) => buildRecord(loadCouncil(councilDir, councilId)),
  };
}

const councilPath = (dir, councilId) => dir + '/councils/' + councilId + '.json';

export { convene, decide, loadCouncil, saveCouncil } from './council.js';
export { captureVote } from './vote.js';
export { recordCouncil, buildRecord } from './record.js';
export { COUNCIL_ROLES, assertRole } from './roles.js';
export { SemanticaError } from '../../semantica/_internal.js';
