/**
 * JEXI OS — tools — ToolDefinition contract.
 *
 * The contract every tool implements. Mirrors the Hermes/OpenCode shape:
 * a name, description, JSON Schema parameters, permission requirements,
 * risk level, timeout, failure types, idempotency, runtime ring.
 */

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const RUNTIME_RINGS = [0, 1, 2, 3];

export function defineTool({ name, description, parameters = { type: 'object', properties: {} }, returns = {}, permissions = [], riskLevel = 'medium', timeout = { defaultMs: 30000, maxMs: 120000 }, sideEffects = [], failureTypes = ['tool_error'], idempotent = false, runtimeRing = 2, engine = null, agents = [] }) {
  if (!name || !String(description || '').trim()) throw new TypeError('ToolDefinition requires name + description');
  return {
    name,
    description: String(description),
    parameters,
    returns,
    permissions,
    riskLevel,
    timeout,
    sideEffects,
    failureTypes,
    idempotent,
    runtimeRing,
    engine,
    agents,
  };
}

/** Validate a definition object structurally (throws on contract violation). */
export function validateToolDefinition(def) {
  defineTool(def); // throws on missing name/description
  if (!RISK_LEVELS.includes(def.riskLevel)) throw new TypeError(`invalid riskLevel "${def.riskLevel}"`);
  if (!RUNTIME_RINGS.includes(def.runtimeRing)) throw new TypeError(`invalid runtimeRing "${def.runtimeRing}"`);
  const timeoutMs = def.timeout?.defaultMs ?? 30000;
  if (!(timeoutMs > 0)) throw new TypeError('timeout.defaultMs must be a positive number');
  // normalize missing optional fields so registered defs always match the contract
  if (!def.timeout) def.timeout = { defaultMs: timeoutMs, maxMs: 120000 };
  if (!Array.isArray(def.sideEffects)) def.sideEffects = [];
  if (!Array.isArray(def.failureTypes)) def.failureTypes = ['tool_error'];
  if (!Array.isArray(def.permissions)) def.permissions = [];
  return true;
}