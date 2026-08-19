#!/usr/bin/env node
/**
 * B140 — BUNDLE AUDIT (bundle/base mirror tooling).
 * Validates server/bundles/manifest.json and regenerates DSH-PARITY.md,
 * the human-readable pull-all tracker.
 *
 *   node scripts/audit-bundles.js          # validate + regenerate
 *   node scripts/audit-bundles.js --check  # validate only (CI)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(SERVER_ROOT, 'bundles', 'manifest.json');
const PARITY = path.resolve(SERVER_ROOT, '..', 'DSH-PARITY.md');

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
const pkgs = manifest.packages || [];
check('manifest has packages', pkgs.length > 0, `(${pkgs.length})`);
const names = pkgs.map((p) => p.package);
check('package names unique', new Set(names).size === names.length);
const statuses = new Set(pkgs.map((p) => p.status || 'not-yet'));
for (const s of statuses) check(`status "${s}" is valid`, ['ported', 'partial', 'not-yet'].includes(s));

const counts = {
  total: pkgs.length,
  ported: pkgs.filter((p) => p.status === 'ported').length,
  partial: pkgs.filter((p) => p.status === 'partial').length,
  notYet: pkgs.filter((p) => p.status === 'not-yet' || !p.status).length,
};
const pct = Math.round((counts.ported / counts.total) * 100);
console.log(`\n${counts.ported} ported · ${counts.partial} partial · ${counts.notYet} not-yet (${pct}% ported of ${counts.total})`);

if (process.argv.includes('--check')) {
  check('parity doc exists', fs.existsSync(PARITY));
  process.exit(failures === 0 ? 0 : 1);
}

// Regenerate DSH-PARITY.md
const byArea = {};
for (const p of pkgs) {
  const area = p.area || 'misc';
  if (!byArea[area]) byArea[area] = [];
  byArea[area].push(p);
}
const areas = Object.keys(byArea).sort();
const lines = [];
lines.push('# DSH → JEXI Parity Tracker');
lines.push('');
lines.push(`**Generated:** ${new Date().toISOString()} · **Packages tracked:** ${counts.total} · **Ported:** ${counts.ported} (${pct}%) · **Partial:** ${counts.partial} · **Not yet:** ${counts.notYet}`);
lines.push('');
lines.push('Every DeepSeek Harness package JEXI has pulled, its JEXI port, and the batch that landed it. Regenerate with `node server/scripts/audit-bundles.js`.');
lines.push('');
for (const area of areas) {
  lines.push(`## ${area} (${byArea[area].length})`);
  lines.push('');
  lines.push('| Package | Status | JEXI port | Batch |');
  lines.push('|---|---|---|---|');
  for (const p of byArea[area].sort((a, b) => a.package.localeCompare(b.package))) {
    const icon = p.status === 'ported' ? '✅' : p.status === 'partial' ? '🟡' : '⬜';
    lines.push(`| ${icon} ${p.package} | ${p.status} | ${p.port || '—'} | ${p.batch || '—'} |`);
  }
  lines.push('');
}
lines.push('## Status legend');
lines.push('');
lines.push('- ✅ **ported** — the DSH contract is mirrored in JEXI (service, tool, or UI).');
lines.push('- 🟡 **partial** — the core surface is covered; deep internals remain.');
lines.push('- ⬜ **not-yet** — still on the map for the next "Pull all".');
lines.push('');
fs.writeFileSync(PARITY, lines.join('\n'), 'utf-8');
console.log(`✅ DSH-PARITY.md regenerated (${areas.length} areas)`);
process.exit(failures === 0 ? 0 : 1);
