// Phase 11 Scope D — doctor: per-channel health diagnostics.
//
// Upstream contract: one broken channel never takes the report down — every
// channel check runs inside its own try/catch and degrades to
// { status: 'error' } with its stale active_backend scrubbed.

import { ALL_CHANNELS } from './channels/index.js';
import { ReachConfig } from './config.js';

export async function checkAll(config = null, { channels = ALL_CHANNELS, fetchImpl = undefined } = {}) {
  const cfg = config || new ReachConfig();
  const results = {};
  for (const ch of channels) {
    try {
      const { status, message } = await ch.check(fetchImpl !== undefined ? { ...cfg, fetchImpl } : cfg);
      results[ch.name] = {
        name: ch.name,
        description: ch.description,
        status,
        message,
        tier: ch.tier,
        active_backend: ch.active_backend ?? null,
      };
    } catch (err) {
      results[ch.name] = {
        name: ch.name,
        description: ch.description,
        status: 'error',
        message: `check crashed: ${err.message}`,
        tier: ch.tier ?? null,
        active_backend: null, // never leak a stale backend from a failed check
      };
    }
  }
  return results;
}

export function formatReport(results) {
  const lines = ['agent-reach doctor — channel health', ''];
  for (const r of Object.values(results)) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️ ' : '❌';
    lines.push(`${icon} ${r.name.padEnd(12)} [${r.status}] backend=${r.active_backend || '—'} tier=${r.tier} — ${r.message}`);
  }
  return lines.join('\n');
}

// CLI: node capability/internet/reach/doctor.js [--json]
if (process.argv[1] && process.argv[1].endsWith('doctor.js')) {
  const json = process.argv.includes('--json');
  checkAll().then((results) => {
    if (json) console.log(JSON.stringify(results, null, 2));
    else console.log(formatReport(results));
    const bad = Object.values(results).filter((r) => r.status === 'error').length;
    process.exit(bad > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('doctor crashed:', err.message);
    process.exit(2);
  });
}
