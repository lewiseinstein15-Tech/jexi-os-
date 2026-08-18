/**
 * B136 — BOOT PROFILE (DeepSeek Harness `packages/boot/app-boot` profile +
 * config-dump mirror, JEXI-branded).
 *
 * Boot-time profile: the server writes a durable `boot-profile.json` under
 * DATA_DIR on start (node version, platform, build phase, feature flags,
 * environment SUMMARY — names only, never values) and exposes it plus a
 * config dump endpoint. Consumers (health checks, diagnostics, the APK
 * update probe) can verify WHICH boot the live process came from.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { DATA_DIR, WORKSPACE_DIR, PORT } from '../config.js';

const PROFILE_FILE = path.join(DATA_DIR, 'boot-profile.json');

/** Environment summary: names + whether present (never values). */
export function envSummary(env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    out[name] = { present: true, length: String(value).length };
  }
  return out;
}

/** Feature flags derived from the environment (names only). */
export function featureFlags(env = process.env) {
  return {
    redis: !!env.REDIS_URL,
    firebase: !!env.FIREBASE_SERVICE_ACCOUNT_B64,
    apiKeyLock: !!env.JEXI_API_KEY,
    allowUnlocked: env.JEXI_ALLOW_UNLOCKED === '1',
    sqlite: true, // node:sqlite built-in (Node ≥ 22.5)
    plugins: true,
  };
}

/** Write the boot profile (fail-open). */
export function writeBootProfile({ phase = 'B136', commit = 'local', startedAt = Date.now() } = {}) {
  const profile = {
    bootedAt: startedAt,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os: { type: os.type(), release: os.release() },
    cwd: process.cwd(),
    port: PORT,
    workspaceRoot: path.resolve(WORKSPACE_DIR || process.cwd()),
    phase,
    commit,
    features: featureFlags(),
    envNames: Object.keys(envSummary()).sort(),
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
  } catch (e) { console.error('[boot-profile] write error:', e.message); }
  return profile;
}

/** Read the last written boot profile. */
export function readBootProfile() {
  try {
    if (!fs.existsSync(PROFILE_FILE)) return null;
    return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
  } catch { return null; }
}

/** Config dump (safe subset: no secrets). */
export function configDump(settings = {}) {
  const safe = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (/key|token|secret|password|credential|auth/i.test(k)) continue;
      out[k] = v;
    }
    return out;
  };
  return {
    profile: readBootProfile(),
    settings: safe(settings),
    envNames: Object.keys(envSummary()).sort(),
    features: featureFlags(),
  };
}
