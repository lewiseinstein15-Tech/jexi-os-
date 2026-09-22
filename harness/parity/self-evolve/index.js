/** JEXI OS — Phase 30 Scope G — public self-evolving agent facade. */
import { createSelfEvolve } from './evolve.js';

let manager;
const defaultManager = () => {
  manager ??= createSelfEvolve();
  return manager;
};

export const selfEvolve = Object.freeze({
  afterRun: (input) => defaultManager().afterRun(input),
  audit: (agentId) => defaultManager().audit(agentId),
  rollback: (decisionId) => defaultManager().rollback(decisionId),
});

export default selfEvolve;
export {
  createSelfEvolve,
  DEFAULT_MAX_SKILLS_PER_RUN,
} from './evolve.js';
export { createEvolutionAudit } from './audit.js';
export {
  inspectSkill,
  prepareUpdate,
  byteDiff,
  resolveSkillPath,
  DEFAULT_MAX_BYTE_DELTA,
} from './guardrail.js';
