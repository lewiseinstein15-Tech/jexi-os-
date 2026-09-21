/**
 * JEXI OS — Phase 27 Scope D — profile schema + validation.
 *
 * A profile is a NAMED PROVIDER CONFIG (openclaude ProviderProfile shape,
 * config.ts:222 — name/provider/model plus credential handling) with one
 * hard security rule: credentials are REFERENCES, never inline values.
 * keyRef is either an env-var name (the openclaude buildXxxProfileEnv
 * pattern: credentials enter via process.env at activation) or a keyring
 * reference (`keyring:<name>`).
 *
 *   profile = { name, provider, model, keyRef }
 *
 * validate(profile) -> { valid, errors? }  — accumulates EVERY problem,
 * never throws. load()-time validation (assertProfileValid) throws the
 * first typed error, with E_INLINE_KEY_REFUSED taking precedence: a file
 * containing a secret is refused outright.
 *
 * Errors: E_INVALID_PROFILE, E_MISSING_FIELD, E_INVALID_NAME,
 *         E_UNKNOWN_PROVIDER, E_INVALID_KEY_REF, E_INLINE_KEY_REFUSED.
 */
import { ProfilesError } from './_internal.js';

export const PROVIDERS = Object.freeze(['anthropic', 'openai', 'google', 'ollama', 'openrouter']);

export const REQUIRED_FIELDS = Object.freeze(['name', 'provider', 'model', 'keyRef']);

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const ENV_REF_RE = /^[A-Z_][A-Z0-9_]*$/;
// keyring refs carry service/account path segments: keyring:<seg>[/<seg>...]
export const KEYRING_REF_RE = /^keyring:[A-Za-z0-9][A-Za-z0-9._/:-]*$/;

/** Field names that must never appear with a value inside a profile. */
export const INLINE_KEY_FIELD_RE = /^(api[-_]?key|key|secret|token|password|access[-_]?token|private[-_]?key)$/i;

function err(code, field, message) {
  return { code, field, message };
}

/** True if the profile body carries any inline credential-shaped value. */
export function findInlineKeys(profile) {
  const found = [];
  if (!profile || typeof profile !== 'object') return found;
  for (const [field, value] of Object.entries(profile)) {
    if (INLINE_KEY_FIELD_RE.test(field) && typeof value === 'string' && value.length > 0) {
      found.push(field);
    }
  }
  return found;
}

export function validate(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, errors: [err('E_INVALID_PROFILE', null, 'profile must be an object')] };
  }
  const errors = [];

  // Inline-key refusal outranks everything (security rule).
  for (const field of findInlineKeys(profile)) {
    errors.push(err('E_INLINE_KEY_REFUSED', field, `field "${field}" looks like an inline credential; profiles carry keyRef references only`));
  }

  for (const field of REQUIRED_FIELDS) {
    const value = profile[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.length === 0)) {
      errors.push(err('E_MISSING_FIELD', field, `required field "${field}" is missing or empty`));
    }
  }
  if (errors.some((e) => e.code === 'E_INLINE_KEY_REFUSED')) {
    return { valid: false, errors };
  }

  if (profile.name !== undefined && !NAME_RE.test(String(profile.name))) {
    errors.push(err('E_INVALID_NAME', 'name', `name ${JSON.stringify(profile.name)} must match ${NAME_RE}`));
  }
  if (profile.provider !== undefined && !PROVIDERS.includes(profile.provider)) {
    errors.push(err('E_UNKNOWN_PROVIDER', 'provider', `provider ${JSON.stringify(profile.provider)} is not known; known: ${PROVIDERS.join(', ')}`));
  }
  if (profile.keyRef !== undefined) {
    const keyRef = String(profile.keyRef);
    if (!ENV_REF_RE.test(keyRef) && !KEYRING_REF_RE.test(keyRef)) {
      errors.push(err('E_INVALID_KEY_REF', 'keyRef', `keyRef must be an env var name (e.g. OPENAI_API_KEY) or a keyring reference (keyring:<service>[/<account>])`));
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Load-time validation: throws the first typed error (inline keys first). */
export function assertProfileValid(profile, context = 'profile') {
  const result = validate(profile);
  if (result.valid) return;
  const first = result.errors.find((e) => e.code === 'E_INLINE_KEY_REFUSED') ?? result.errors[0];
  throw new ProfilesError(first.code, `${context}: ${first.message}`);
}
