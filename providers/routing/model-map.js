/**
 * JEXI OS — Phase 27 Scope C — class -> model mapping (configurable).
 *
 * The map is a tier mapping in the openclaude sense (modelOptions.ts tiers
 * + aliases.ts): class names resolve to configurable model STRINGS — this
 * module never imports a provider SDK and never touches the network. A
 * deployment names its real models via routing.configure({ map, ... }).
 *
 * Default map: simple -> 'tier-cheap' (cheapest configured model),
 *              strong -> 'tier-strong' (strongest configured model).
 * 'tier-cheap'/'tier-strong' are the shipped placeholder tiers; real names
 * are supplied at configure() time and must be declared known.
 *
 * Errors: E_UNKNOWN_MODEL (model string not in knownModels),
 *         E_INVALID_CONFIG (malformed map / overrides / knownModels).
 */
import { RoutingError } from './_internal.js';
import { CLASSES } from './complexity.js';

export const DEFAULT_MAP = Object.freeze({ simple: 'tier-cheap', strong: 'tier-strong' });
export const DEFAULT_KNOWN_MODELS = Object.freeze(['tier-cheap', 'tier-strong']);

export function validateKnownModels(knownModels) {
  if (!Array.isArray(knownModels) || knownModels.some((m) => typeof m !== 'string' || m.length === 0)) {
    throw new RoutingError('E_INVALID_CONFIG', 'knownModels must be an array of non-empty strings');
  }
  return [...new Set(knownModels)];
}

export function validateMap(map, knownModels) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new RoutingError('E_INVALID_CONFIG', 'map must be an object { simple, strong }');
  }
  for (const klass of CLASSES) {
    const model = map[klass];
    if (typeof model !== 'string' || model.length === 0) {
      throw new RoutingError('E_INVALID_CONFIG', `map.${klass} must be a non-empty string`);
    }
    if (!knownModels.includes(model)) {
      throw new RoutingError('E_UNKNOWN_MODEL', `map.${klass} -> "${model}" is not a known model; known: ${knownModels.join(', ')}`);
    }
  }
}

/**
 * agentOverrides values: either a model string (used for BOTH classes) or
 * { simple, strong } (per-class). Every referenced model must be known.
 */
export function validateOverrides(agentOverrides, knownModels) {
  if (agentOverrides === undefined) return;
  if (!agentOverrides || typeof agentOverrides !== 'object' || Array.isArray(agentOverrides)) {
    throw new RoutingError('E_INVALID_CONFIG', 'agentOverrides must be an object keyed by agentId');
  }
  for (const [agentId, override] of Object.entries(agentOverrides)) {
    if (typeof override === 'string') {
      if (!knownModels.includes(override)) {
        throw new RoutingError('E_UNKNOWN_MODEL', `agentOverrides["${agentId}"] -> "${override}" is not a known model; known: ${knownModels.join(', ')}`);
      }
    } else if (override && typeof override === 'object' && !Array.isArray(override)) {
      for (const klass of CLASSES) {
        const model = override[klass];
        if (model === undefined) continue;
        if (typeof model !== 'string' || !knownModels.includes(model)) {
          throw new RoutingError('E_UNKNOWN_MODEL', `agentOverrides["${agentId}"].${klass} -> "${String(model)}" is not a known model; known: ${knownModels.join(', ')}`);
        }
      }
    } else {
      throw new RoutingError('E_INVALID_CONFIG', `agentOverrides["${agentId}"] must be a model string or { simple, strong }`);
    }
  }
}

/**
 * Resolve the model for a class. agentOverrides[agentId] WINS over the map
 * (openclaude: userSpecifiedModel ?? initialMainLoopModel). Returns
 * { model, source } where source explains which layer decided.
 */
export function resolveModel(config, klass, agentId) {
  if (agentId !== undefined && agentId !== null) {
    const override = config.agentOverrides[agentId];
    if (typeof override === 'string') {
      return { model: override, source: `agentOverride:${agentId}` };
    }
    if (override && typeof override === 'object' && typeof override[klass] === 'string') {
      return { model: override[klass], source: `agentOverride:${agentId}.${klass}` };
    }
  }
  const model = config.map[klass];
  if (!config.knownModels.includes(model)) {
    throw new RoutingError('E_UNKNOWN_MODEL', `map.${klass} -> "${model}" is not a known model; known: ${config.knownModels.join(', ')}`);
  }
  return { model, source: 'map' };
}
