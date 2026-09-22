/**
 * JEXI OS — PHASE 31 SCOPE 5 — registries, gates, dispatch (connect-only).
 *
 * W13 — executor -> skills/gates/gated-dispatch.js. The shipped gate module
 * registers itself here (one import + one register call, approved extension);
 * this module composes it in AUDIT-ONLY mode in front of the SHIPPED tool
 * executor (makeExecutor is used exactly as shipped — schema -> permission ->
 * risk -> engine). The audit leg runs the REAL gatedDispatch with a harmless
 * audit stub: gate verdicts land in the shipped JSONL audit log
 * (skills/gates/state.js appendAudit), and the real tool call is NEVER
 * blocked by this leg. Default-deny is an owner call — left as-is.
 *
 * W14 / S4-N8N / W23c — mcp/registry.json entries are DECLARATIVE (added
 * directly to the registry file, no removals). initRegistriesWiring() only
 * validates the registry parses and the entries exist; the AAS stdio ping is
 * live-probed separately.
 *
 * Fail-soft: every mount logs one `W31 <ID>: FAIL-SOFT <reason>` line and
 * boot continues. No new error class — E_WIRING reused.
 */

import { makeExecutor } from '../tools/execution/executor.js';
import { appendAudit } from '../../../skills/gates/state.js';

/* ── W13 — the executor-path gate registry ────────────────────────────────── */

let executorGate = null;

/** Registration target used by skills/gates/gated-dispatch.js (approved extension). */
export function registerExecutorGate(fn) {
  if (typeof fn !== 'function') {
    throw Object.assign(new TypeError('registerExecutorGate: gate must be a function'), { code: 'E_WIRING' });
  }
  executorGate = fn;
  return () => { executorGate = null; };
}

export function executorGateStatus() {
  return { registered: typeof executorGate === 'function' };
}

/**
 * Compose the SHIPPED tool executor with the registered gate in AUDIT-ONLY
 * mode: every execute() first runs the real gatedDispatch against an audit
 * stub (verdict recorded, never blocking), then delegates to the untouched
 * shipped executor for the real execution.
 */
export function makeGatedExecutor(opts = {}) {
  if (typeof executorGate !== 'function') {
    throw Object.assign(new Error('executor gate not registered (import skills/gates/gated-dispatch.js first)'), { code: 'E_WIRING' });
  }
  const inner = makeExecutor(opts);
  return {
    ...inner,
    async execute(call, ctx = {}) {
      let audit = null;
      try {
        audit = await executorGate(
          { name: `audit:${call.name}`, run: async () => ({ audited: true, tool: call.name }) },
          ctx
        );
      } catch (e) {
        audit = { blocked: false, gate: null, auditError: String(e && e.message || e).slice(0, 160) };
      }
      if (audit && audit.blocked) {
        // The shipped dispatcher returns blocks WITHOUT an audit line; record
        // the block consumer-side via the shipped recorder (audit-only — the
        // real call below still runs).
        appendAudit({ gate: audit.gate, action: call.name, blocked: true, auditOnly: true, reason: audit.reason ?? null });
      }
      const result = await inner.execute(call, ctx);
      return { ...result, gateAudit: { verdict: audit && audit.blocked ? 'blocked' : 'allowed', gate: (audit && audit.gate) || null, auditError: audit && audit.auditError } };
    },
  };
}

/* ── W14 / S4-N8N / W23c — mcp/registry.json declarative validation ──────── */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const REGISTRY_FILE = path.join(REPO_ROOT, 'server', 'mcp', 'registry.json');

/** Parse the registry and return the entries this scope owns (or null). */
export function mcpRegistryEntries(names = ['aas', 'n8n-mcp', 'forgejo-mcp']) {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (e) {
    throw Object.assign(new Error(`mcp registry unreadable: ${String(e && e.message || e).slice(0, 120)}`), { code: 'E_WIRING' });
  }
  const byName = new Map((parsed.servers || []).map((s) => [s.name, s]));
  return names.map((n) => byName.get(n) || null);
}

/* ── the one boot mount ───────────────────────────────────────────────────── */

export function initRegistriesWiring() {
  const gate = executorGateStatus();
  if (!gate.registered) {
    throw Object.assign(new Error('W13 gate not registered — skills/gates/gated-dispatch.js was not imported'), { code: 'E_WIRING' });
  }
  const entries = mcpRegistryEntries();
  const present = entries.map((e) => (e ? `${e.name}(enabled:${!!e.enabled})` : 'MISSING'));
  return { gate, entries: present };
}

export default initRegistriesWiring;
