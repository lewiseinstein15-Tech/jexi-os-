/**
 * JEXI OS — Phase 23 Scope A — madtea credential injection, leak-safe.
 *
 * Credentials enter as REFERENCES, never inline values — the same discipline
 * providers/profiles established in Phase 27 (E_INLINE_KEY_REFUSED there,
 * reused verbatim here so the harness speaks one credential dialect):
 *
 *   keyRef = 'MADTEA_TOKEN'            -> env var, read at resolve time
 *   keyRef = 'keyring:<service>/<key>' -> caller-supplied keyring object
 *   token = 'ghp_...' (inline)         -> E_INLINE_KEY_REFUSED, always
 *
 * THE LEAK RULE
 * Once resolved, a credential value is registered in a SecretGuard. Every
 * string that is about to LEAVE madtea (step output, error messages, abort
 * reasons, the serialized finish result) is checked against the guard:
 *   - redact(text)   -> value replaced by [REDACTED]  (for displayable output)
 *   - assertClean()  -> throws E_CRED_LEAK (value withheld from the error)
 * The E_CRED_LEAK error message never contains the value — an error that
 * carries the secret it complains about would be the leak it reports.
 *
 * Errors (all SemanticaError from semantica/_internal.js, read-only reuse):
 *   E_INLINE_KEY_REFUSED  inline credential-shaped prop refused
 *   E_KEYREF_UNRESOLVED   keyRef names an env var / keyring entry that is absent
 *   E_CRED_LEAK           a credential value reached an output surface
 */

import { SemanticaError } from '../../../semantica/_internal.js';

/**
 * Field names that must never carry a value in a madtea props bag.
 * Mirrors providers/profiles/schema.js INLINE_KEY_FIELD_RE (Phase 27).
 */
export const INLINE_KEY_FIELD_RE = /^(api[-_]?key|key|secret|token|password|access[-_]?token|private[-_]?key)$/i;

/** Env-var-shaped keyRef: UPPER_SNAKE. */
export const ENV_REF_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Keyring-shaped keyRef: keyring:<segment>[/<segment>...]. */
export const KEYRING_REF_RE = /^keyring:[A-Za-z0-9][A-Za-z0-9._/:-]*$/;

/**
 * Refuse inline credentials in a props bag. Scans every field whose NAME
 * looks credential-shaped (token, secret, key, password, ...) and whose
 * value is a non-empty string. Returns the offending field names; callers
 * turn them into E_INLINE_KEY_REFUSED.
 */
export function findInlineKeys(props) {
  const found = [];
  if (!props || typeof props !== 'object' || Array.isArray(props)) return found;
  for (const [field, value] of Object.entries(props)) {
    if (INLINE_KEY_FIELD_RE.test(field) && typeof value === 'string' && value.length > 0) {
      found.push(field);
    }
  }
  return found;
}

/**
 * Resolve a credential from a keyRef reference.
 *
 *   resolveCredentials({ keyRef: 'MADTEA_TOKEN' })             -> env lookup
 *   resolveCredentials({ keyRef: 'keyring:svc/key', keyring }) -> keyring lookup
 *
 * keyring is a plain object or Map owned by the CALLER (a secrets manager
 * facade); madtea never persists keyring contents.
 *
 * Returns { found: true, value, source } — value is the secret itself and
 * must never be stringified into logs. { found: false } when the env var is
 * unset (credentials are optional for local-only operations). A keyring
 * reference that misses its entry is a hard error (E_KEYREF_UNRESOLVED):
 * an explicit reference that resolves to nothing is a caller bug, not an
 * optional absence.
 */
export function resolveCredentials({ keyRef, keyring, env = process.env } = {}) {
  if (keyRef === undefined || keyRef === null || keyRef === '') {
    return { found: false, source: null };
  }
  if (typeof keyRef !== 'string') {
    throw new SemanticaError('E_INVALID_KEY_REF', `keyRef must be a string (env var name or keyring:<ref>), got ${typeof keyRef}`);
  }
  if (ENV_REF_RE.test(keyRef)) {
    const value = env[keyRef];
    if (value === undefined || value === '') {
      return { found: false, source: `env:${keyRef}` };
    }
    return { found: true, value, source: `env:${keyRef}` };
  }
  if (KEYRING_REF_RE.test(keyRef)) {
    if (!keyring) {
      throw new SemanticaError('E_KEYREF_UNRESOLVED', `keyRef "${keyRef}" needs a keyring; none was provided`);
    }
    const key = keyRef.slice('keyring:'.length);
    const value = typeof keyring.get === 'function' ? keyring.get(key) : keyring[key];
    if (value === undefined || value === null || value === '') {
      throw new SemanticaError('E_KEYREF_UNRESOLVED', `keyRef "${keyRef}" not present in the provided keyring`);
    }
    return { found: true, value, source: keyRef };
  }
  throw new SemanticaError('E_INVALID_KEY_REF', `keyRef must be an env var name (UPPER_SNAKE) or a keyring reference (keyring:<service>[/<key>]), got a value matching neither shape`);
}

/**
 * A SecretGuard owns a set of secret VALUES and vouches for every string
 * that leaves the module. Construct from every credential value resolved
 * for the current operation (values, not references).
 *
 *   redact(text)     -> displayable text, values replaced by [REDACTED]
 *   assertClean(t,w) -> throws E_CRED_LEAK (value withheld) if any value appears
 */
export function createSecretGuard(secrets = []) {
  const values = secrets.filter((s) => typeof s === 'string' && s.length > 0);
  const hit = (text) => values.find((v) => text.includes(v));

  return {
    /** Number of registered values (never the values). */
    get size() { return values.length; },
    /** Replace every registered value with [REDACTED]. */
    redact(text) {
      let out = String(text);
      for (const v of values) out = out.split(v).join('[REDACTED]');
      return out;
    },
    /**
     * Leak check: if any registered value appears in text, throw E_CRED_LEAK.
     * The thrown message names WHERE, never WHAT — the value stays out of
     * the error chain by construction.
     */
    assertClean(text, where = 'output') {
      const found = hit(String(text));
      if (found !== undefined) {
        throw new SemanticaError('E_CRED_LEAK', `credential leak detected in ${where} (value withheld; ${values.length} secret(s) registered with this guard)`);
      }
    },
    /** True if any registered value appears in text (for probes; no value leaves). */
    leaks(text) {
      return hit(String(text)) !== undefined;
    },
  };
}

/** Guard with zero registered secrets — redact() is identity, assertClean() passes. */
export function nullGuard() {
  return createSecretGuard([]);
}
