/**
 * JEXI OS — ROUTER — two-stage agent resolution entry (Phase 7 I).
 *
 * The L6 router (see README) resolves a request to a worker in two stages:
 *
 *   1. runtime registry  — hot-path coworkers (Phase 2D Director roster) WINS
 *   2. canonical files   — agents/<division>/<id>.agent.md specialist pool
 *
 * This entry point exists so router consumers resolve from EITHER source
 * through one call, without importing server internals:
 *
 *   node -e "require('./router/resolve').resolveTwoStage('review my TypeScript')
 *              .then(r => console.log(r))"
 *
 * The implementation lives in workforce/registry (the registry owns the
 * catalog); this module is the router-facing seam, kept dependency-free.
 */

import { resolveTwoStage, mergedRoster, loadAgentFile, list, catalogSummary } from '../workforce/registry/index.js';

export { resolveTwoStage, mergedRoster, loadAgentFile, list, catalogSummary };

export default { resolveTwoStage, mergedRoster, loadAgentFile, list, catalogSummary };
