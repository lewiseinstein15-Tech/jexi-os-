// research/workgraph/experiment-node.js
// PHASE 21 SCOPE F — ExperimentNode as a work-graph node type.
//
// This is the IN-ZONE adapter the phase contract asked for: it talks to the
// REAL Phase 4 work graph (`server/src/workgraph/index.js`) through its public
// API — createWorkGraph, addNode, claim, complete, fail, setStatus, checkpoint,
// restore, readyWork. NOTHING under server/** is edited; the graph is imported
// exactly as it ships, with its SQLite checkpointing, leases, and recovery
// classification intact.
//
// Status transitions on experiment outcome (real graph statuses):
//   created  -> 'pending'/'ready'        (graph readiness/dependencies)
//   claimed  -> 'running'                (lease acquired via graph.claim)
//   kept     -> 'completed'              (graph.complete with metric evidence)
//   discarded-> 'superseded'             (a better experiment replaced it)
//   crashed  -> graph.fail() decision    (retry -> 'pending', or permanent/logical recovery node)
//
// 'experiment' is added as a node type at the adapter boundary. The graph's
// addNode does not validate type against the frozen NODE_TYPES list, so this
// needs no server-side change; the graph's verification gate only applies to
// type 'task', so experiment completion is decided by the experiment outcome
// itself (the keep/discard verdict), with evidence attached either way.
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_MODULE = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'src', 'workgraph', 'index.js'),
).href;

const { createWorkGraph } = await import(GRAPH_MODULE);

export const EXPERIMENT_OWNER = 'jexi-research';

// Build an experiment node object for graph.addNode().
export function experimentNode({ id, hypothesis, experimentDir, metricName = 'val_metric', dependencies = [] } = {}) {
  return {
    id,
    type: 'experiment',
    objective: hypothesis,
    status: 'pending',
    dependencies: [...dependencies],
    experimentDir,
    metricName,
    createdAt: Date.now(),
  };
}

// CONTRACT
//   createExperimentGraph({ file }) -> adapter over a real createWorkGraph()
export function createExperimentGraph({ file } = {}) {
  const graph = createWorkGraph({ file });

  return {
    graph,
    addExperimentNode(spec) {
      const node = experimentNode(spec);
      graph.addNode(node);
      graph.recomputeStatuses();
      return node;
    },
    // Full lifecycle against the REAL graph:
    //   claim -> run -> complete | superseded | fail
    // runFn: async ({ node }) => ({ kept, metric, evidence? })
    async runExperimentNode(nodeId, runFn) {
      const claimed = await graph.claim(nodeId, EXPERIMENT_OWNER);
      if (!claimed.ok) return { verdict: 'blocked', status: claimed.reason, node: null };
      const node = claimed.node;

      let outcome;
      try {
        outcome = await runFn({ node });
      } catch (err) {
        const failed = await graph.fail(nodeId, {
          owner: EXPERIMENT_OWNER,
          failure: { class: 'crashed', reason: String(err?.message ?? err) },
        });
        return { verdict: 'crashed', status: node.status, decision: failed.decision, node, recoveryNode: failed.recoveryNode ?? null };
      }

      const crashed = outcome?.crashed === true;
      const evidence = [
        {
          source: 'experiment-run',
          at: Date.now(),
          content: `${node.metricName}=${outcome?.metric ?? 'n/a'}`,
          meta: { metric: outcome?.metric ?? null, kept: outcome?.kept === true, ...(outcome?.evidence ?? {}) },
        },
      ];

      if (!crashed && outcome?.kept === true) {
        await graph.complete(nodeId, { owner: EXPERIMENT_OWNER, evidence, artifacts: [] });
        return { verdict: 'kept', status: 'completed', node: graph.byId(nodeId) };
      }
      if (!crashed) {
        graph.setStatus(nodeId, 'superseded');
        await graph.checkpoint();
        return { verdict: 'discarded', status: 'superseded', node: graph.byId(nodeId) };
      }
      const failed = await graph.fail(nodeId, {
        owner: EXPERIMENT_OWNER,
        failure: {
          class: outcome?.errorClass ?? 'crashed',
          reason: outcome?.error ?? 'experiment crashed',
        },
      });
      return { verdict: 'crashed', status: node.status, decision: failed.decision, node, recoveryNode: failed.recoveryNode ?? null };
    },
    // Compact state for display: every node's id/type/status (+ metric evidence).
    graphState() {
      return graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        status: n.status,
        metric: n.evidence?.length ? n.evidence[n.evidence.length - 1].meta?.metric ?? null : null,
        retryCount: n.retryCount ?? 0,
      }));
    },
  };
}

export { createWorkGraph };
