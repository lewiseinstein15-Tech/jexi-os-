/**
 * JEXI OS — PHASE 31 SCOPE 3 — WA4: swarm topologies -> workforce dispatch.
 *
 * APPROVED live-server mount (Scope 2 report disclosed the patch; the lead
 * approved the dedicated module for Scope 3). CONNECT, do not rebuild:
 *
 *   - swarm/topologies/** is READ-ONLY. build()/list()/validate() are called
 *     exactly as shipped; no adapter reshapes their records.
 *   - server/src/workforce/registry (composeWorkforce) is the dispatch-side
 *     consumer. Members come straight off the authoritative Employees roster.
 *   - Default is behavior-neutral PASSTHROUGH: dispatch without a topology
 *     request returns the composed member list untouched — the pre-WA4
 *     behavior. A topology is applied only when explicitly requested.
 *
 * Mounted once from initPhase31Wiring (phase31-bootstrap.js). Fail-soft:
 * any break logs one `W31 WA4: FAIL-SOFT <reason>` line and boot continues.
 */

import * as topologies from '../../../agents/swarm/topologies/index.js';
import { composeWorkforce, ensureIndex } from '../workforce/registry/index.js';

export function initWa4Topology() {
  const known = topologies.list(); // real registry read — proves the module loaded

  /**
   * composeWorkforce -> topologies.build/validate, one accessor.
   *   dispatch(capability)                       -> passthrough (no topology)
   *   dispatch(capability, { topology: 'star' }) -> build + validate, real edges
   * ensureIndex() is the registry's own public idempotent init — composing
   * from an unindexed roster would silently under-report members.
   */
  function dispatch(capability, opts = {}) {
    ensureIndex();
    const team = composeWorkforce(capability, opts);
    const members = team.map((a) => a.slug);
    if (!opts.topology) {
      return { topology: null, passthrough: true, capability, members, known };
    }
    const topo = topologies.build(String(opts.topology), members);
    const checked = topologies.validate(topo);
    return {
      topology: { type: topo.type, members: topo.members, edges: topo.edges },
      validate: checked,
      route: typeof topo.route === 'function' ? (from, to) => topo.route(from, to) : null,
      passthrough: false,
      capability,
      members,
      known,
    };
  }

  return { dispatch, known, topologies };
}

export default initWa4Topology;
