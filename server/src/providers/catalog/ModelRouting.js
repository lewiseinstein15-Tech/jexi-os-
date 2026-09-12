/**
 * JEXI OS — Model Routing (roadmap stage 24: model routing per agent/skill).
 *
 * Maps planner intents to a CAPABILITY LANE (never a provider name). The lane
 * is resolved to a concrete provider order inside the provider layer only.
 *
 *   math/solve     → 'code'     (strong structured reasoning)
 *   research/study → 'research' (broad, current model selection)
 *   code/news/data → 'code'     (fast, generous free tier)
 *   image/vision   → 'vision'   (vision-capable)
 *
 * The map is data, not code: /api/models exposes lane labels, and changing
 * it takes effect without a redeploy.
 */

export const INTENT_PREFERENCE = {
  math_solve: 'code',
  image_recognition: 'vision',
  vision: 'vision',
  research: 'research',
  learning_research: 'research',
  study_topic: 'research',
  link_analysis: 'research',
  news_latest: 'research',
  code_task: 'code',
  github: 'code',
  data: 'code',
  devops: 'code',
  docs: 'code',
  compound_task: '',
  translate: '',
  conversation: '',
};

/** Capability lane for an intent ('' = default order). Never a provider name. */
export function providerPreferenceForIntent(intent) {
  return INTENT_PREFERENCE[intent] || '';
}

const LANE_LABELS = {
  vision: 'Vision-optimized',
  code: 'Code/structured reasoning',
  research: 'Research/broad knowledge',
};

/** Display lane label for the Models screen. */
export function laneLabel(lane) {
  return LANE_LABELS[lane] || 'Automatic failover';
}

/** Full routing table for the Models screen — lane labels, no provider names. */
export function modelRoutingTable() {
  return Object.entries(INTENT_PREFERENCE).map(([intent, lane]) => ({
    intent,
    lane: lane || '(auto)',
    providerLabel: laneLabel(lane),
  }));
}
