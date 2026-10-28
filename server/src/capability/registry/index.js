/**
 * JEXI OS — capability registry — public API.
 *
 * The single import site for the capability runtime:
 *
 *   catalog.js       — the vocabulary (capability id → providers)
 *   registry.js      — the four states: exists / registered / available / succeeded
 *   ledger.js        — what actually succeeded (evidence, not promises)
 *   requirements.js  — what a task needs, from the request's own words
 *   selection.js     — required capabilities → verified tool slugs to offer
 *
 * Design rule: availability is computed from live runtime sources and never
 * asserted. A capability with no working provider reports unavailable WITH a
 * reason, so the agent can say "I cannot do that here" truthfully.
 */
export { CAPABILITIES, CAPABILITY_BY_ID, getCapability, capabilityIds } from './catalog.js';

export {
  STATES, STATE_ORDER, REASONS, stateRank, atLeast,
  describeCapability, listCapabilityStates, listCapabilityStatesAsync,
  availableToolsFor, capabilitySummary, capabilitySummaryAsync,
  primeCapabilities,
} from './registry.js';

export {
  OUTCOMES, classifyOutcome, recordOutcome, ledgerEvents,
  succeededCapabilities, refusedCapabilities, failedCapabilities,
  capabilityStats, setLedgerPath, _resetLedger, TOOL_TO_CAPABILITY,
} from './ledger.js';

export { inferRequirements, requirementRules } from './requirements.js';
export { selectCapabilityTools } from './selection.js';
