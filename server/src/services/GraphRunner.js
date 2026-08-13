/**
 * JEXI OS — Graph Runner (Priority 1: real graph orchestrator)
 * ------------------------------------------------------------
 * A small hand-rolled graph runtime: nodes are `Map<nodeName, fn>`, edges are
 * resolved per-step by a function of the current state, and a run loop with a
 * max-step guard makes infinite cycles impossible. No external dependency —
 * this codebase has not outgrown a hand-rolled runner.
 *
 * Every node function takes and returns a `RunState` (or a documented slice of
 * it). Nodes may mutate the state they receive and return it; the runner makes
 * sure `history`, `retryCount` and `status` stay truthful.
 *
 * @typedef {Object} RunState  — flows through EVERY node of EVERY request.
 *   query:               string           — the raw user message.
 *   resolvedQuery:       string           — query after context resolution
 *                                           (anaphora / continuity rewrite).
 *   plan:                Object|null      — planner output. Canonical shape:
 *                                           { intent, tasks|steps|teamSlugs,
 *                                             phases?, scope?, reasoning?,
 *                                             payload?, planSummary, roster,
 *                                             skillsLine, tools, ... }.
 *   memoryLoadout:       Object           — memory injected BEFORE the planner
 *                                           (Priority 6) and per-specialist:
 *                                           { preferences, facts, semantic,
 *                                             agentNotes }.
 *   intermediateResults: Object           — { [nodeName]: AgentResult } — every
 *                                           node's normalized output, keyed by
 *                                           node, so later nodes (replanner,
 *                                           responder) can read prior results.
 *   currentNode:         string           — the node that just ran.
 *   status:              'idle'|'running'|'paused'|'done'|'failed' — lifecycle.
 *   retryCount:          number           — consecutive re-entries of the SAME
 *                                           node (cycle protection + P8 retry).
 *   lastError:           { code, message, node }|null — last structured failure.
 *   outcome:             'success'|'retry'|'fallback'|'ask_user'|null — how the
 *                                           current node wants the graph to
 *                                           proceed (P8: no silent failures).
 *   needsConfirmation:   boolean          — parked at confirmationPause.
 *   confirmationPayload: Object|null      — what the user must approve
 *                                           ({ action, risk, node, summary }).
 *   history:             string[]         — ordered node names visited (audit).
 *   agentResult:         Object|null      — final normalized AgentResult the
 *                                           responder produces:
 *                                           { success, summary, data, sources,
 *                                             error: { code, message }|null }.
 *   context:             Object           — node scratch space (e.g. the coding
 *                                           subgraph keeps files/entryPoint/
 *                                           lastOutput/previewUrl here).
 */

/**
 * Build a graph.
 *
 * @param {Object} cfg
 * @param {Record<string, (state: RunState) => Promise<RunState>|RunState>} cfg.nodes
 *   Every node fn takes and returns a RunState.
 * @param {Record<string, (state: RunState) => string|undefined>} cfg.edges
 *   Edge resolver per source node; returning a node name moves there, returning
 *   undefined (or a node with no resolver) ends the run. `'*'` is the fallback.
 * @param {string} [cfg.start]  Entry node name (default 'start').
 * @param {string} [cfg.end]    Terminal name (default 'end' — no node needed).
 * @param {number} [cfg.maxSteps]  Hard guard against infinite cycles.
 * @param {function} [cfg.onError]  (state, node) => state — called when a node
 *   THROWS; lets the graph convert exceptions into structured lastError and
 *   route to replanner/responder instead of crashing the run.
 */
export function createGraph({ nodes, edges, start = 'start', end = 'end', maxSteps = 64, onError = null } = {}) {
  const nodeMap = new Map(Object.entries(nodes || {}));
  const edgeMap = new Map(Object.entries(edges || {}));

  /** Run the graph from `initialState`. Returns the final RunState. */
  async function run(initialState = {}) {
    let state = {
      query: '',
      resolvedQuery: '',
      plan: null,
      memoryLoadout: {},
      intermediateResults: {},
      currentNode: '',
      status: 'running',
      retryCount: 0,
      lastError: null,
      outcome: null,
      needsConfirmation: false,
      confirmationPayload: null,
      history: [],
      agentResult: null,
      context: {},
      ...initialState,
    };

    // P5 — resume support: the caller may start the run at any node
    // (e.g. a confirmed confirmationPause restarts at the paused node).
    let node = initialState.startNode || start;
    let steps = 0;

    while (node && node !== end && steps < maxSteps) {
      // Terminal states end the run no matter what the edges say (belt and
      // suspenders — e.g. the responder must never re-enter itself).
      if (state.status === 'done' || state.status === 'paused') break;
      const fn = nodeMap.get(node);
      if (!fn) {
        state.status = 'failed';
        state.lastError = { code: 'UNKNOWN_NODE', message: `Graph has no node named "${node}"`, node };
        break;
      }

      // Cycle protection: re-entering the same node is a retry, not a loop.
      if (state.currentNode === node) state.retryCount += 1;
      else state.retryCount = 0;

      state.currentNode = node;
      state.history.push(node);

      let next;
      try {
        state = (await fn(state)) || state;
        const resolver = edgeMap.get(node) || edgeMap.get('*');
        next = resolver ? await resolver(state) : end;
      } catch (e) {
        state.status = 'failed';
        state.lastError = { code: 'NODE_THREW', message: (e && e.message) || String(e), node };
        // P1/P8 — a thrown node becomes a structured failure routed through the
        // node's edge (or the '*' fallback): NEVER silently ends the run.
        if (onError) state = (await onError(state, node)) || state;
        else state.outcome = 'fallback';
        const resolver = edgeMap.get(node) || edgeMap.get('*');
        next = resolver ? await resolver(state) : end;
      }
      node = next || end;
      steps += 1;
    }

    if (steps >= maxSteps) {
      state.status = 'failed';
      state.lastError = state.lastError || { code: 'MAX_STEPS', message: `Graph exceeded ${maxSteps} steps (possible cycle)`, node: state.currentNode };
    }
    if (state.status === 'running') state.status = 'done';
    return state;
  }

  return { run, nodeMap, edgeMap };
}
