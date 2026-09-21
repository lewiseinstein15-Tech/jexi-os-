/**
 * JEXI OS — PHASE 13 SCOPE C — STRATEGY DOC LOADER.
 *
 *   loadProjection(root?)  read the committed vendor projection
 *   inspectCheckout(src)   check an upstream checkout before re-projecting
 *
 * `loadProjection` is what the runtime uses: it reads
 * workforce/nexus/vendor/agency-agents.strategies.json and returns the rows
 * plus provenance (upstream, commit, count). It does NOT normalize or validate
 * — that is strategy.js's job — so this module imports nothing from the rest of
 * the nexus layer and cannot create a cycle.
 *
 * Projecting an upstream checkout is the generator's job, not this module's
 * (scripts/phase13-vendor-nexus.mjs). `inspectCheckout` here only reports
 * whether an upstream tree is present and complete, so a caller can explain a
 * missing-doc failure. There is deliberately ONE projection implementation; a
 * second one in the runtime would be the thing that drifts.
 *
 * The vendored projection is preferred over re-reading upstream at runtime:
 * upstream is not vendored into the repo, and a route decision must not depend
 * on network access or on which upstream revision happens to be checked out.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../..');

/** Path to the committed projection, relative to a repo root. */
export const PROJECTION_PATH = 'workforce/nexus/vendor/agency-agents.strategies.json';

/** Error raised when the projection is missing or unreadable. */
export class DocsError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'DocsError';
    Object.assign(this, detail);
  }
}

/**
 * Read the committed vendor projection.
 *
 *   loadProjection(root?) -> {
 *     source, upstream, upstreamCommit, license, count,
 *     kinds, aliasCollisions, strategies: [raw rows]
 *   }
 *
 * `root` defaults to the repo this module lives in. Throws DocsError when the
 * file is missing or not valid JSON — a missing projection is a broken build,
 * not an empty strategy set, and must not degrade into "no strategies match".
 */
export function loadProjection(root = REPO_ROOT) {
  const file = path.join(root, PROJECTION_PATH);
  if (!fs.existsSync(file)) {
    throw new DocsError(`strategy projection not found: ${file}`, { path: file, code: 'E_NO_PROJECTION' });
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new DocsError(`strategy projection is not valid JSON: ${file}`, { path: file, code: 'E_BAD_PROJECTION', cause: err.message });
  }
  const strategies = data.strategies;
  if (!Array.isArray(strategies)) {
    throw new DocsError(`strategy projection has no strategies[] array: ${file}`, { path: file, code: 'E_BAD_PROJECTION' });
  }
  return {
    source: PROJECTION_PATH,
    upstream: data.upstream || null,
    upstreamCommit: data.upstreamCommit || null,
    license: data.license || null,
    note: data.note || null,
    count: Number.isFinite(data.count) ? data.count : strategies.length,
    kinds: Array.isArray(data.kinds) ? [...data.kinds] : [],
    aliasCollisions: Array.isArray(data.aliasCollisions) ? [...data.aliasCollisions] : [],
    strategies: strategies.map((s) => ({ ...s })),
  };
}

/**
 * The raw upstream docs the projection is derived from, for provenance and for
 * re-projection. Names only — the docs themselves are not vendored.
 */
export const UPSTREAM_DOCS = {
  doctrine: 'strategy/nexus-strategy.md',
  runbooks: 'strategy/runbooks.json',
  playbooks: [
    'strategy/playbooks/phase-0-discovery.md',
    'strategy/playbooks/phase-1-strategy.md',
    'strategy/playbooks/phase-2-foundation.md',
    'strategy/playbooks/phase-3-build.md',
    'strategy/playbooks/phase-4-hardening.md',
    'strategy/playbooks/phase-5-launch.md',
    'strategy/playbooks/phase-6-operate.md',
  ],
  scenarios: [
    'strategy/runbooks/scenario-startup-mvp.md',
    'strategy/runbooks/scenario-enterprise-feature.md',
    'strategy/runbooks/scenario-marketing-campaign.md',
    'strategy/runbooks/scenario-incident-response.md',
  ],
  coordination: [
    'strategy/coordination/agent-activation-prompts.md',
    'strategy/coordination/handoff-templates.md',
  ],
};

/**
 * Check whether an upstream checkout's strategy tree is present and complete
 * enough to re-project. Returns the doc paths found and those missing; never
 * throws, so a caller can report before attempting a projection.
 */
export function inspectCheckout(src) {
  const present = [];
  const missing = [];
  const all = [UPSTREAM_DOCS.doctrine, UPSTREAM_DOCS.runbooks, ...UPSTREAM_DOCS.playbooks, ...UPSTREAM_DOCS.scenarios, ...UPSTREAM_DOCS.coordination];
  for (const rel of all) {
    if (fs.existsSync(path.join(src, rel))) present.push(rel);
    else missing.push(rel);
  }
  return { src, present, missing, complete: missing.length === 0 };
}