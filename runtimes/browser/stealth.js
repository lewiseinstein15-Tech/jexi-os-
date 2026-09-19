/**
 * JEXI OS — Phase 17 Scope A — OBSCURA STEALTH PROFILE.
 *
 * Stealth in Obscura is identity CONSISTENCY plus tracker blocking, not
 * challenge solving. `--stealth` switches the HTTP client to browser-matching
 * TLS fingerprints (ClientHello, ALPN, cipher order), loads a tracker
 * blocklist, and bundles webpki roots. The engine additionally presents one of
 * a built-in pool of browser profiles and keeps `navigator.platform`,
 * `navigator.userAgentData`, the UA string, timezone and geolocation in
 * agreement with each other — a mismatch between those surfaces is itself a
 * fingerprint, which is why rotation is opt-in rather than the default.
 *
 * ── POLICY BOUNDARY (matches server/src/services/BrowserRouter.js) ──────────
 * This module configures fingerprint CONSISTENCY ONLY. It does not solve,
 * bypass or farm CAPTCHAs, and it does not defeat active bot-management
 * challenges. Obscura's own documentation states stealth does not handle
 * Cloudflare interactive challenges, Datadome/Akamai bot manager active
 * challenges, CAPTCHAs, or IP-based rate limiting. Those stay unhandled here
 * by design: BrowserRouter refuses CAPTCHA/challenge bypass outright, and this
 * module must not become a way around that refusal.
 */

import { spawn as nodeSpawn } from 'node:child_process';

/** Environment variables Obscura reads for identity, with their defaults. */
export const STEALTH_ENV_SPEC = {
  OBSCURA_PROFILE: {
    kind: 'index',
    default: null,
    doc: 'Pin one profile from the built-in pool (0-based). Without it a single stable profile is used.',
  },
  OBSCURA_ROTATE_PROFILE: {
    kind: 'bool',
    default: false,
    doc: 'Random profile per browser context. Leave OFF when a TLS fingerprint, proxy region or timezone is pinned — a rotated profile no longer matches those.',
  },
  OBSCURA_TIMEZONE: {
    kind: 'string',
    default: 'Europe/Berlin',
    doc: 'Pinned before V8/ICU reads it so Date and Intl.DateTimeFormat agree. Set to match the exit IP region.',
  },
  OBSCURA_GEOLOCATION: {
    kind: 'latlon',
    default: null,
    doc: 'Coordinates reported by the navigator.geolocation shim, as "lat,lon". Keep consistent with timezone and proxy region.',
  },
  OBSCURA_ALLOW_PRIVATE_NETWORK: {
    kind: 'bool',
    default: false,
    doc: 'Permit loopback/RFC1918/link-local targets. OFF by default (SSRF guard, DNS-rebinding safe).',
  },
};

/** Values `OBSCURA_ROTATE_PROFILE` and `OBSCURA_ALLOW_PRIVATE_NETWORK` accept as truthy. */
export const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * What stealth actually changes, and what it explicitly does not.
 * Kept as data so probes and docs report the same thing.
 */
export const STEALTH_CAPABILITIES = {
  handles: [
    'Basic bot detection that inspects the TLS fingerprint or User-Agent',
    'Sites that rely on third-party analytics being reachable (blocklist drops those requests)',
    'Fingerprint surfaces that disagree with each other (platform / UA / UA-CH / timezone / geolocation)',
  ],
  does_not_handle: [
    'Cloudflare interactive challenges',
    'Datadome and Akamai bot manager active challenges',
    'CAPTCHAs — refused by JEXI policy, never solved',
    'IP-based rate limiting (requires proxies, out of scope here)',
  ],
};

const LATLON_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
const IANA_RE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

