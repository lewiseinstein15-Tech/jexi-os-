/**
 * JEXI OS — Phase 26 Scope D — evolved artifact emission.
 *
 * The artifact is a STRUCTURED RECORD persisted inside the instincts
 * root only (<root>/projects/<projectId>/evolved/<clusterId>.json and
 * .../clusters/<clusterId>.json for state). No writes outside owned
 * locations. generatedAt is an op-seq number — no clocks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir } from '../observe/scope.js';

const clustersDir = (root, projectId) => path.join(projectDir(root, projectId), 'clusters');
const evolvedDir = (root, projectId) => path.join(projectDir(root, projectId), 'evolved');

export const KINDS = ['skill', 'command', 'agent'];

const unionSorted = (arrays) => [...new Set([].concat(...arrays))].sort();

export function buildArtifact(cluster, instincts, kind, generatedAt) {
  const evidenceTexts = [];
  const examples = [];
  for (const inst of instincts) {
    for (const e of inst.evidence || []) {
      const text = typeof e === 'string' ? e : e && e.text;
      if (typeof text === 'string') evidenceTexts.push(text);
    }
    for (const x of inst.examples || []) examples.push(x);
  }
  return {
    kind,
    projectId: cluster.projectId,
    clusterId: cluster.clusterId,
    action: cluster.sharedPrefix || instincts.map((i) => i.action).sort()[0],
    evidence: unionSorted([evidenceTexts]),
    examples: unionSorted([examples]),
    instinctIds: [...cluster.instinctIds],
    confidence: cluster.confidence, // aggregate: mean of member confidences (declared in cluster.js)
    generatedAt,
  };
}

export function saveArtifact(root, projectId, artifact) {
  const dir = evolvedDir(root, projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, artifact.clusterId + '.json'), JSON.stringify(artifact, null, 2) + '\n');
  return artifact;
}

export function saveState(root, projectId, state) {
  const dir = clustersDir(root, projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, state.clusterId + '.json'), JSON.stringify(state, null, 2) + '\n');
  return state;
}

export function loadState(root, projectId, clusterId) {
  const f = path.join(clustersDir(root, projectId), clusterId + '.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
