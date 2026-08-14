/**
 * JEXI OS — Graph Runner (Priority 1: real graph orchestrator)
 * ------------------------------------------------------------
 * A small hand-rolled graph runtime: nodes are `Map<nodeName, fn>`, edges are
 * resolved per-step by a function of the current state, and a run loop with a
 * max-step guard makes infinite cycles impossible. No external dependency —
 * this codebase has not outgrown a hand-rolled runner.
 *
 * B50 P6 — TYPED NODES + OUTCOMES + PARALLEL JOIN:
 *   - Node types: 'agent' | 'tool' | 'verifier' | 'gate'. A node may be
 *     declared as `{ type, run, retries, fallback }`:
 *       run       — (state) => state (same contract as before)
 *       type      — semantic label; the runner does not enforce behavior,
 *                   but the type is surfaced in state.nodeTypes[node] and
 *                   used by tests/UI to render the right shape.
 *       retries   — max AUTO re-runs when the node sets outcome 'retry'.
 *       fallback  — where to route when the node sets outcome 'fallback'.
 *   - Outcomes: a node sets `state.outcome` to 'success' | 'retry' |
 *     'fallback' (or leaves it null). The runner reacts:
 *       'retry'   → re-run the SAME node (bounded by retries, then fallback).
 *       'fallback'→ route to `node.fallback` if declared, else the edge.
 *   - Edges with conditions: edge resolvers receive state and may branch on
 *     `state.outcome` (e.g. `(s) => s.outcome === 'fallback' ? 'recover' : 'end'`).
 *     `when({ success, retry, fallback, default })` is a convenience builder.
 *   - runParallel: fan a set of node fns out onto concurrent state slices and
 *     JOIN them back into the shared state — each fn writes its result under
 *     `intermediateResults[name]`, and `join` merges afterwards.
 *
 * @typedef {Object} RunState  — flows through EVERY node of EVERY request.
 *   (see the original typedef: query, plan, intermediateResults, currentNode,
 *    status, retryCount, lastError, outcome, history, agentResult, context …)
 */

/** Convenience edge builder: branch on the current node's outcome. */
export function when(map) {
  return (state) => {
    const key = state.outcome || 'default';
    return map[key] !== undefined ? map[key] : (map.default || 'end');
  };
}

/** Run node fns in PARALLEL and join: each writes intermediateResults[name].
 *  @param {Array<{name: string, run: (state)=>Promise<state>|state}>} fns
 *  @param {object} state  shared RunState (copied per fan; join merges back)
 *  @param {(state)=>state} [join]  called with the merged state at the end
 */
export async function runParallel({ fns = [], state, join = null }) {
  const slices = await Promise.all(fns.map(async (fn) => {
    const slice = { ...state, context: { ...(state.context || {}) }, intermediateResults: { ...(state.intermediateResults || {}) } };
    const out = (await fn.run(slice)) || slice;
    return { name: fn.name, out };
  }));
  for (const { name, out } of slices) {
    state.intermediateResults = state.intermediateResults || {};
    state.intermediateResults[name] = out.intermediateResults?.[name] !== undefined
      ? out.intermediateResults[name]
      : (out.result !== undefined ? out.result : out);
  }
  return join ? join(state) : state;
}

/**
 * Build a graph.
 *
 * @param {Object} cfg
 * @param {Record<string, fn | {type, run, retries, fallback}>} cfg.nodes
 * @param {Record<string, (state) => string|undefined>} cfg.edges
 * @param {string} [cfg.start]  Entry node name (default 'start').
 * @param {string} [cfg.end]    Terminal name (default 'end' — no node needed).
 * @param {number} [cfg.maxSteps]  Hard guard against infinite cycles.
 * @param {function} [cfg.onError]  (state, node) => state — exception recovery.
 */
export function createGraph({ nodes, edges, start = 'start', end = 'end', maxSteps = 64, onError = null } = {}) {
  const nodeMap = new Map();
  const nodeTypes = {};
  for (const [name, def] of Object.entries(nodes || {})) {
    if (typeof def === 'function') {
      nodeMap.set(name, def);
      nodeTypes[name] = 'agent';
    } else {
      nodeMap.set(name, def.run);
      nodeTypes[name] = def.type || 'agent';
    }
  }
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
      nodeTypes: {},
      ...initialState,
    };
    state.nodeTypes = nodeTypes;

    let node = initialState.startNode || start;
    let steps = 0;

    while (node && node !== end && steps < maxSteps) {
      if (state.status === 'done' || state.status === 'paused') break;
      const rawDef = nodes[node];
      const def = typeof rawDef === 'function' ? { run: rawDef } : (rawDef || {});
      const fn = nodeMap.get(node);
      if (!fn) {
        state.status = 'failed';
        state.lastError = { code: 'UNKNOWN_NODE', message: `Graph has no node named "${node}"`, node };
        break;
      }

      if (state.currentNode === node) state.retryCount += 1;
      else state.retryCount = 0;

      state.currentNode = node;
      state.history.push(node);

      let next;
      try {
        state = (await fn(state)) || state;
        // B50 P6 — outcome-driven routing: auto-retry, then fallback, then edge.
        if (state.outcome === 'retry' && state.retryCount < (def.retries || 0)) {
          continue; // re-run the SAME node (bounded)
        }
        if (state.outcome === 'fallback' && def.fallback) {
          next = def.fallback;
        } else {
          const resolver = edgeMap.get(node) || edgeMap.get('*');
          next = resolver ? await resolver(state) : end;
        }
      } catch (e) {
        state.status = 'failed';
        state.lastError = { code: 'NODE_THREW', message: (e && e.message) || String(e), node };
        if (onError) state = (await onError(state, node)) || state;
        else state.outcome = 'fallback';
        if (def.fallback && state.outcome === 'fallback') next = def.fallback;
        else {
          const resolver = edgeMap.get(node) || edgeMap.get('*');
          next = resolver ? await resolver(state) : end;
        }
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

  return { run, nodeMap, edgeMap, nodeTypes };
}
