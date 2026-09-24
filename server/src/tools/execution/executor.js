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
import { assert as assertSkillTools } from '../../../../harness/parity/skills/index.js'; // P30.B — skill allowedTools enforcement (READ-ONLY primitive)
import { runPostToolUseHook } from '../../kernel/hooks/runner.js'; // Phase 7(B) — PostToolUse hook point
import { observePostToolUse } from '../../kernel/hooks/learning-seam.js'; // Phase 7(C) — observer journal
import { hudObservePostToolUse } from '../../kernel/hooks/hud-seam.js'; // Phase 7(F) — HUD toolCalls feed

/** engineAdapters: { [engineName]: (args, ctx) => Promise<any> } */
export function makeExecutor({ engines = {}, permissions = {}, risk = {} } = {}) {
  const gate = permissions.allowAll ? makePermissionGate({ allowAll: true, maxRisk: 'critical' })
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

      // 1.5 P30.B — skill allowedTools enforcement (fail-closed). Fires only
      // when the call carries a skill context (ctx.skill); calls without a
      // skill are unaffected. Refusal reuses the shipped E_TOOL_NOT_ALLOWED
      // error class — no new error class, no policy change for plain calls.
      if (ctx && ctx.skill) {
        try { assertSkillTools(ctx.skill, { tool: call.name, args: call.arguments }); }
        catch (err) { return fail(err); }
      }

      // 2. Permission gate (deny-by-default) — Phase 7(B): PreToolUse hooks
      //    run inside the gate, BEFORE the permission check.
      const p = gate.check(call, ctx);
      const _hookLogs = Array.isArray(p.hookLogs) ? p.hookLogs : [];
      const withHooks = (r) => { if (_hookLogs.length) r.hookLogs = _hookLogs; return r; };
      if (!p.allowed) return withHooks(fail(new Error(p.reason)));
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
        const okResult = ToolResult.ok(call.id, call.name, result, { durationMs: Date.now() - started });
        // Phase 7(B): PostToolUse hook — fires after execution with the result.
        runPostToolUseHook(call, okResult, ctx);
        observePostToolUse(call, okResult, ctx); // Phase 7(C): observer records the result (fail-soft)
        hudObservePostToolUse(call, okResult, ctx); // Phase 7(F): HUD records the resolved call (fail-soft)
        return withHooks(okResult);
      } catch (err) {
        const failResult = fail(err);
        // Phase 7(B): PostToolUse hook — also fires on execution failure.
        runPostToolUseHook(call, failResult, ctx);
        observePostToolUse(call, failResult, ctx); // Phase 7(C): observer records the failure (fail-soft)
        hudObservePostToolUse(call, failResult, ctx); // Phase 7(F): HUD records the failure (fail-soft)
        return withHooks(failResult);
      }
    },
    gate,
    guard,
  };
}

export { denyByDefault };