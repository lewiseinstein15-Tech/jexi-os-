/**
 * JEXI OS — PHASE 13 SCOPE D — IDENTITY GRAPH.
 *
 * Answers "who is who" across the roster. Agents get a stable DID
 * (`did:jexi:<agentId>`, see did.js); names are aliases that resolve to a DID;
 * two DIDs that turn out to be the same entity are merged, and the merge is
 * recorded as an edge so the absorbed DID keeps resolving to the survivor.
 *
 *   const g = createIdentityGraph({ stateDir });
 *   g.create({ id: 'ui-designer', name: 'UI Designer' });
 *   g.create({ id: 'design-ui-designer', name: 'UI Designer' });
 *   g.resolve('UI Designer');                    // E_AMBIGUOUS_IDENTITY (two nodes, one name)
 *   g.merge('did:jexi:ui-designer', 'did:jexi:design-ui-designer');
 *   g.resolve('UI Designer');                    // -> the survivor
 *
 * The roster genuinely contains cases like this: 12 display names are held by
 * two agents each (one canonical, one vendored). The graph does not guess. An
 * alias owned by two live identities is refused with E_AMBIGUOUS_IDENTITY, and
 * only an explicit `merge` collapses them. That is the point of the graph: the
 * duplicate is visible and requires a decision, rather than resolving by
 * insertion order.
 *
 * Ordering is by op-seq, never by clock. Every mutation takes the next value of
 * a monotonic counter, which is persisted (identity-seq.txt) so a merge
 * survivor is stable across reloads: the older DID wins, and "older" means
 * "allocated the lower sequence number", not "created at an earlier wall time".
 *
 * Persistence writes two files under `stateDir`:
 *   identity-seq.txt    the last allocated sequence number
 *   identity-graph.json nodes, alias edges, and their seqs
 * Writes are atomic (temp file + rename) so a crash mid-write cannot leave a
 * half-written graph.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { toDid, isDid, agentIdFromDid, asDid, DID_PREFIX, DID_ERRORS, DidError } from './did.js';
import { StrategyError } from '../nexus/strategy.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../..');

/** Default state directory, relative to a repo root. */
export const STATE_DIR = 'workforce/identity/state';
export const SEQ_FILE = 'identity-seq.txt';
export const GRAPH_FILE = 'identity-graph.json';

/** Graph file schema version. */
export const GRAPH_VERSION = 1;

/** Error codes the identity graph can refuse with. */
export const ERRORS = {
  UNKNOWN_IDENTITY: 'E_UNKNOWN_IDENTITY',
  DUPLICATE_AGENT: 'E_DUPLICATE_AGENT',
  CYCLE: 'E_CYCLE',
  AMBIGUOUS_IDENTITY: 'E_AMBIGUOUS_IDENTITY',
  INVALID_AGENT: 'E_INVALID_AGENT',
};

/**
 * Refusal raised by the identity graph. The class is the NEXUS layer's
 * StrategyError (Phase 13's one-class-per-layer pattern — the same class
 * SpecError/DivisionError/StrategyError consumers already branch on), carrying
 * a stable `code` plus the detail the caller needs. Identity-specific error
 * codes are declared in ERRORS above; only the class is shared, no new error
 * class is introduced.
 */

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

const norm = (s) => String(s).trim().toLowerCase();

/** Atomic write: temp file in the same directory, then rename over the target. */
function writeAtomic(file, body) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

/**
 * Build an identity graph.
 *
 *   createIdentityGraph({ stateDir, persist }) -> graph
 *
 * `stateDir` defaults to `<repo>/workforce/identity/state`. `persist: false`
 * keeps everything in memory (useful for a throwaway graph); persistence is on
 * by default because the counter must survive a reload for merge survivors to
 * stay stable.
 */