/** Normalise a boolean-ish value the way Obscura does. */
export function normalizeBool(value) {
  if (value === true || value === false) return value;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

/**
 * Build the stealth environment block.
 *
 * @param {object} [o]
 * @param {number|string|null} [o.profile]    pin a profile index
 * @param {boolean}            [o.rotate]     random profile per context
 * @param {string|null}        [o.timezone]   IANA zone, e.g. 'America/New_York'
 * @param {string|null}        [o.geolocation] 'lat,lon'
 * @param {boolean}            [o.allowPrivateNetwork]
 * @returns {Record<string,string>} env vars to merge into the child env
 */
export function buildStealthEnv({ profile = null, rotate = false, timezone = null, geolocation = null, allowPrivateNetwork = false } = {}) {
  const env = {};
  if (profile !== null && profile !== undefined) {
    if (!Number.isInteger(Number(profile)) || Number(profile) < 0) {
      throw new Error(`stealth: profile must be a non-negative integer index — got ${JSON.stringify(profile)}`);
    }
    env.OBSCURA_PROFILE = String(Number(profile));
  }
  if (rotate) env.OBSCURA_ROTATE_PROFILE = '1';
  if (timezone) {
    if (!IANA_RE.test(String(timezone))) {
      throw new Error(`stealth: timezone must be an IANA zone like 'America/New_York' — got ${JSON.stringify(timezone)}`);
    }
    env.OBSCURA_TIMEZONE = String(timezone);
  }
  if (geolocation) {
    if (!LATLON_RE.test(String(geolocation))) {
      throw new Error(`stealth: geolocation must be "lat,lon" — got ${JSON.stringify(geolocation)}`);
    }
    env.OBSCURA_GEOLOCATION = String(geolocation);
  }
  if (allowPrivateNetwork) env.OBSCURA_ALLOW_PRIVATE_NETWORK = '1';
  return env;
}

/**
 * Report identity inconsistencies before they become a fingerprint.
 *
 * Rotation with a pinned region is the classic mistake: the profile rotates
 * but the TLS fingerprint / timezone / geolocation do not, so the surfaces
 * contradict each other. This returns warnings rather than throwing, because a
 * caller may have a deliberate reason.
 *
 * @returns {{consistent: boolean, warnings: string[]}}
 */
export function checkIdentityConsistency({ profile = null, rotate = false, timezone = null, geolocation = null, proxy = null } = {}) {
  const warnings = [];
  if (rotate && profile !== null && profile !== undefined) {
    warnings.push('OBSCURA_ROTATE_PROFILE is set together with OBSCURA_PROFILE — rotation wins, the pinned index is ignored');
  }
  if (rotate && timezone) {
    warnings.push('rotation is on while OBSCURA_TIMEZONE is pinned — a rotated profile will not match the pinned zone');
  }
  if (rotate && proxy) {
    warnings.push('rotation is on while a proxy is configured — a rotated profile will not match the proxy region');
  }
  if (geolocation && !timezone) {
    warnings.push('OBSCURA_GEOLOCATION is set without OBSCURA_TIMEZONE — coordinates and the reported zone can disagree');
  }
  return { consistent: warnings.length === 0, warnings };
}

/**
 * Whether a build can actually do stealth.
 *
 * Obscura ships stealth as a compile-time feature: archives are named
 * `-stealth` (rendering + stealth), `-no-render-stealth` (stealth only), or
 * without a suffix (no stealth). A build lacking the feature rejects the flag
 * and exits; a build with it starts serving. Detection therefore starts the
 * engine on an ephemeral port and asks what happened — it never assumes.
 *
 * @param {string} binary absolute path to the obscura executable
 * @param {{spawn?: Function, settleMs?: number}} [deps] injectable for tests
 * @returns {Promise<{supported: boolean, detail: string, stderr: string}>}
 */
export async function stealthSupported(binary, deps = {}) {
  const spawn = deps.spawn || nodeSpawn;
  const settleMs = deps.settleMs ?? 1500;
  const child = spawn(binary, ['serve', '--stealth', '--port', '0', '--quiet'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stdout?.on('data', (d) => { stdout += d; });
  child.stderr?.on('data', (d) => { stderr += d; });

  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), settleMs);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code ?? 0); });
    child.once('error', () => { clearTimeout(timer); resolve('spawn-error'); });
  });

  let supported;
  let detail;
  if (exited === null) {
    supported = true;
    detail = 'stealth flag accepted — the engine stayed up when started with --stealth';
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  } else {
    const rejected = /unknown|unrecognized|not (built|compiled|available)|stealth.*(unsupported|disabled)|unexpected argument/i.test(`${stderr}${stdout}`);
    supported = false;
    detail = rejected
      ? 'the installed Obscura build rejects --stealth (use a -stealth or -no-render-stealth archive)'
      : `the engine exited (code ${exited}) when started with --stealth and the output did not name the cause`;
  }
  return { supported, detail, stderr };
}

export default { STEALTH_ENV_SPEC, STEALTH_CAPABILITIES, buildStealthEnv, checkIdentityConsistency, normalizeBool, stealthSupported };
