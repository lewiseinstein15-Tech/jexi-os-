/**
 * JEXI OS — Phase 27 Scope D — profile loader (disk -> registry).
 *
 * loadProfiles(path) accepts:
 *   - a JSON FILE containing { profiles: [...] } | [...] | one profile object
 *   - a DIRECTORY where every *.json file is one profile object
 *     (read in sorted filename order — deterministic)
 *
 * The declared runtime directory is ~/.jexi/profiles/ (see index.js header):
 * this module only READS an explicit path — it never writes any profile
 * directory without explicit user action.
 *
 * Every loaded profile passes full schema validation before it enters the
 * registry; a file containing an inline credential refuses the whole load
 * (E_INLINE_KEY_REFUSED). Duplicate names are refused (E_DUPLICATE_PROFILE).
 *
 * Errors: E_PROFILE_NOT_FOUND, E_PROFILE_PARSE_ERROR, E_INLINE_KEY_REFUSED,
 *         E_DUPLICATE_PROFILE, E_INVALID_PROFILE, E_MISSING_FIELD,
 *         E_INVALID_NAME, E_UNKNOWN_PROVIDER, E_INVALID_KEY_REF.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ProfilesError } from './_internal.js';
import { assertProfileValid } from './schema.js';

export function loadProfiles(profilePath) {
  if (typeof profilePath !== 'string' || profilePath.length === 0) {
    throw new ProfilesError('E_PROFILE_NOT_FOUND', 'profile path must be a non-empty string');
  }
  let stat;
  try {
    stat = fs.statSync(profilePath);
  } catch {
    throw new ProfilesError('E_PROFILE_NOT_FOUND', `no profile file or directory at "${profilePath}"`);
  }

  const files = stat.isDirectory()
    ? fs.readdirSync(profilePath).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(profilePath, f))
    : [profilePath];

  const loaded = [];
  const seen = new Map();
  for (const file of files) {
    const profiles = readProfilesFromFile(file);
    for (const profile of profiles) {
      assertProfileValid(profile, `${file}`);
      if (seen.has(profile.name)) {
        throw new ProfilesError('E_DUPLICATE_PROFILE', `duplicate profile name "${profile.name}" (${file} and ${seen.get(profile.name)})`);
      }
      seen.set(profile.name, file);
      loaded.push(profile);
    }
  }

  loaded.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { profiles: loaded };
}

function readProfilesFromFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err2) {
    throw new ProfilesError('E_PROFILE_NOT_FOUND', `cannot read profile file "${file}": ${err2.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProfilesError('E_PROFILE_PARSE_ERROR', `profile file "${file}" is not valid JSON`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.profiles)) return parsed.profiles;
  return [parsed];
}
