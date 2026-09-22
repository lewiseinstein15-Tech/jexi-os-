/**
 * JEXI OS — Phase 23 Scope B — forgejo-mcp transport (stdio + HTTP dispatch).
 *
 * The client side of the forgejo-mcp pattern: a tool call enters with a
 * name + args, is resolved against the taxonomy, validated LOCALLY, and
 * only then handed to a connection. The dispatch pipeline is strict about
 * order:
 *
 *   1. tool resolution   unknown name      -> { ok: false, error: 'E_UNKNOWN_TOOL' }
 *   2. param validation  missing required  -> { ok: false, error: 'E_MISSING_PARAM',
 *                                              missingParam: '<field>' }   (LOCAL —
 *                                              happens BEFORE any transport refusal)
 *   3. connection        no live forge     -> { ok: false, error: 'E_NO_FORGE_CONNECTION' }
 *
 * SANDBOX RULE (this phase): no live forge exists in this harness, so step
 * 3 refuses with E_NO_FORGE_CONNECTION for EVERY tool. Nothing is faked —
 * a dispatch either reaches a real forge or refuses. Wiring a live forge
 * (stdio server or HTTP base URL) is a carry-forward for the server
 * mcp/registry zone-owner.
 *
 * CREDENTIALS (Scope A discipline, reused read-only from madtea): the
 * transport config carries a keyRef — an env var name or a keyring:<ref> —
 * never an inline token. Inline tokens are refused E_INLINE_KEY_REFUSED
 * (madtea findInlineKeys), malformed refs E_INVALID_KEY_REF. The credential
 * is resolved only at connect time, which in this sandbox is never reached.
 *
 * Two transports share the pipeline:
 *   createTransport('stdio', { command })  — spawn/connect a forgejo-mcp server
 *   createTransport('http',  { baseUrl })  — POST tool calls to a forgejo-mcp HTTP endpoint
 */

import { SemanticaError } from '../../../semantica/_internal.js';
import { taxonomy } from './taxonomy.js';
import { findInlineKeys, resolveCredentials, ENV_REF_RE, KEYRING_REF_RE } from '../madtea/credentials.js';

/** The transports this module knows. */
export const TRANSPORT_KINDS = Object.freeze(['stdio', 'http']);

/**
 * Required-param check (local, transport-independent). A param is missing
 * when it is absent, null, or an empty string — present-but-empty is still
 * absent for the purposes of a required field.
 */
export function missingParams(tool, args = {}) {
  return tool.params.filter((p) => {
    if (!p.required) return false;
    const v = args[p.name];
    return v === undefined || v === null || v === '';
  });
}

/**
 * Validate the credential-bearing parts of a transport config without
 * resolving anything: inline credentials refused, keyRef shape checked.
 * Resolution happens at connect time only (never reached in sandbox).
 */
function checkConfig(config) {
  const inline = findInlineKeys(config);
  if (inline.length > 0) {
    throw new SemanticaError('E_INLINE_KEY_REFUSED', `inline credential field(s) refused: ${inline.join(', ')}; pass keyRef (env var name or keyring:<ref>) instead`);
  }
  if (config.keyRef !== undefined) {
    if (typeof config.keyRef !== 'string' || (!ENV_REF_RE.test(config.keyRef) && !KEYRING_REF_RE.test(config.keyRef))) {
      throw new SemanticaError('E_INVALID_KEY_REF', `keyRef must be an env var name (UPPER_SNAKE) or a keyring reference (keyring:<service>[/<key>]), got ${JSON.stringify(config.keyRef)}`);
    }
  }
  return config;
}

/**
 * Build a transport. Throws (caller mistakes, before any dispatch):
 *   E_UNKNOWN_TRANSPORT    kind is not stdio | http
 *   E_INLINE_KEY_REFUSED   config carries an inline credential field
 *   E_INVALID_KEY_REF      config.keyRef matches neither reference shape
 */
export function createTransport(kind = 'stdio', config = {}) {
  if (!TRANSPORT_KINDS.includes(kind)) {
    throw new SemanticaError('E_UNKNOWN_TRANSPORT', `unknown transport "${String(kind)}"; known: ${TRANSPORT_KINDS.join(', ')}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'transport config must be a plain object');
  }
  checkConfig(config);

  return {
    kind,
    /** Resolve the configured credential at connect time (sandbox: unreached). */
    resolveToken(keyring) {
      return resolveCredentials({ keyRef: config.keyRef, keyring });
    },
    dispatch(toolName, args) {
      return dispatchOn(kind, toolName, args);
    },
  };
}

/** Shared dispatch pipeline. Never throws for operational outcomes. */
function dispatchOn(kind, toolName, args) {
  // 1 — resolve the tool locally.
  if (typeof toolName !== 'string' || toolName.trim() === '') {
    return { ok: false, error: 'E_UNKNOWN_TOOL' };
  }
  let tool;
  try {
    tool = taxonomy.get(toolName);
  } catch (e) {
    if (e.code === 'E_UNKNOWN_TOOL') {
      return { ok: false, error: 'E_UNKNOWN_TOOL' };
    }
    throw e;
  }

  // 2 — validate params LOCALLY, before the transport refuses.
  const missing = missingParams(tool, args);
  if (missing.length > 0) {
    return { ok: false, error: 'E_MISSING_PARAM', missingParam: missing[0].name, missing: missing.map((m) => m.name) };
  }

  // 3 — connection. No live forge exists in this harness: refuse, never fake.
  return {
    ok: false,
    error: 'E_NO_FORGE_CONNECTION',
    transport: kind,
    tool: tool.name,
  };
}

/** Default stdio transport — the contract entry point. */
export const transport = createTransport('stdio');

/** Contract: dispatch(toolName, args) -> { ok, result?, error? }. */
export function dispatch(toolName, args = {}) {
  return transport.dispatch(toolName, args);
}
