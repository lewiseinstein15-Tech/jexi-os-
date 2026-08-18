/**
 * B137 — HOST STATUS (DeepSeek Harness `packages/host/webserver` +
 * `frontend-static` + `api/gateway` mirror, JEXI-branded).
 *
 * Host-side facts for diagnostics: uptime, memory, static frontend
 * availability, and the gateway surface (open unauthenticated paths, rate
 * limiter state, key-lock status). Values only — never secrets, never
 * internal objects.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';

let startedAt = Date.now();

/** Host facts for /api/host. */
export function hostStatus({ publicDir = null } = {}) {
  const mem = process.memoryUsage();
  const staticInfo = (() => {
    try {
      if (!publicDir || !fs.existsSync(publicDir)) return { available: false };
      const entries = fs.readdirSync(publicDir).filter((f) => /\.(html|js|css|png|ico|json)$/i.test(f));
      return { available: true, files: entries.length, index: fs.existsSync(path.join(publicDir, 'index.html')) };
    } catch { return { available: false }; }
  })();
  return {
    ok: true,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    startedAt,
    node: process.version,
    platform: process.platform,
    memory: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
    },
    loadAvg: (() => { try { return os.loadavg().map((x) => Number(x.toFixed(2))); } catch { return null; } })(),
    cpus: os.cpus().length,
    static: staticInfo,
  };
}

/** Gateway surface for /api/gateway. */
export function gatewayStatus({ openPaths = [], keyLocked = false, allowUnlocked = false, rate = null } = {}) {
  return {
    ok: true,
    keyLocked,
    allowUnlocked,
    openPathCount: Array.isArray(openPaths) ? openPaths.length : 0,
    openPaths: Array.isArray(openPaths) ? openPaths.slice(0, 60) : [],
    rateLimit: rate || null,
  };
}

/** Re-arm the uptime clock (used by tests). */
export function resetHostClock() {
  startedAt = Date.now();
}
