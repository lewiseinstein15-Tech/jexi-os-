/**
 * JEXI OS — PHASE 13 SCOPE E — TRUST (facade).
 *
 *   import { createTrust } from './workforce/trust/index.js';
 *   const trust = createTrust();
 *   trust.record('ui-designer', { kind: 'review', summary: '…' }, { verified: true });
 *   trust.score('ui-designer');        // -> { score, history[] }
 *   const { sig, payload } = trust.sign('ui-designer', { vote: 'approve' });
 *   trust.verify('ui-designer', payload, sig);   // -> { valid: true }
 *
 * Contract surface (the scope contract, exactly):
 *
 *   trust.record(agentId, action, { verified }) -> { score, history }
 *   trust.score(agentId)                        -> { score, history[] }
 *   trust.sign(agentId, payload)                -> { sig, payload }
 *   trust.verify(agentId, payload, sig)         -> { valid, reason? }
 *
 * Rules (declared in README.md):
 *   - Score is a pure function of the verified history (no wall clock).
 *   - Verified actions move the score; unverified never do.
 *   - HMAC signing with a per-agent key derived from agentId; no key store,
 *     no credential literals.
 *   - verify is valid only when signature AND payload hash match; mismatches
 *     are attributed (E_PAYLOAD_MISMATCH / E_SIG_MISMATCH).
 *   - Unknown agentId -> E_UNKNOWN_AGENT on StrategyError (Phase 13 taxonomy —
 *     one class per layer; no new error class).
 *   - Persistence: workforce/trust/state/trust-seq.txt + trust-state.json,
 *     op-seq ordered, no clocks. Reload is byte-identical.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { scoreOf } from './scoring.js';
import { sign as signPayload, payloadHash, canonicalJSON, deriveKey, SCHEME } from './signing.js';
import { verify as verifyPayload, REASONS } from './verify.js';
import { createRegistry } from '../agents/registry.js';
import { StrategyError } from '../nexus/strategy.js';

/** Error codes the trust layer refuses with (carried on StrategyError). */
export const ERRORS = {
  UNKNOWN_AGENT: 'E_UNKNOWN_AGENT',
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../..');
const SEQ_FILE = 'trust-seq.txt';
const STATE_FILE = 'trust-state.json';

export { scoreOf, signPayload, payloadHash, canonicalJSON, deriveKey, SCHEME, verifyPayload, REASONS, StrategyError };

/**
 * Build a trust instance.
 *
 *   createTrust({ root, agents }) -> trust
 *
 * `root` overrides the repo root (probes use temp roots). `agents` injects a
 * Scope A registry; when omitted, one is built lazily, read-only, and an
 * unknown agentId is refused by checking the graph of recorded agents first
 * and the roster second — an agentId that exists in neither is E_UNKNOWN_AGENT.
 */
export function createTrust(options = {}) {
  const root = options.root || REPO_ROOT;
  const stateDir = path.join(root, 'workforce', 'trust', 'state');
  let agents = options.agents || null;
  let seq = 0;
  let loaded = false;

  /** agentId -> { agentId, history: [{ seq, action, verified }], ops } */
  const ledger = new Map();

  function roster() {
    if (!agents) {
      // Read-only Scope A consumer: the trust layer never writes roster files.
      agents = createRegistry({ root });
      agents.load();
    }
    return agents;
  }

  function seqPath() { return path.join(stateDir, SEQ_FILE); }
  function statePath() { return path.join(stateDir, STATE_FILE); }

  function nextSeq() {
    seq += 1;
    return seq;
  }

  function persist() {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(seqPath(), `${seq}\n`, 'utf8');
    const state = { scheme: SCHEME, seq, agents: [...ledger.values()] };
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  /**
   * Hydrate from disk. Returns the state, or null when nothing persisted yet.
   * A seq file without a state file (half-write) is refused, not silently
   * reset.
   */
  function load() {
    loaded = true;
    if (!fs.existsSync(statePath())) {
      if (fs.existsSync(seqPath())) {
        throw new StrategyError(ERRORS.UNKNOWN_AGENT, 'trust state is inconsistent: seq file exists without a state file', { stateDir });
      }
      seq = 0;
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (!raw || !Array.isArray(raw.agents)) {
      throw new StrategyError(ERRORS.UNKNOWN_AGENT, 'trust state is malformed', { stateDir });
    }
    ledger.clear();
    for (const rec of raw.agents) {
      ledger.set(rec.agentId, { agentId: rec.agentId, history: rec.history || [], ops: rec.ops || 0 });
    }
    seq = Number(fs.readFileSync(seqPath(), 'utf8').trim()) || 0;
    return raw;
  }

  function exists(agentId) {
    if (ledger.has(agentId)) return true;
    const reg = roster();
    return !!(reg && reg.has && reg.has(agentId));
  }

  function requireAgent(agentId) {
    if (!exists(agentId)) {
      throw new StrategyError(ERRORS.UNKNOWN_AGENT, `unknown agent "${agentId}"`, { agentId });
    }
  }

  /**
   * Record an action. Only verified actions move the score (scoring.js);
   * every action — verified or not — lands in the history with its verdict.
   */
  function record(agentId, action, { verified = false } = {}) {
    requireAgent(agentId);
    const rec = ledger.get(agentId) || { agentId, history: [], ops: 0 };
    rec.ops += 1;
    rec.history.push({ seq: nextSeq(), action: action == null ? null : JSON.parse(JSON.stringify(action)), verified: verified === true });
    ledger.set(agentId, rec);
    persist();
    const { score } = scoreOf(rec.history);
    return { score, history: [...rec.history] };
  }

  /** The score and full history of an agent. */
  function score(agentId) {
    requireAgent(agentId);
    const rec = ledger.get(agentId);
    const history = rec ? [...rec.history] : [];
    const { score: s } = scoreOf(history);
    return { score: s, history };
  }

  /** Sign a payload under the agent's derived key. */
  function sign(agentId, payload) {
    requireAgent(agentId);
    const signed = signPayload(agentId, payload);
    return { sig: signed.sig, payload: signed.payload, hash: signed.hash };
  }

  /** Verify payload+sig under the agent's key (payload-first attribution). */
  function verify(agentId, payload, sig, expected = null) {
    requireAgent(agentId);
    return verifyPayload(agentId, payload, sig, expected);
  }

  function seqValue() { return seq; }
  function stateDirPath() { return stateDir; }
  function isLoaded() { return loaded; }
  /** All recorded agents, sorted — for the probe and for exports. */
  function recordedAgents() { return [...ledger.keys()].sort(); }

  return {
    load, record, score, sign, verify,
    seqValue, stateDirPath, isLoaded, recordedAgents,
  };
}

/** The module-level default trust, bound to this repo's state dir. */
let _default = null;

export function defaultTrust() {
  if (!_default) _default = createTrust();
  return _default;
}

export function load() { return defaultTrust().load(); }
export function record(agentId, action, opts) { return defaultTrust().record(agentId, action, opts); }
export function score(agentId) { return defaultTrust().score(agentId); }
export function sign(agentId, payload) { return defaultTrust().sign(agentId, payload); }
export function verify(agentId, payload, sig, expected) { return defaultTrust().verify(agentId, payload, sig, expected); }
