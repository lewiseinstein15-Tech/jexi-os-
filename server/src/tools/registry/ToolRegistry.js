/**
 * JEXI OS — tools — ToolRegistry (provider-independent).
 *
 * Registration, discovery, and validation for ToolDefinitions. Tools are
 * registered once by name and become usable from ANY provider because the
 * executor consumes normalized ToolCall objects.
 *
 * This layer wraps the legacy engine catalog (TOOL_REGISTRY in
 * services/ToolRegistry.js) — registerDefinition() carries engine + agents
 * metadata so nothing is orphaned.
 */

import { defineTool, validateToolDefinition } from '../interface/ToolDefinition.js';
import { validateSchema } from './schema-validator.js';

/** name → ToolDefinition. Set at module init from the legacy engine catalog. */
const definitions = new Map();

export function registerTool(def) {
  const definition = def.name && def.description ? def : defineTool(def);
  validateToolDefinition(definition);
  definitions.set(definition.name, definition);
  return () => definitions.delete(definition.name);
}

export function registerToolBatch(defs) {
  const unreg = (defs || []).map((d) => registerTool(d));
  return () => unreg.forEach((u) => u());
}

export function getTool(name) {
  return definitions.get(name) ?? null;
}

export function hasTool(name) {
  return definitions.has(name);
}

export function listTools() {
  return [...definitions.values()];
}

/** Validate a normalized tool call's arguments against its definition schema. */
export function validateCall(call) {
  const def = definitions.get(call.name);
  if (!def) return { valid: false, errors: [`unknown tool "${call.name}"`], definition: null };
  const { valid, errors } = validateSchema(call.arguments, def.parameters);
  return { valid, errors, definition: def };
}

/**
 * Build an initial registry from the legacy engine catalog so `tools/` is a
 * first-class overlay, not a shadow. Only a few engines are wired as real
 * executable adapters right now; the rest are discoverable metadata.
 */
export function initFromEngineCatalog(engineCatalog) {
  const registry = engineCatalog?.TOOL_REGISTRY ?? engineCatalog ?? [];
  for (const t of registry) {
    const def = defineTool({
      name: t.slug,
      description: t.desc ?? t.name,
      parameters: t.schema ?? { type: 'object', properties: {} },
      permissions: t.permissions ?? [],
      riskLevel: t.risk ?? 'medium',
      timeout: { defaultMs: t.timeoutMs ?? 30000, maxMs: t.timeoutMs ? t.timeoutMs * 2 : 120000 },
      idempotent: Boolean(t.idempotent),
      engine: t.engine ?? null,
      agents: t.agents ?? [],
    });
    registerTool(def);
  }
  return registry.length;
}

export function _clear() {
  definitions.clear();
}