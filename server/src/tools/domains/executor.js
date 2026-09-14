/**
 * JEXI OS — tools — domain executor singleton.
 *
 * Built once from registerAllDomains() + makeExecutor(). The real runtime
 * (ToolRuntime.executeTool) dispatches domain slugs through this executor,
 * which applies schema → permission → risk → engine. Because the delegation
 * domain imports AgentLoop (which imports ToolRuntime), this module is loaded
 * lazily via dynamic import to avoid a static ESM cycle.
 */
import { makeExecutor } from '../index.js';
import { hasTool } from '../registry/ToolRegistry.js';
import { registerAllDomains } from './index.js';

let _domains = null;

export function domainExecutor() {
  if (!_domains) {
    _domains = registerAllDomains();
  }
  return _domains;
}

export function domainDispatch(slug, args, ctx = {}) {
  const domains = domainExecutor();
  // Domain tools are the host-level execution layer (real FS/network/processes),
  // so the risk guard runs at the host ring; the surrounding ToolRuntime gates
  // (profile permission, tier, approval) still apply above this point.
  const executor = makeExecutor({ engines: domains.engines, permissions: { allowAll: true }, risk: { sandboxRing: 'host' } });
  const call = { id: `${slug}-${Date.now().toString(36)}`, name: slug, arguments: args ?? {} };
  return executor.execute(call, ctx);
}

/** Number of domain tools registered (for diagnostics). */
export function domainToolCount() {
  return domainExecutor().engines ? Object.keys(domainExecutor().engines).length : 0;
}

/** True when the slug is an actual registered domain tool. */
export function hasDomainTool(slug) {
  return hasTool(slug);
}

export const _resetDomains = () => { _domains = null; };