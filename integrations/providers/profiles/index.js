/**
 * JEXI OS — Phase 27 Scope D — provider profiles (public surface).
 *
 *   profiles.load(path)    -> { profiles: [] }   (replaces the registry)
 *   profiles.get(name)     -> profile
 *   profiles.switch(name)  -> { active: profile }
 *   profiles.active()      -> profile
 *   profiles.validate(p)   -> { valid, errors? }
 *   profiles.list()        -> [profiles] sorted by name (deterministic)
 *
 * DECLARED RUNTIME DIRECTORY: ~/.jexi/profiles/ (exported as PROFILES_DIR,
 * openclaude pattern: .openclaude-profile.json under the config home).
 * This module only READS an explicit path — it NEVER writes the profiles
 * directory without explicit user action. Persisting the ACTIVE profile is
 * a zone-owner task: switch() changes the active pointer in memory only.
 *
 * Credential rule: profile.keyRef is an env-var name (credentials enter via
 * process.env at activation, the openclaude buildXxxProfileEnv pattern) or
 * a keyring reference. Inline credentials -> E_INLINE_KEY_REFUSED; the
 * module never imports a provider SDK — config only.
 *
 * Errors: E_UNKNOWN_PROFILE, E_NO_ACTIVE_PROFILE, plus loader/schema codes.
 */
import os from 'node:os';
import path from 'node:path';
import { ProfilesError } from './_internal.js';
import { loadProfiles } from './loader.js';
import { validate } from './schema.js';

export { ProfilesError } from './_internal.js';
export { validate, PROVIDERS, REQUIRED_FIELDS, findInlineKeys } from './schema.js';
export { loadProfiles } from './loader.js';

/** Declared (read-only) runtime location for profile files. */
export const PROFILES_DIR = path.join(os.homedir(), '.jexi', 'profiles');

let registry = [];
let activeName = null;

/** load(path) -> { profiles: [] }; replaces the registry and clears active. */
export function load(profilePath) {
  const { profiles } = loadProfiles(profilePath);
  registry = profiles;
  activeName = null;
  return { profiles: list() };
}

/** Deterministic ordering: by name. */
export function list() {
  return [...registry].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function get(name) {
  const profile = registry.find((p) => p.name === name);
  if (!profile) {
    throw new ProfilesError('E_UNKNOWN_PROFILE', `unknown profile "${String(name)}"; loaded: ${registry.map((p) => p.name).join(', ') || '(none)'}`);
  }
  return profile;
}

/** switch(name) -> { active: profile }; in-memory only. */
export function switchProfile(name) {
  const profile = get(name);
  activeName = profile.name;
  return { active: profile };
}

/** active() -> profile; E_NO_ACTIVE_PROFILE before the first switch. */
export function active() {
  if (activeName === null) {
    throw new ProfilesError('E_NO_ACTIVE_PROFILE', 'no active profile; call switch(name) first');
  }
  return get(activeName);
}

export const profiles = {
  load,
  list,
  get,
  switch: switchProfile,
  active,
  validate,
};

export default profiles;
