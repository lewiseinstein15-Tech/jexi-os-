// Phase 11 Scope C — admission barrier.
//
// Before a session is admitted to the daemon it must present an exact
// handshake; the daemon refuses with a SPECIFIC reason on any mismatch:
//   BUILD_MISMATCH       — client build hash != daemon build hash
//   ABI_MISMATCH         — client runtime ABI != daemon runtime ABI
//   CACHE_ROOT_MISMATCH  — client cache root resolves elsewhere
//   PROTOCOL_VERSION_MISMATCH — wire protocol major differs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = 1;

const DAEMON_SOURCES = [
  'codegraph-daemon.js',
  'admission.js',
  'session.js',
  'recovery.js',
  'client.js',
];

/** Build id = sha256 over the daemon source files (same files on both sides). */
export function computeBuildId() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const hash = crypto.createHash('sha256');
  for (const f of DAEMON_SOURCES) {
    const p = path.join(dir, f);
    hash.update(f);
    try {
      hash.update(fs.readFileSync(p));
    } catch {
      hash.update('<missing>');
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/** The runtime identity a daemon (or client) runs under. */
export function runtimeIdentity() {
  return {
    nodeMajor: Number(process.versions.node.split('.')[0]),
    platform: process.platform,
    arch: process.arch,
  };
}

/**
 * Check a client handshake against the daemon identity.
 * @returns {{ admitted: true, build, abi } | { admitted: false, code: string, reason: string }}
 */
export function checkAdmission(hello, daemon, expectedCacheRoot) {
  const want = PROTOCOL_VERSION;
  const got = Number(hello.protocolVersion || 0);
  if (got !== want) {
    return { admitted: false, code: 'PROTOCOL_VERSION_MISMATCH', reason: `client protocol v${got} != daemon protocol v${want}` };
  }
  if (String(hello.build || '') !== daemon.build) {
    return { admitted: false, code: 'BUILD_MISMATCH', reason: `client build ${hello.build || '<none>'} != daemon build ${daemon.build} (exact-build barrier)` };
  }
  const abi = hello.abi || {};
  if (abi.nodeMajor !== daemon.abi.nodeMajor || abi.platform !== daemon.abi.platform || abi.arch !== daemon.abi.arch) {
    return {
      admitted: false,
      code: 'ABI_MISMATCH',
      reason: `client ABI node${abi.nodeMajor}/${abi.platform}/${abi.arch} != daemon ABI node${daemon.abi.nodeMajor}/${daemon.abi.platform}/${daemon.abi.arch}`,
    };
  }
  let resolved;
  try {
    resolved = fs.realpathSync(String(hello.cacheRoot || ''));
  } catch {
    return { admitted: false, code: 'CACHE_ROOT_MISMATCH', reason: `client cache root "${hello.cacheRoot}" does not exist` };
  }
  if (resolved !== expectedCacheRoot) {
    return { admitted: false, code: 'CACHE_ROOT_MISMATCH', reason: `client cache root ${resolved} != daemon cache root ${expectedCacheRoot}` };
  }
  return { admitted: true, build: daemon.build, abi: daemon.abi };
}
