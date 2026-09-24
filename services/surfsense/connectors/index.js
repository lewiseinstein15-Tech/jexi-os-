/**
 * JEXI OS — Phase 19 Scope A — connector registry.
 *
 * SurfSense research note: SurfSense dispatches per-source connectors through
 * a service layer keyed by search source; here that becomes a uniform
 * registry with deterministic ordering. connector.assert() is enforced at
 * registry load: a connector that fails shape validation cannot be
 * registered, so the module throws before any probe can run.
 *
 * Contract:
 *   registry.list()                -> connector[]   (sorted by name)
 *   registry.get(name)             -> connector     (throws E_UNKNOWN_CONNECTOR)
 *   registry.fetch(name, query, opts) -> { documents[] } (E_LIVE_UNAVAILABLE
 *                                     for live:false connectors; result
 *                                     documents validated; relevance order
 *                                     owned by the connector and
 *                                     deterministic by contract)
 */
import { SurfError } from './_internal.js';
import { assertConnector, assertDocument } from './_connector.js';

import localSearch from './local-search.js';
import reddit from './reddit.js';
import youtube from './youtube.js';
import instagram from './instagram.js';
import tiktok from './tiktok.js';
import indeed from './indeed.js';
import googleSearch from './google-search.js';
import maps from './maps.js';
import slack from './slack.js';
import linear from './linear.js';
import jira from './jira.js';
import clickup from './clickup.js';
import notion from './notion.js';
import github from './github.js';
import discord from './discord.js';
import confluence from './confluence.js';

const REGISTRY = new Map();
for (const connector of [
  localSearch,
  reddit,
  youtube,
  instagram,
  tiktok,
  indeed,
  googleSearch,
  maps,
  slack,
  linear,
  jira,
  clickup,
  notion,
  github,
  discord,
  confluence,
]) {
  // Enforced at registry load: fail fast on any malformed connector.
  assertConnector(connector);
  if (REGISTRY.has(connector.name)) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `duplicate connector name "${connector.name}"`);
  }
  REGISTRY.set(connector.name, connector);
}

/** Deterministic: name-ascending, byte-identical across calls. */
export function list() {
  return [...REGISTRY.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function get(name) {
  const connector = REGISTRY.get(name);
  if (!connector) {
    throw new SurfError('E_UNKNOWN_CONNECTOR', `no connector named "${name}"`);
  }
  return connector;
}

// Result ordering is the CONNECTOR's responsibility and must be deterministic
// (local-search: BM25 score desc, document-id asc tiebreak). The registry
// validates documents but deliberately does NOT re-sort: relevance ranking is
// search semantics and re-sorting it by provenance would destroy it.

export async function fetch(name, query, opts) {
  const connector = get(name);
  const result = await connector.fetch(query, opts);
  if (result === null || typeof result !== 'object' || !Array.isArray(result.documents)) {
    throw new SurfError(
      'E_CONNECTOR_INCOMPLETE',
      `connector "${name}" fetch() result must be { documents[] }`
    );
  }
  for (const doc of result.documents) assertDocument(doc, name);
  return { documents: result.documents };
}

export default { list, get, fetch };
