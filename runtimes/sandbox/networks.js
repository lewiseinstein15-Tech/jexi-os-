/**
 * JEXI OS — Phase 8 Scope E — NETWORK DEFINITIONS.
 *
 * Decepticon's dual-network architecture: two isolated networks with ZERO
 * routes between them. The only path across the boundary is the controlled
 * exec-bridge (security/exec-bridge/). Every crossing is authenticated,
 * allowlisted, and logged.
 *
 *   Network A — jexi-net (management):
 *     kernel, providers, memory, workgraph, HUD producer, scheduler,
 *     knowledge graph, pipeline ORCHESTRATION.
 *     Sees: nothing on sandbox-net.
 *
 *   Network B — sandbox-net (execution):
 *     tools (browser, terminal, fs, git), security pipeline EXECUTION,
 *     the security agents' execution sandbox, offensive MCP servers.
 *     Sees: nothing on jexi-net.
 *
 * Docker vs process — stated plainly, never simulated:
 *   DOCKER (preferred, when a Docker daemon is available): both networks are
 *   created `--internal` (no gateway route out, no external reachability),
 *   on separate subnets, with no published ports and no container attached
 *   to both except the exec-bridge. Docker's embedded DNS is per-network, so
 *   sandbox-net names do not resolve from jexi-net and vice versa. Enforced
 *   by the kernel (netns + bridge filtering) — the strongest plane.
 *
 *   PROCESS (this sandbox — Docker unavailable): the isolation domain is a
 *   child process with a scrubbed environment, a dedicated workspace mount
 *   as cwd, and the runtime's dial guard. Same POLICY surface (who may call
 *   whom, what may cross, what gets logged), weaker ENFORCEMENT plane
 *   (env/cwd/routing-guard instead of netns). The difference is documented,
 *   never papered over — see DOCKER_VS_PROCESS.
 */

export const JEXI_NET = 'jexi-net';
export const SANDBOX_NET = 'sandbox-net';

export const NETWORKS = [
  {
    id: JEXI_NET,
    role: 'management',
    internal: true,
    subnet: '172.30.0.0/24',
    members: [
      'kernel', 'providers', 'memory', 'workgraph', 'hud-producer',
      'scheduler', 'knowledge-graph', 'pipeline-orchestration',
    ],
    // Docker creation (docker mode): internal = no external route at all.
    dockerCreateArgs: ['network', 'create', '--internal', '--subnet', '172.30.0.0/24', '--label', 'jexi.role=management', JEXI_NET],
  },
  {
    id: SANDBOX_NET,
    role: 'offensive',
    internal: true,
    subnet: '172.31.0.0/24',
    members: [
      'tools-browser', 'tools-terminal', 'tools-fs', 'tools-git',
      'security-pipeline-exec', 'security-agents-sandbox', 'mcp-offensive',
    ],
    dockerCreateArgs: ['network', 'create', '--internal', '--subnet', '172.31.0.0/24', '--label', 'jexi.role=offensive', SANDBOX_NET],
  },
];

/** The one controlled crossing — the ONLY dual-homed element in the topology. */
export const BRIDGE_MEMBER = 'exec-bridge';

export const ISOLATION_SPEC = {
  sharedRoutes: 0,
  dnsBetweenNetworks: false,
  portExposureBetweenNetworks: false,
  onlyPath: 'exec-bridge (authenticated, allowlisted, audited)',
};

/** What Docker would enforce differently — honest delta documentation. */
export const DOCKER_VS_PROCESS = [
  'DOCKER: --internal networks give kernel-level route isolation (no gateway, no L3 path between subnets). PROCESS: route isolation is the dial-guard policy + no cross-network endpoints in the scrubbed env; enforcement is in-process, not in-kernel.',
  'DOCKER: per-network embedded DNS — hostnames on the other network do not resolve. PROCESS: DNS is shared with the host; isolation is that no cross-network hostname is ever configured in the sandbox env.',
  'DOCKER: separate netns per container — a child cannot bind/reach the other network even if it tries. PROCESS: a hostile child could attempt host-level sockets; the dial guard and env scrub are policy controls, not kernel walls.',
  'DOCKER: only the exec-bridge container is attached to both networks; every other container is single-homed. PROCESS: every child is spawned with the scrubbed sandbox env + workspace cwd (single-homed equivalent).',
];

export function getNetwork(id) {
  return NETWORKS.find((n) => n.id === id) || null;
}

export function membersOf(id) {
  const n = getNetwork(id);
  return n ? [...n.members] : [];
}

/** True when `from` and `to` are the two DIFFERENT networks (a crossing). */
export function isCrossNetwork(from, to) {
  return from !== to && Boolean(getNetwork(from)) && Boolean(getNetwork(to));
}

/** Validate a network id used in dial guards / spawn contexts. */
export function validateNetworkId(id) {
  if (!getNetwork(id)) {
    throw new Error(`networks: unknown network id ${JSON.stringify(id)} — expected one of ${NETWORKS.map((n) => n.id).join(' | ')}`);
  }
  return id;
}

export default { JEXI_NET, SANDBOX_NET, NETWORKS, BRIDGE_MEMBER, ISOLATION_SPEC, DOCKER_VS_PROCESS, getNetwork, membersOf, isCrossNetwork, validateNetworkId };