export function createIdentityGraph(options = {}) {
  const persist = options.persist !== false;
  const root = options.root || REPO_ROOT;
  const stateDir = options.stateDir || path.join(root, STATE_DIR);
  const seqPath = path.join(stateDir, SEQ_FILE);
  const graphPath = path.join(stateDir, GRAPH_FILE);

  /** did -> node. A node is immutable identity + mutable merge pointer. */
  const nodes = new Map();
  /** alias (lowercased) -> Set<did> of nodes declaring it. */
  const byAlias = new Map();
  /** merge edges: absorbed did -> survivor did, with the seq of the merge op. */
  const edges = [];
  let seq = 0;
  let loaded = false;

  function nextSeq() {
    seq += 1;
    return seq;
  }

  function addAliasKey(key, did) {
    if (isBlank(key)) return;
    const k = norm(key);
    if (!byAlias.has(k)) byAlias.set(k, new Set());
    byAlias.get(k).add(did);
  }

  function rememberAliases(node) {
    addAliasKey(node.agentId, node.did);
    for (const a of node.aliases) addAliasKey(a, node.did);
  }

  /** Follow mergedInto to the identity that currently represents this node. */
  function rootOf(did) {
    let cur = nodes.get(did);
    if (!cur) return null;
    const seen = new Set();
    while (cur.mergedInto) {
      if (seen.has(cur.did)) {
        throw new StrategyError(ERRORS.CYCLE, `merge chain contains a cycle at ${cur.did}`, { did: cur.did, chain: [...seen] });
      }
      seen.add(cur.did);
      const next = nodes.get(cur.mergedInto);
      if (!next) break;
      cur = next;
    }
    return cur;
  }

  /** Every node whose root is `did` — the survivor plus everything absorbed. */
  function identityMembers(did) {
    return [...nodes.values()].filter((n) => rootOf(n.did).did === did).sort((a, b) => a.did.localeCompare(b.did));
  }

  function save() {
    if (!persist) return;
    fs.mkdirSync(stateDir, { recursive: true });
    const payload = {
      version: GRAPH_VERSION,
      seq,
      nodes: [...nodes.values()]
        .sort((a, b) => a.did.localeCompare(b.did))
        .map((n) => ({ did: n.did, agentId: n.agentId, aliases: [...n.aliases].sort(), seq: n.seq, mergedInto: n.mergedInto })),
      edges: [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    };
    writeAtomic(graphPath, JSON.stringify(payload, null, 2) + '\n');
    writeAtomic(seqPath, `${seq}\n`);
  }

  /**
   * Load a persisted graph. A missing state dir is an empty graph, not an error
   * (first run). A malformed file or a cyclic merge chain is an error, because
   * silently starting over would change identities.
   */
  function load(inputDir) {
    const dir = inputDir || stateDir;
    const gPath = path.join(dir, GRAPH_FILE);
    const sPath = path.join(dir, SEQ_FILE);
    nodes.clear();
    byAlias.clear();
    edges.length = 0;
    seq = 0;

    if (!fs.existsSync(gPath)) {
      loaded = true;
      return graph();
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(gPath, 'utf8'));
    } catch (err) {
      throw new StrategyError(ERRORS.INVALID_AGENT, `identity graph is not valid JSON: ${gPath}`, { path: gPath, cause: err.message });
    }
    for (const n of (data.nodes || [])) {
      nodes.set(n.did, { did: n.did, agentId: n.agentId, aliases: [...(n.aliases || [])], seq: n.seq, mergedInto: n.mergedInto || null });
    }
    for (const e of (data.edges || [])) edges.push({ from: e.from, to: e.to, seq: e.seq });
    for (const n of [...nodes.values()].sort((a, b) => a.did.localeCompare(b.did))) rememberAliases(n);
    // Defensive: a persisted cycle means the file was tampered with or written
    // by a future revision. Refuse rather than resolve through it.
    for (const n of nodes.values()) rootOf(n.did);

    let diskSeq = Number.isFinite(data.seq) ? data.seq : 0;
    if (fs.existsSync(sPath)) {
      const raw = Number.parseInt(fs.readFileSync(sPath, 'utf8').trim(), 10);
      if (Number.isFinite(raw)) diskSeq = Math.max(diskSeq, raw);
    }
    const maxNodeSeq = nodes.size ? Math.max(...[...nodes.values()].map((n) => n.seq || 0)) : 0;
    seq = Math.max(diskSeq, maxNodeSeq);
    loaded = true;
    return graph();
  }

  /**
   * Register an agent.
   *
   *   create({ id, name, aliases? }) -> { did, agentId }
   *   create('ui-designer')          -> { did, agentId }
   *
   * The display name becomes an alias. Throws E_DUPLICATE_AGENT when the
   * agentId is already a node — including one that a merge has absorbed, since
   * the node still exists and re-creating it would fork the identity.
   */
  function create(agent) {
    const spec = typeof agent === 'string' ? { id: agent } : (agent || {});
    if (!isBlank(spec.did) && isBlank(spec.id) && isBlank(spec.agentId)) {
      const { agentId } = asDid(spec.did);
      return create({ ...spec, id: agentId });
    }
    const agentId = spec.id || spec.agentId;
    if (isBlank(agentId)) {
      throw new StrategyError(ERRORS.INVALID_AGENT, 'agent must carry a non-blank id', { agentId });
    }
    let did;
    try {
      did = toDid(agentId);
    } catch (err) {
      if (err instanceof DidError) throw new StrategyError(ERRORS.INVALID_AGENT, err.message, { agentId });
      throw err;
    }
    if (nodes.has(did)) {
      throw new StrategyError(ERRORS.DUPLICATE_AGENT, `agent "${agentId}" already has identity ${did}`, { did, agentId });
    }
    const aliases = [];
    if (!isBlank(spec.name)) aliases.push(String(spec.name));
    if (Array.isArray(spec.aliases)) for (const a of spec.aliases) if (!isBlank(a)) aliases.push(String(a));
    const unique = [...new Set(aliases)].sort();
    const node = { did, agentId: String(agentId), aliases: unique, seq: nextSeq(), mergedInto: null };
    nodes.set(did, node);
    rememberAliases(node);
    save();
    return { did, agentId: node.agentId };
  }

  /**
   * Resolve a name, alias, agentId or DID to an identity.
   *
   *   resolve('ui-designer') -> { did, agentId }
   *
   * Follows the current graph, so an absorbed DID (or any alias of an absorbed
   * node) returns the survivor. An alias held by two live identities is refused
   * with E_AMBIGUOUS_IDENTITY and lists the candidates — the graph does not
   * pick one for you.
   */
  function resolve(nameOrAlias) {
    const raw = typeof nameOrAlias === 'string' ? nameOrAlias.trim() : nameOrAlias;
    if (isBlank(raw)) {
      throw new StrategyError(ERRORS.UNKNOWN_IDENTITY, 'cannot resolve a blank name', { name: nameOrAlias });
    }
    // A DID is an exact reference: it must be a node, or the identity is unknown.
    // Do not fall through to alias lookup, or a DID that was never created could
    // accidentally match some node's alias.
    if (isDid(raw)) {
      if (!nodes.has(raw)) {
        throw new StrategyError(ERRORS.UNKNOWN_IDENTITY, `no identity for ${JSON.stringify(raw)}`, { name: String(raw) });
      }
      const root = rootOf(raw);
      return { did: root.did, agentId: root.agentId, resolvedFrom: raw };
    }
    // A whitespace-free token may be an agentId; try it directly. A display name
    // like "UI Designer" cannot be a DID and goes straight to alias lookup.
    //
    // An exact agentId match is normally authoritative. It is NOT used here when
    // the same token is also a live alias of a different identity: the roster
    // holds agents whose display name equals another agent's id ("coder" is the
    // agentId of one agent and the lowercased name of another), and silently
    // preferring the id would be exactly the guess this module exists to refuse.
    // A caller who means the agent unambiguously passes the DID.
    if (!/\s/.test(raw)) {
      const candidate = DID_PREFIX + raw;
      if (nodes.has(candidate)) {
        const exact = rootOf(candidate).did;
        const otherRoots = [...new Set([...(byAlias.get(norm(raw)) || [])].map((d) => rootOf(d).did))]
          .filter((d) => d !== exact)
          .sort();
        if (otherRoots.length > 0) {
          throw new StrategyError(
            ERRORS.AMBIGUOUS_IDENTITY,
            `${JSON.stringify(raw)} is both the agentId of ${exact} and an alias of ${otherRoots.join(', ')}; pass a DID to disambiguate`,
            { name: String(raw), candidates: [exact, ...otherRoots].sort(), agentId: exact },
          );
        }
        return { did: exact, agentId: rootOf(candidate).agentId, resolvedFrom: candidate };
      }
    }
    const k = norm(raw);
    const hits = byAlias.get(k);
    if (!hits || hits.size === 0) {
      throw new StrategyError(ERRORS.UNKNOWN_IDENTITY, `no identity for ${JSON.stringify(nameOrAlias)}`, { name: String(nameOrAlias) });
    }
    const roots = [...new Set([...hits].map((d) => rootOf(d).did))].sort();
    if (roots.length > 1) {
      throw new StrategyError(
        ERRORS.AMBIGUOUS_IDENTITY,
        `alias ${JSON.stringify(nameOrAlias)} is held by ${roots.length} identities: ${roots.join(', ')}`,
        { name: String(nameOrAlias), candidates: roots },
      );
    }
    const root = nodes.get(roots[0]);
    return { did: root.did, agentId: root.agentId };
  }

  /**
   * Merge two identities. The survivor is the older DID by creation op-seq.
   *
   *   merge(didA, didB) -> { merged, survivor, absorbed }
   *
   * Aliases of the absorbed side (all of them, including its absorbed subtree)
   * are folded into the survivor, and the absorbed DID is recorded as an edge,
   * so resolve() on any of them maps to the survivor afterwards.
   *
   * A merge whose operands already share a root is refused with E_CYCLE: the
   * survivor would have to absorb itself. With oldest-wins ordering that is the
   * only reachable cycle, and it is refused rather than treated as a no-op so a
   * caller cannot mistake a redundant merge for a real one.
   */
  function merge(a, b) {
    const na = asDid(a);
    const nb = asDid(b);
    if (!nodes.has(na.did) || !nodes.has(nb.did)) {
      const missing = [!nodes.has(na.did) ? na.did : null, !nodes.has(nb.did) ? nb.did : null].filter(Boolean);
      throw new StrategyError(ERRORS.UNKNOWN_IDENTITY, `unknown identity: ${missing.join(', ')}`, { dids: missing });
    }
    const ra = rootOf(na.did);
    const rb = rootOf(nb.did);
    if (ra.did === rb.did) {
      throw new StrategyError(
        ERRORS.CYCLE,
        `merge would create a cycle: ${na.did} and ${nb.did} are already the same identity (${ra.did})`,
        { didA: na.did, didB: nb.did, root: ra.did },
      );
    }
    const [survivor, absorbed] = ra.seq <= rb.seq ? [ra, rb] : [rb, ra];
    // Fold in every alias declared anywhere in the absorbed identity, not just
    // the root's, so a deep alias keeps resolving after the merge.
    const absorbedMembers = identityMembers(absorbed.did);
    const merged = new Set(survivor.aliases);
    for (const m of absorbedMembers) {
      merged.add(m.agentId);
      for (const al of m.aliases) merged.add(al);
    }
    survivor.aliases = [...merged].sort();
    absorbed.mergedInto = survivor.did;
    const edge = { from: absorbed.did, to: survivor.did, seq: nextSeq() };
    edges.push(edge);
    save();
    return {
      merged: true,
      survivor: { did: survivor.did, agentId: survivor.agentId },
      absorbed: { did: absorbed.did, agentId: absorbed.agentId },
      // Same set aliases(survivor.did) reports, so the merge result and a later
      // lookup agree.
      aliases: aliases(survivor.did),
      seq: edge.seq,
    };
  }

  /**
   * Every name this identity answers to: its own agentId, the agentIds and
   * names of everything absorbed into it, sorted and deduped.
   */
  function aliases(didOrAgentId) {
    const { did } = asDid(didOrAgentId);
    if (!nodes.has(did)) {
      throw new StrategyError(ERRORS.UNKNOWN_IDENTITY, `unknown identity: ${did}`, { did });
    }
    const root = rootOf(did);
    const out = new Set();
    for (const m of identityMembers(root.did)) {
      out.add(m.agentId);
      for (const al of m.aliases) out.add(al);
    }
    return [...out].sort();
  }

  /**
   * The graph as data.
   *
   *   graph() -> { nodes, edges }
   *
   * Nodes sort by DID. A node carries `status` ('active' for a survivor,
   * 'merged' for an absorbed node) and `root` (the DID it currently resolves
   * to), so a reader does not have to re-walk the edges. Edges sort by
   * (from, to).
   */
  function graph() {
    const list = [...nodes.values()].sort((a, b) => a.did.localeCompare(b.did));
    return {
      nodes: list.map((n) => {
        const root = rootOf(n.did);
        return {
          did: n.did,
          agentId: n.agentId,
          aliases: [...n.aliases].sort(),
          seq: n.seq,
          mergedInto: n.mergedInto,
          root: root.did,
          status: n.mergedInto ? 'merged' : 'active',
        };
      }),
      edges: [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)).map((e) => ({ ...e })),
    };
  }

  function stats() {
    const list = [...nodes.values()];
    const identities = new Set(list.map((n) => rootOf(n.did).did));
    return {
      nodes: list.length,
      identities: identities.size,
      merged: list.filter((n) => n.mergedInto).length,
      edges: edges.length,
      aliases: byAlias.size,
      seq,
    };
  }

  return {
    create, resolve, merge, aliases, graph, load, save, stats,
    stateDir, seqPath, graphPath,
    get size() { return nodes.size; },
    get loaded() { return loaded; },
  };
}