/**
 * JEXI OS — Phase 27 Scope C — smart routing (public surface).
 *
 *   routing.classify(prompt)            -> { class, score, signals }
 *   routing.route(prompt, { agentId? }) -> { model, class, reason }
 *   routing.configure({ map, agentOverrides, knownModels }) -> { configured }
 *
 * Per-turn model routing (openclaude QueryEngine pattern): every turn is
 * classified simple|strong and routed to the mapped model for its tier.
 * Per-agent overrides beat the map; configure() validates EVERYTHING before
 * atomically swapping config (a rejected configure leaves the previous
 * config untouched). Deterministic: no randomness, no time, no network,
 * no provider SDK imports.
 *
 * Errors: E_INVALID_PROMPT, E_UNKNOWN_MODEL, E_INVALID_CONFIG.
 */
import { RoutingError } from './_internal.js';
import { classify, STRONG_THRESHOLD } from './complexity.js';
import {
  DEFAULT_MAP,
  DEFAULT_KNOWN_MODELS,
  validateKnownModels,
  validateMap,
  validateOverrides,
  resolveModel,
} from './model-map.js';

let config = {
  map: { ...DEFAULT_MAP },
  agentOverrides: {},
  knownModels: [...DEFAULT_KNOWN_MODELS],
};

export { RoutingError } from './_internal.js';
export { classify, STRONG_THRESHOLD } from './complexity.js';
export { DEFAULT_MAP, DEFAULT_KNOWN_MODELS } from './model-map.js';

/**
 * configure({ map, agentOverrides, knownModels }) -> { configured }
 *
 * Validates the FULL next config (map + overrides against the known-model
 * set) before swapping. knownModels REPLACE the custom portion but the
 * shipped defaults stay known. Omitted fields keep their current value;
 * pass map/agentOverrides explicitly to reset them.
 */
export function configure({ map, agentOverrides, knownModels } = {}) {
  const next = {
    map: map !== undefined ? { ...map } : { ...config.map },
    agentOverrides:
      agentOverrides !== undefined
        ? JSON.parse(JSON.stringify(agentOverrides))
        : JSON.parse(JSON.stringify(config.agentOverrides)),
    knownModels: knownModels !== undefined
      ? [...DEFAULT_KNOWN_MODELS, ...validateKnownModels(knownModels)]
      : [...config.knownModels],
  };
  validateMap(next.map, next.knownModels);
  validateOverrides(next.agentOverrides, next.knownModels);
  config = next;
  return { configured: true };
}

/**
 * route(prompt, { agentId? }) -> { model, class, reason }
 * The reason string records every decision input deterministically:
 * class, score, deciding layer (map or override), final model.
 */
export function route(prompt, { agentId } = {}) {
  const { class: klass, score, signals } = classify(prompt);
  const { model, source } = resolveModel(config, klass, agentId);
  const comparison = klass === 'strong' ? `>= ${STRONG_THRESHOLD}` : `< ${STRONG_THRESHOLD}`;
  const reason =
    source === 'map'
      ? `${klass} (score ${score} ${comparison}) via map -> ${model}`
      : `${klass} (score ${score} ${comparison}) via ${source} -> ${model} (override wins over map)`;
  return { model, class: klass, reason, signals };
}
