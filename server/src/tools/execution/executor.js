/**
 * JEXI OS — tools — executor.
 *
 * Runs a normalized ToolCall through: schema validation → permission gate →
 * risk guard → engine execution → ToolResult. Fully provider-agnostic — the
 * same executor serves OpenAI, Anthropic, and Hermes-normalized calls.
 */

import { ToolResult } from '../interface/ToolResult.js';
import { validateCall } from '../registry/ToolRegistry.js';
import { makePermissionGate, denyByDefault } from './permission-gate.js';
import { makeRiskGuard } from './risk-guard.js';

/** engineAdapters: { [engineName]: (args, ctx) => Promise<any> } */
export function makeExecutor({ engines = {}, permissions = {}, risk = {} } = {}) {
  const gate = permissions.allowAll ? makePermissionGate({ allowAll: true })
    : makePermissionGate(permissions);
  const guard = makeRiskGuard(risk);

  return {
    async execute(call, ctx = {}) {
      const started = Date.now();
      const fail = (err) => ToolResult.fail(call.id, call.name, err, { durationMs: Date.now() - started });

      // 1. Schema validation
      const v = validateCall(call);
      if (!v.valid) return fail(new Error(`schema: ${v.errors.join('; ')}`));
      const def = v.definition;

      // 2. Permission gate (deny-by-default)
      const p = gate.check(call);
      if (!p.allowed) return fail(new Error(p.reason));
      const rp = gate.checkRisk(def);
      if (!rp.allowed) return fail(new Error(rp.reason));

      // 3. Risk guard (ring + side effects)
      const rg = guard.check(def, call.arguments);
      if (!rg.allowed) return fail(new Error(rg.reason));

      // 4. Engine execution
      const engine = def.engine ?? (engines[def.name] ? 'default' : null);
      const handler = engines[def.name] ?? (engine && engines[engine]) ?? engines.default;
      if (!handler) return fail(new Error(`no execution engine for tool "${call.name}"`));
      try {
        const result = await handler(call.arguments, { ...ctx, definition: def });
        return ToolResult.ok(call.id, call.name, result, { durationMs: Date.now() - started });
      } catch (err) {
        return fail(err);
      }
    },
    gate,
    guard,
  };
}

export { denyByDefault };