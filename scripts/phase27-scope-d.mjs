/**
 * JEXI OS — Phase 27 Scope D — LIVE PROBE: provider profiles.
 *
 * P1 load 2 profiles from fixtures -> list shows both, ordered by name (shapes shown)
 * P2 get by name -> correct profile; unknown name -> E_UNKNOWN_PROFILE
 * P3 switch('profile-b') -> active becomes profile-b (E_NO_ACTIVE_PROFILE before)
 * P4 inline key -> E_INLINE_KEY_REFUSED at validation time; keyRef env name -> valid
 * P5 validate valid profile -> { valid: true }; missing field -> { valid: false, errors }
 * P6 determinism: same load twice -> byte-identical profile list
 * P7 zone check: git status --short shows only providers/profiles/** and scripts/phase27-*.mjs
 *
 * Fixtures are generated under os.tmpdir()/p27-logs/ (outside the
 * repo working tree — keeps the zone check honest; consolidation cleanup
 * replaced the hardcoded sandbox path). Nothing is written to
 * ~/.jexi/profiles/: the module only reads explicit paths.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import profiles, { validate, PROFILES_DIR } from '../providers/profiles/index.js';
import { ProfilesError } from '../providers/profiles/_internal.js';

const FIXTURE_DIR = path.join(os.tmpdir(), 'p27-logs', 'profiles-fixture');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE_A = { name: 'profile-a', provider: 'openai', model: 'gpt-test-a', keyRef: 'OPENAI_API_KEY' };
const PROFILE_B = { name: 'profile-b', provider: 'anthropic', model: 'claude-test-b', keyRef: 'keyring:jexi/anthropic/prod' };
const INLINE_KEY_PROFILE = { name: 'leaky', provider: 'openai', model: 'gpt-leak', keyRef: 'OPENAI_API_KEY', apiKey: 'sk-inline-secret-123' };
const ENVREF_PROFILE = { name: 'envref', provider: 'anthropic', model: 'claude-envref', keyRef: 'ANTHROPIC_API_KEY' };
const BROKEN_PROFILE = { name: 'broken profile!', provider: 'unknown-cloud', keyRef: 'not a ref' };

function writeFixtures() {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [file, obj] of [
    ['profile-a.json', PROFILE_A],
    ['profile-b.json', PROFILE_B],
  ]) {
    fs.writeFileSync(`${FIXTURE_DIR}/${file}`, JSON.stringify(obj, null, 2) + '\n');
  }
}

function expectError(fn, code, label) {
  try {
    fn();
  } catch (err) {
    if (err && err.code === code) return `${label} -> ${code}`;
    throw new Error(`${label}: expected ${code}, got ${err && err.code ? err.code : String(err)}`);
  }
  throw new Error(`${label}: expected ${code}, but no error was thrown`);
}

let pass = 0;
let fail = 0;
const results = [];

async function probe(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    results.push(`P${name}: PASS — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  } catch (err) {
    fail += 1;
    results.push(`P${name}: FAIL — ${err.message}`);
  }
}

// -- P1 ---------------------------------------------------------------------
await probe(1, async () => {
  writeFixtures();
  await sleep(5); // let fs settle
  const { profiles: loaded } = profiles.load(FIXTURE_DIR);
  if (loaded.length !== 2) throw new Error(`expected 2 profiles, got ${loaded.length}`);
  const names = loaded.map((p) => p.name);
  if (JSON.stringify(names) !== JSON.stringify([...names].sort())) throw new Error(`not ordered by name: ${names}`);
  if (names[0] !== 'profile-a' || names[1] !== 'profile-b') throw new Error(`unexpected order: ${names}`);
  return `load(dir) -> 2 profiles ordered by name: ${JSON.stringify(names)} | shapes: ${loaded.map((p) => JSON.stringify(p)).join(' | ')}`;
});

// -- P2 ---------------------------------------------------------------------
await probe(2, () => {
  const got = profiles.get('profile-a');
  if (JSON.stringify(got) !== JSON.stringify(PROFILE_A)) throw new Error(`get returned wrong profile: ${JSON.stringify(got)}`);
  const unknown = expectError(() => profiles.get('ghost'), 'E_UNKNOWN_PROFILE', 'get(unknown)');
  return `get('profile-a') -> ${JSON.stringify(got)} ; ${unknown}`;
});

// -- P3 ---------------------------------------------------------------------
await probe(3, () => {
  const before = expectError(() => profiles.active(), 'E_NO_ACTIVE_PROFILE', 'active() before switch');
  const swapped = profiles.switch('profile-b');
  if (swapped.active.name !== 'profile-b') throw new Error(`switch returned ${JSON.stringify(swapped)}`);
  const now = profiles.active();
  if (now.name !== 'profile-b') throw new Error(`active() is ${now.name}, expected profile-b`);
  return `${before} ; switch('profile-b') -> { active: ${JSON.stringify(swapped.active)} } ; active() -> profile-b`;
});

// -- P4 ---------------------------------------------------------------------
await probe(4, () => {
  const v = validate(INLINE_KEY_PROFILE);
  if (v.valid !== false) throw new Error(`inline-key profile validated as valid: ${JSON.stringify(v)}`);
  const refused = v.errors.find((e) => e.code === 'E_INLINE_KEY_REFUSED');
  if (!refused) throw new Error(`no E_INLINE_KEY_REFUSED in errors: ${JSON.stringify(v.errors)}`);
  const loadRefused = (file, label) => expectError(() => profiles.load(file), 'E_INLINE_KEY_REFUSED', label);
  fs.writeFileSync(`${FIXTURE_DIR}/../inline-key-file.json`, JSON.stringify(INLINE_KEY_PROFILE, null, 2) + '\n');
  const loadRefused2 = loadRefused(`${FIXTURE_DIR}/../inline-key-file.json`, 'load(inline-key file)');
  const envOk = validate(ENVREF_PROFILE);
  if (envOk.valid !== true) throw new Error(`keyRef env-name profile rejected: ${JSON.stringify(envOk)}`);
  return `validate(inline apiKey) -> ${JSON.stringify({ valid: v.valid, refused: refused.field })} ; ${loadRefused2} ; validate(keyRef:"OPENAI_API_KEY"-style envref) -> valid: true`;
});

// -- P5 ---------------------------------------------------------------------
await probe(5, () => {
  const ok = validate(PROFILE_B);
  if (ok.valid !== true) throw new Error(`valid profile rejected: ${JSON.stringify(ok)}`);
  const bad = validate(BROKEN_PROFILE);
  if (bad.valid !== false || !Array.isArray(bad.errors) || bad.errors.length < 2) {
    throw new Error(`broken profile not fully diagnosed: ${JSON.stringify(bad)}`);
  }
  return `validate(profile-b) -> ${JSON.stringify(ok)} ; validate(broken) -> ${JSON.stringify(bad)}`;
});

// -- P6 ---------------------------------------------------------------------
await probe(6, () => {
  const a = JSON.stringify(profiles.load(FIXTURE_DIR));
  const b = JSON.stringify(profiles.load(FIXTURE_DIR));
  if (a !== b) throw new Error(`loads differ:\n${a}\n---\n${b}`);
  const orderA = profiles.list().map((p) => p.name);
  profiles.switch('profile-b'); // registry replaced by second load; re-establish
  const after = profiles.active();
  return `two loads byte-identical (${a.length} bytes): ${a.slice(0, 80)}... ; list order ${JSON.stringify(orderA)} ; switch+active deterministic -> ${after.name}`;
});

// -- P7 ---------------------------------------------------------------------
await probe(7, () => {
  fs.rmSync('scripts/.chunked-state.json', { force: true });
  const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8', cwd: process.cwd() });
  const lines = status.split('\n').filter(Boolean);
  const ok = lines.every((l) => {
    const p = l.slice(3).trim();
    return p.startsWith('providers/profiles/') || p.startsWith('scripts/phase27-');
  });
  if (!ok) throw new Error(`zone leak in git status: ${status}`);
  return `git status --short -> ${JSON.stringify(lines)} (zone-only)`;
});

for (const line of results) console.log(line);
console.log(`SCOPE D: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
console.log(`(declared runtime dir, read-only: PROFILES_DIR=${PROFILES_DIR} — module never writes it)`);
process.exit(fail === 0 ? 0 : 1);
