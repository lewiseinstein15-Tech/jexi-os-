/**
 * JEXI OS — PHASE 13 SCOPE D — DID-STYLE IDENTITY IDS.
 *
 *   import { toDid, isDid, agentIdFromDid } from './did.js';
 *   toDid('ui-designer')                    // 'did:jexi:ui-designer'
 *   agentIdFromDid('did:jexi:ui-designer')  // 'ui-designer'
 *
 * A DID here is `did:jexi:<agentId>` — the W3C DID grammar's `did:<method>:<id>`
 * shape with method `jexi` and the agentId as the method-specific id.
 *
 * It is a pure function of the agentId. There is no registry, no random suffix,
 * no clock: the same agentId always yields the same DID, so two independent
 * graphs agree on identity for the same agent. That is what lets a merge be
 * recorded as an edge between stable endpoints rather than as a renumbering.
 *
 * The agentId is used verbatim as the method-specific id, so `did:jexi:` is the
 * only encoding. An agentId therefore must not contain ':' — a value like
 * `a:b` would parse back as a different agentId. `toDid` refuses that rather
 * than emitting a DID that cannot round-trip.
 */

/** DID method for this graph. */
export const METHOD = 'jexi';

/** The prefix every JEXI DID starts with. */
export const DID_PREFIX = `did:${METHOD}:`;

/** Error codes specific to DID parsing. */
export const DID_ERRORS = {
  INVALID_DID: 'E_INVALID_DID',
};

/** Refusal raised by the DID helpers. Same shape as the other Phase 13 errors. */
export class DidError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DidError';
    this.code = code;
    Object.assign(this, detail);
  }
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Build the DID for an agentId.
 *
 *   toDid('ui-designer') -> 'did:jexi:ui-designer'
 *
 * Throws E_INVALID_DID on a blank agentId or one containing ':' (which would
 * not round-trip through `agentIdFromDid`).
 */
export function toDid(agentId) {
  if (isBlank(agentId)) {
    throw new DidError(DID_ERRORS.INVALID_DID, 'agentId must be a non-empty string');
  }
  const id = String(agentId).trim();
  if (id.includes(':')) {
    throw new DidError(DID_ERRORS.INVALID_DID, `agentId must not contain ':': ${JSON.stringify(id)}`, { agentId: id });
  }
  if (/\s/.test(id)) {
    throw new DidError(DID_ERRORS.INVALID_DID, `agentId must not contain whitespace: ${JSON.stringify(id)}`, { agentId: id });
  }
  return DID_PREFIX + id;
}

/** True when `value` is a syntactically valid JEXI DID. */
export function isDid(value) {
  return typeof value === 'string'
    && value.startsWith(DID_PREFIX)
    && value.length > DID_PREFIX.length
    && !value.slice(DID_PREFIX.length).includes(':');
}

/**
 * Split a DID into its parts.
 *
 *   parseDid('did:jexi:ui-designer') -> { method: 'jexi', agentId: 'ui-designer' }
 *
 * Throws E_INVALID_DID when the value is not a JEXI DID.
 */
export function parseDid(did) {
  if (!isDid(did)) {
    throw new DidError(DID_ERRORS.INVALID_DID, `not a JEXI DID: ${JSON.stringify(did)}`, { did });
  }
  return { method: METHOD, agentId: did.slice(DID_PREFIX.length) };
}

/** The agentId inside a JEXI DID. Throws E_INVALID_DID on anything else. */
export function agentIdFromDid(did) {
  return parseDid(did).agentId;
}

/**
 * Accept either an agentId or a DID and return `{ did, agentId }`.
 * A pass-through for DIDs, a construction for bare agentIds. Used by the graph
 * so its public methods take either form.
 */
export function asDid(value) {
  if (isDid(value)) return { did: value, agentId: agentIdFromDid(value) };
  return { did: toDid(value), agentId: String(value).trim() };
}