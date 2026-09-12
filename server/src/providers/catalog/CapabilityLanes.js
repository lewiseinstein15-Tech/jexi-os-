/**
 * JEXI OS — Provider bridge — capability lanes.
 *
 * Domain-family → preferred provider lane for generated agent profiles.
 * This is provider-layer routing DATA (the only place such names live in the
 * provider catalog); business logic calls preferredLaneForRole() and never
 * names a provider.
 */

const CODE_LANE = 'nvidia';
const RESEARCH_LANE = 'gemini';
const WRITER_LANE = 'mistral';
const DEFAULT_LANE = 'groq';

/** Provider lane for a role slug by domain family ('' if none matched). */
export function preferredLaneForRole(slug) {
  if (/coder|developer|engineer|backend|frontend|api|database|devops|security|app-?sec|qa|debug|release|kubernetes|terraform|sre|infra|cloud|deploy|mobile|android|ios|react/.test(slug)) return CODE_LANE;
  if (/research|scholar|science|history|study|analyst|data|market|news|fact|report|bi/.test(slug)) return RESEARCH_LANE;
  if (/writer|editor|copy|poet|novel|screen|blog|content|brand|social|marketing|seo/.test(slug)) return WRITER_LANE;
  return DEFAULT_LANE;
}

/** Capability profile that motivates each lane (for capability-style callers). */
export function laneProfileFor(lane) {
  switch (lane) {
    case CODE_LANE: return { requires: ['code_reasoning'], minCodeReasoning: 'strong' };
    case RESEARCH_LANE: return { requires: ['long_context'], minContextTokens: 128_000 };
    case WRITER_LANE: return {};
    default: return {};
  }
}